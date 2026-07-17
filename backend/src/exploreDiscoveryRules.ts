import { getBeijingDate } from './beijingTime';
import { EXPLORE_EXPERIENCE_GROUPS, normalizeExploreSelections } from './exploreExperience';

export type ExploreObjective = 'energy' | 'knowledge' | 'hands-on' | 'family';
export type ExploreDatePreset = 'today' | 'weekend' | 'next-week' | 'custom';
export type UnsupportedConstraint = 'crowd' | 'route_time' | 'transit_convenience';
export type TrustTier = 'S' | 'A' | 'B' | 'family';

export type ExplorePlannerRequest = {
  childId?: string;
  customText?: string;
  city: string;
  districtScope?: string[];
  datePreset?: ExploreDatePreset;
  dateFrom?: string;
  dateTo?: string;
  objective?: ExploreObjective;
  budgetMax?: number;
  indoorPreference?: 'indoor' | 'outdoor' | 'any';
  experienceKeys?: string[];
};

export type ParsedExploreIntent = {
  hardConditions: {
    city: string;
    districtScope: string[];
    dateFrom?: string;
    dateTo?: string;
    budgetMax?: number;
    indoorPreference: 'indoor' | 'outdoor' | 'any';
    explicitPlace?: string;
    officialUrl?: string;
  };
  preferences: {
    queryText: string;
    objective?: ExploreObjective;
    experienceKeys: string[];
  };
  unsupported: UnsupportedConstraint[];
};

export type ExploreDiscoveryCandidate = {
  id?: string;
  externalId?: string;
  sourceKey: string;
  sourceUrl: string;
  trustTier: TrustTier;
  type: 'poi' | 'activity';
  title: string;
  summary: string;
  imageUrl: string;
  imageSourceUrl?: string;
  category: string;
  city: string;
  district?: string;
  address?: string;
  venue?: string;
  latitude?: number;
  longitude?: number;
  activityStart?: string;
  activityEnd?: string;
  priceAmount?: number;
  ageMin?: number;
  ageMax?: number;
  indoorOutdoor?: 'indoor' | 'outdoor' | 'both' | 'unknown';
  experienceKeys: string[];
  objectiveKeys: ExploreObjective[];
  verifiedAt: string;
  freshUntil: string;
  authorityFields: string[];
  criticalConflict?: boolean;
};

export type RankedExploreCandidate = ExploreDiscoveryCandidate & {
  score: number;
  recommendationRole: 'primary' | 'alternative';
};

export type FieldEvidence = {
  value: unknown;
  trustTier: TrustTier;
  sourceKey: string;
};

const options = EXPLORE_EXPERIENCE_GROUPS.flatMap(group => group.options);
const optionByKey = new Map(options.map(option => [option.key, option]));
const clean = (value: unknown, max = 160) => String(value ?? '').trim().slice(0, max);
const unique = <T>(values: T[]) => [...new Set(values)];
const validDate = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(clean(value, 10));

const formatCalendarDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addCalendarDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const resolveDateRange = (preset: ExploreDatePreset | undefined, now: Date, from?: string, to?: string) => {
  if (preset === 'custom') {
    return { dateFrom: validDate(from) ? clean(from, 10) : undefined, dateTo: validDate(to) ? clean(to, 10) : undefined };
  }
  if (!preset) return {};
  const today = getBeijingDate(now);
  if (preset === 'today') {
    const date = formatCalendarDate(today);
    return { dateFrom: date, dateTo: date };
  }
  if (preset === 'weekend') {
    const day = today.getDay();
    const saturdayOffset = day === 0 ? 0 : day === 6 ? 0 : 6 - day;
    const start = addCalendarDays(today, saturdayOffset);
    const end = day === 0 ? today : addCalendarDays(start, 1);
    return { dateFrom: formatCalendarDate(start), dateTo: formatCalendarDate(end) };
  }
  const day = today.getDay() || 7;
  const monday = addCalendarDays(today, 8 - day);
  return { dateFrom: formatCalendarDate(monday), dateTo: formatCalendarDate(addCalendarDays(monday, 6)) };
};

const chineseDigit = new Map([['零', 0], ['一', 1], ['二', 2], ['两', 2], ['三', 3], ['四', 4], ['五', 5], ['六', 6], ['七', 7], ['八', 8], ['九', 9]]);
const parseChineseInteger = (text: string): number | undefined => {
  if (/^\d+$/.test(text)) return Number(text);
  let total = 0;
  let current = 0;
  for (const char of text) {
    if (chineseDigit.has(char)) current = chineseDigit.get(char)!;
    else if (char === '十') { total += (current || 1) * 10; current = 0; }
    else if (char === '百') { total += (current || 1) * 100; current = 0; }
    else return undefined;
  }
  return total + current;
};

const parseBudget = (text: string) => {
  const match = text.match(/(?:预算|最多|不超过|以内)[^\d零一二两三四五六七八九十百]{0,4}([\d零一二两三四五六七八九十百]+)\s*(?:元|块)/);
  return match ? parseChineseInteger(match[1]) : undefined;
};

const inferObjective = (text: string): ExploreObjective | undefined => {
  if (/(放电|运动|跑|跳)/.test(text)) return 'energy';
  if (/(动手|手工|制作|实验|烘焙)/.test(text)) return 'hands-on';
  if (/(亲子|陪伴|一起)/.test(text)) return 'family';
  if (/(知识|见识|学习|科普|博物)/.test(text)) return 'knowledge';
  return undefined;
};

const inferExperienceKeys = (text: string) => options
  .filter(option => option.key !== 'any' && (text.includes(option.label) || option.keywords.some(keyword => text.includes(keyword))))
  .map(option => option.key)
  .slice(0, 2);

export const parseExploreIntent = (request: ExplorePlannerRequest, now: Date = new Date()): ParsedExploreIntent => {
  const customText = clean(request.customText);
  const url = customText.match(/https?:\/\/[^\s，。]+/i)?.[0];
  const detectedPreset: ExploreDatePreset | undefined = /下周/.test(customText)
    ? 'next-week'
    : /周末/.test(customText)
      ? 'weekend'
      : /(今天|今日)/.test(customText)
        ? 'today'
        : undefined;
  const dateRange = resolveDateRange(request.datePreset || detectedPreset, now, request.dateFrom, request.dateTo);
  const parsedSelections = inferExperienceKeys(customText);
  const explicitSelections = request.experienceKeys?.length ? normalizeExploreSelections(request.experienceKeys) : [];
  const experienceKeys = explicitSelections.length > 0 ? explicitSelections : parsedSelections;
  const placeMatch = customText.match(/(?:地点[:：]?|想去)([^，。,；;]{2,40})/);
  const explicitPlace = placeMatch?.[1]
    ?.replace(/(?:室内|室外|户外|预算|人少|不挤|车程).*$/, '')
    .trim();
  const unsupported: UnsupportedConstraint[] = [];
  if (/(人少|不挤|清静|排队少)/.test(customText)) unsupported.push('crowd');
  if (/(车程|开车.{0,8}分钟|\d+分钟内)/.test(customText)) unsupported.push('route_time');
  if (/(交通方便|地铁直达|公交方便)/.test(customText)) unsupported.push('transit_convenience');
  const districtScope = unique((request.districtScope || []).map(value => clean(value, 40)).filter(Boolean)).slice(0, 5);
  const inputBudget = Number(request.budgetMax);
  const budgetMax = Number.isFinite(inputBudget) && inputBudget >= 0 ? Math.trunc(inputBudget) : parseBudget(customText);
  const indoorPreference = request.indoorPreference
    || (/(室内)/.test(customText) ? 'indoor' : /(室外|户外)/.test(customText) ? 'outdoor' : 'any');

  return {
    hardConditions: {
      city: clean(request.city, 40),
      districtScope,
      ...dateRange,
      ...(budgetMax === undefined ? {} : { budgetMax }),
      indoorPreference,
      ...(explicitPlace ? { explicitPlace } : {}),
      ...(url ? { officialUrl: url } : {}),
    },
    preferences: {
      queryText: customText.replace(/https?:\/\/[^\s，。]+/ig, '').replace(/\s+/g, ' ').trim(),
      objective: request.objective || inferObjective(customText),
      experienceKeys: experienceKeys.length > 0 ? experienceKeys : ['any'],
    },
    unsupported: unique(unsupported),
  };
};

export const generateExploreQueries = (parsed: ParsedExploreIntent): string[] => {
  const values = [parsed.hardConditions.explicitPlace, parsed.preferences.queryText];
  for (const key of parsed.preferences.experienceKeys) {
    const option = optionByKey.get(key);
    if (option) values.push(option.keywords[0] || option.label);
  }
  const queries = unique(values.map(value => clean(value, 80)).filter(Boolean));
  return (queries.length > 0 ? queries : ['亲子活动']).slice(0, 4);
};

const poiFields = new Set(['title', 'address', 'latitude', 'longitude', 'category', 'imageUrl']);
const activityFields = new Set(['activityStart', 'activityEnd', 'signupDeadline', 'priceAmount', 'bookingMethod']);
const authorityRank = (field: string, tier: TrustTier) => {
  if (activityFields.has(field)) return ({ S: 4, family: 3, A: 2, B: 1 })[tier];
  if (poiFields.has(field)) return ({ A: 4, S: 3, family: 3, B: 1 })[tier];
  return ({ S: 4, A: 3, family: 3, B: 1 })[tier];
};

export const resolveAuthoritativeField = (field: string, evidence: FieldEvidence[]) => {
  if (evidence.length === 0) return { value: undefined, conflict: false };
  const highest = Math.max(...evidence.map(item => authorityRank(field, item.trustTier)));
  const strongest = evidence.filter(item => authorityRank(field, item.trustTier) === highest);
  const values = unique(strongest.map(item => JSON.stringify(item.value)));
  return { value: strongest[0].value, conflict: values.length > 1, sourceKey: strongest[0].sourceKey };
};

const normalizedCity = (value: string) => clean(value, 40).replace(/市$/, '');
const overlaps = (start: string | undefined, end: string | undefined, from?: string, to?: string) => {
  if (!from && !to) return true;
  if (!start && !end) return false;
  const itemStart = start || end!;
  const itemEnd = end || start!;
  return (!to || itemStart <= to) && (!from || itemEnd >= from);
};

export const getCandidateRejection = (
  item: ExploreDiscoveryCandidate,
  parsed: ParsedExploreIntent,
  now: Date = new Date(),
  childAge?: number
): string | null => {
  if (item.criticalConflict) return 'conflict';
  const imageValid = /^https?:\/\//i.test(item.imageUrl) || item.imageUrl.startsWith('/uploads/explore/');
  const hasLocation = (Number.isFinite(item.latitude) && Number.isFinite(item.longitude)) || clean(item.address, 200).length >= 4;
  const hasActivity = clean(item.venue, 100).length >= 2 && !!(item.activityStart || item.activityEnd);
  if (clean(item.title, 80).length < 2 || clean(item.summary, 300).length < 4 || !imageValid
    || !/^https?:\/\//i.test(item.sourceUrl) || (item.type === 'poi' ? !hasLocation : !hasActivity)) return 'incomplete';
  if (!Number.isFinite(new Date(item.verifiedAt).getTime()) || new Date(item.freshUntil).getTime() <= now.getTime()) return 'stale';
  if (normalizedCity(item.city) !== normalizedCity(parsed.hardConditions.city)) return 'city';
  if (childAge !== undefined && ((item.ageMin !== undefined && childAge < item.ageMin) || (item.ageMax !== undefined && childAge > item.ageMax))) return 'age';
  if (parsed.hardConditions.districtScope.length > 0
    && !parsed.hardConditions.districtScope.some(district => clean(item.district).includes(district))) return 'district';
  if (parsed.hardConditions.indoorPreference !== 'any') {
    const value = item.indoorOutdoor || 'unknown';
    if (value !== parsed.hardConditions.indoorPreference && value !== 'both') return 'indoor';
  }
  if (item.type === 'activity') {
    const today = formatCalendarDate(getBeijingDate(now));
    if ((item.activityEnd || item.activityStart || '') < today) return 'date';
    if (!overlaps(item.activityStart, item.activityEnd, parsed.hardConditions.dateFrom, parsed.hardConditions.dateTo)) return 'date';
  }
  if (parsed.hardConditions.budgetMax !== undefined
    && (!Number.isFinite(item.priceAmount) || item.priceAmount! > parsed.hardConditions.budgetMax)) return 'budget';
  return null;
};

export const scoreExploreCandidate = (item: ExploreDiscoveryCandidate, parsed: ParsedExploreIntent, now: Date = new Date()) => {
  const selected = parsed.preferences.experienceKeys;
  const experience = selected.includes('any') || selected.some(key => item.experienceKeys.includes(key)) ? 1 : 0;
  const objective = parsed.preferences.objective && item.objectiveKeys.includes(parsed.preferences.objective) ? 1 : 0;
  const date = item.type === 'activity'
    && overlaps(item.activityStart, item.activityEnd, parsed.hardConditions.dateFrom, parsed.hardConditions.dateTo) ? 1 : 0;
  const budget = parsed.hardConditions.budgetMax !== undefined
    && Number.isFinite(item.priceAmount) && item.priceAmount! <= parsed.hardConditions.budgetMax ? 1 : 0;
  const district = parsed.hardConditions.districtScope.length > 0
    && parsed.hardConditions.districtScope.some(value => clean(item.district).includes(value)) ? 1 : 0;
  const freshness = new Date(item.freshUntil).getTime() > now.getTime() ? 1 : 0;
  return experience * 40 + objective * 20 + date * 15 + budget * 10 + district * 10 + freshness * 5;
};

const normalizeIdentity = (value: string) => value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const distanceMeters = (a: ExploreDiscoveryCandidate, b: ExploreDiscoveryCandidate) => {
  if (![a.latitude, a.longitude, b.latitude, b.longitude].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  const radius = 6_371_000;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.latitude! - a.latitude!);
  const dLon = radians(b.longitude! - a.longitude!);
  const lat1 = radians(a.latitude!);
  const lat2 = radians(b.latitude!);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

export const deduplicateExploreCandidates = (items: ExploreDiscoveryCandidate[]) => {
  const result: ExploreDiscoveryCandidate[] = [];
  // ponytail: planner candidates are capped; replace this scan with a spatial index only if volume grows materially.
  for (const item of items) {
    const duplicate = result.some(existing => (
      !!item.externalId && item.externalId === existing.externalId
    ) || (
      normalizeIdentity(item.title) === normalizeIdentity(existing.title)
      && normalizedCity(item.city) === normalizedCity(existing.city)
      && clean(item.district) === clean(existing.district)
    ) || distanceMeters(item, existing) <= 150);
    if (!duplicate) result.push(item);
  }
  return result;
};

export const rankExploreCandidates = (
  items: ExploreDiscoveryCandidate[],
  parsed: ParsedExploreIntent,
  now: Date = new Date()
): RankedExploreCandidate[] => {
  const ranked = items.map((item, index) => ({ item, index, score: scoreExploreCandidate(item, parsed, now) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  if (ranked.length === 0) return [];
  const picked = [ranked[0]];
  const differentKind = ranked.slice(1).find(row => row.item.type !== ranked[0].item.type);
  if (differentKind) picked.push(differentKind);
  for (const row of ranked.slice(1)) {
    if (picked.length >= 3) break;
    if (!picked.includes(row)) picked.push(row);
  }
  return picked.map(({ item, score }, index) => ({
    ...item,
    score,
    recommendationRole: index === 0 ? 'primary' : 'alternative',
  }));
};
