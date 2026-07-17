import axios from 'axios';
import { getLocalDateString } from './beijingTime';
import type { ExploreDiscoveryCandidate, ParsedExploreIntent } from './exploreDiscoveryRules';
import { EXPLORE_EXPERIENCE_GROUPS } from './exploreExperience';

const NATIONAL_CULTURE_API = 'https://www.culturedc.cn/api/v1/encrypt';
const NATIONAL_CULTURE_ACTIVITY_URL = 'https://www.culturedc.cn/web3.0/activityHome.html';
const SHANGHAI_MUSEUM_ACTIVITY_URL = 'https://events.shanghaimuseum.net/sheduplatform/activityOut/out/activityPage';
const SHANGHAI_LIBRARY_ACTIVITY_URL = 'https://www.library.sh.cn/activity';

const clean = (value: unknown, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const stripHtml = (value: unknown) => clean(String(value ?? '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>'));
const addHours = (date: Date, hours: number) => new Date(date.getTime() + hours * 3_600_000);
const normalizeCity = (value: unknown) => clean(value, 40).replace(/市$/, '');
const validUrl = (value: unknown) => /^https:\/\//i.test(clean(value, 600));
const familyRelevant = (value: unknown) => /(亲子|儿童|少年|青少年|小学生|学生课程|少儿|研学|科普|非遗|手工|工坊|导览|阅读推广|故事|美育|实验)/.test(clean(value, 800));

const inferDistrict = (value: unknown) => {
  const text = clean(value, 300);
  return ['黄浦区', '徐汇区', '长宁区', '静安区', '普陀区', '虹口区', '杨浦区', '浦东新区', '闵行区',
    '宝山区', '嘉定区', '金山区', '松江区', '青浦区', '奉贤区', '崇明区']
    .find(district => text.includes(district));
};

export const inferExploreCandidateTags = (...facts: unknown[]) => {
  const haystack = facts.map(value => clean(value, 300)).join(' ');
  const experienceKeys = EXPLORE_EXPERIENCE_GROUPS.flatMap(group => group.options)
    .filter(option => option.key !== 'any' && option.keywords.some(keyword => haystack.includes(keyword)))
    .map(option => option.key);
  const objectiveKeys = [
    ...(/科学|实验|手工|手作|陶艺|烘焙|料理|模型|机器人|绘画|设计/.test(haystack) ? ['hands-on' as const] : []),
    ...(/博物馆|科技馆|科学馆|科普|历史|图书馆|美术馆|展览|遗址|考古/.test(haystack) ? ['knowledge' as const] : []),
    ...(/公园|步道|湿地|动物|植物|徒步|骑行|攀岩|游泳|滑冰|球馆/.test(haystack) ? ['energy' as const] : []),
    ...(/亲子|家庭|工作坊/.test(haystack) ? ['family' as const] : []),
  ];
  return { experienceKeys: [...new Set(experienceKeys)], objectiveKeys: [...new Set(objectiveKeys)] };
};

const activityCategory = (title: string, fallback = '文化活动') => {
  if (/(工坊|手工|体验|实验|制作)/.test(title)) return '体验活动';
  if (/(导览|讲解|研学)/.test(title)) return '研学导览';
  if (/(展览|展陈|特展)/.test(title)) return '展览';
  if (/(阅读|故事|图书)/.test(title)) return '阅读活动';
  return clean(fallback, 40) || '文化活动';
};

const makeActivity = (input: Omit<ExploreDiscoveryCandidate, 'type' | 'indoorOutdoor' | 'verifiedAt' | 'freshUntil'>, now: Date) => ({
  ...input,
  type: 'activity' as const,
  indoorOutdoor: 'unknown' as const,
  verifiedAt: now.toISOString(),
  freshUntil: addHours(now, 6).toISOString(),
});

export const parseNationalPublicCultureActivities = (
  payload: any, requestedCity: string, now: Date = new Date()
): ExploreDiscoveryCandidate[] => {
  if (String(payload?.returnCode) !== '1') return [];
  const rows = Array.isArray(payload?.returnData)
    ? payload.returnData
    : Array.isArray(payload?.returnData?.list) ? payload.returnData.list : [];
  const city = normalizeCity(requestedCity);
  const today = getLocalDateString(now);
  return rows.flatMap((row: any) => {
    const title = clean(row?.resName || row?.topicName, 100);
    const summary = clean(row?.resDesc || row?.subTitle || [row?.categoryName, row?.labelNames].filter(Boolean).join(' · '), 300);
    const venue = clean(row?.venueName || row?.topicRegion, 160);
    const sourceLocation = clean([row?.areaName, row?.venueName, row?.topicRegion, title, summary].filter(Boolean).join(' '), 700);
    const start = clean(row?.topicStartTime, 10);
    const end = clean(row?.topicEndTime || row?.topicStartTime, 10);
    const imageUrl = clean(row?.poster, 600);
    const sourceUrl = clean(row?.topicPcUrl || row?.topicAppUrl || NATIONAL_CULTURE_ACTIVITY_URL, 600);
    if (!city || !sourceLocation.includes(city) || !/^\d{4}-\d{2}-\d{2}$/.test(start)
      || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < today || title.length < 2 || summary.length < 4
      || venue.length < 2 || !validUrl(imageUrl) || !validUrl(sourceUrl)
      || !familyRelevant([title, summary, row?.labelNames].join(' '))) return [];
    const tags = inferExploreCandidateTags(title, summary, venue, row?.labelNames);
    return [makeActivity({
      externalId: clean(row?.id, 80),
      sourceKey: 'national-public-culture-cloud',
      sourceUrl,
      trustTier: 'B' as const,
      title,
      summary,
      imageUrl,
      imageSourceUrl: imageUrl,
      category: activityCategory(title, row?.categoryName),
      city: normalizeCity(requestedCity),
      district: inferDistrict(sourceLocation),
      venue,
      activityStart: start,
      activityEnd: end,
      experienceKeys: tags.experienceKeys,
      objectiveKeys: tags.objectiveKeys,
      authorityFields: ['title', 'summary', 'imageUrl', 'venue', 'activityStart', 'activityEnd'],
    }, now)];
  });
};

const blockText = (block: string, label: string) => stripHtml(block.match(new RegExp(`${label}：([^<]+)`, 'i'))?.[1]);

export const parseShanghaiMuseumActivities = (html: string, now: Date = new Date()): ExploreDiscoveryCandidate[] => {
  const today = getLocalDateString(now);
  return String(html).split(/<div class="list-item"[^>]*>/i).slice(1).flatMap(block => {
    const title = stripHtml(block.match(/class="item-title[^>]*>([\s\S]*?)<\/a>/i)?.[1]);
    const externalId = clean(block.match(/toLoad\(['"]?(\d+)/i)?.[1], 80);
    const relativeImage = clean(block.match(/class="list-img"[^>]+src="([^"]+)"/i)?.[1], 600);
    const imageUrl = relativeImage ? new URL(relativeImage, SHANGHAI_MUSEUM_ACTIVITY_URL).toString() : '';
    const time = blockText(block, '时间');
    const start = clean(time.match(/\d{4}-\d{2}-\d{2}/)?.[0], 10);
    const branch = blockText(block, '场馆');
    const location = blockText(block, '地点');
    const speaker = blockText(block, '主讲人');
    const ages = blockText(block, '参与年龄段').match(/(\d+)\s*-\s*(\d+)/);
    const ageMin = ages ? Number(ages[1]) : undefined;
    const ageMax = ages ? Number(ages[2]) : undefined;
    if (!start || start < today || title.length < 2 || !validUrl(imageUrl) || !branch || !location
      || (ageMin !== undefined && ageMin > 12) || (ageMax !== undefined && ageMax < 6)) return [];
    const venue = `上海博物馆${branch} · ${location}`;
    const summary = speaker ? `地点：${venue}；主讲人：${speaker}` : `地点：${venue}`;
    const tags = inferExploreCandidateTags(title, summary);
    return [makeActivity({
      externalId,
      sourceKey: 'shanghai-museum-events',
      sourceUrl: SHANGHAI_MUSEUM_ACTIVITY_URL,
      trustTier: 'S' as const,
      title,
      summary,
      imageUrl,
      imageSourceUrl: imageUrl,
      category: activityCategory(title, '博物馆活动'),
      city: '上海',
      district: branch.includes('人民广场') ? '黄浦区' : branch.includes('东馆') ? '浦东新区' : undefined,
      venue,
      activityStart: start,
      activityEnd: start,
      ageMin,
      ageMax,
      experienceKeys: tags.experienceKeys,
      objectiveKeys: tags.objectiveKeys,
      authorityFields: ['title', 'imageUrl', 'venue', 'activityStart', 'activityEnd', 'ageMin', 'ageMax'],
    }, now)];
  });
};

export const parseShanghaiLibraryActivities = (html: string, now: Date = new Date()): ExploreDiscoveryCandidate[] => {
  const today = getLocalDateString(now);
  return String(html).split(/<div class="activity-list-item"[^>]*>/i).slice(1).flatMap((block, index) => {
    const imageUrl = clean(block.match(/background-image\s*:\s*url\((?:['"]?)(https:\/\/[^)'";]+)(?:['"]?)\)/i)?.[1], 600);
    const title = stripHtml(block.match(/class="activity-list-item-title"[^>]*>\s*([^<]+)/i)?.[1]);
    const venue = stripHtml(block.match(/class="activity-list-item-address"[^>]*>\s*([^<]+)/i)?.[1]);
    const dateText = stripHtml(block.match(/class="activity-list-item-date"[^>]*>\s*([^<]+)/i)?.[1]);
    const dateMatch = dateText.match(/(\d{4})年(\d{2})月(\d{2})日/);
    const start = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : '';
    if (!start || start < today || title.length < 2 || venue.length < 2 || !validUrl(imageUrl) || !familyRelevant(title)) return [];
    const summary = `地点：${venue}`;
    const tags = inferExploreCandidateTags(title, venue);
    return [makeActivity({
      externalId: `library-${start}-${index}-${title.slice(0, 20)}`,
      sourceKey: 'shanghai-library-activities',
      sourceUrl: SHANGHAI_LIBRARY_ACTIVITY_URL,
      trustTier: 'S' as const,
      title,
      summary,
      imageUrl,
      imageSourceUrl: imageUrl,
      category: activityCategory(title, '图书馆活动'),
      city: '上海',
      district: inferDistrict(venue),
      venue,
      activityStart: start,
      activityEnd: start,
      experienceKeys: tags.experienceKeys,
      objectiveKeys: tags.objectiveKeys,
      authorityFields: ['title', 'imageUrl', 'venue', 'activityStart', 'activityEnd'],
    }, now)];
  });
};

const fetchNationalActivities = async (intent: ParsedExploreIntent, signal: AbortSignal, now: Date) => {
  const body = new URLSearchParams({
    contentType: 'application/json;charset=utf-8',
    dataType: 'json',
    apiKey: 'api_get_getResourcePageList',
    deviceType: 'DIC_DEVICE_TYPE_1',
    exclLogicAreaId: '0',
    categoryIds: '1580',
    logicAreaId: '',
    topicLevel: '',
    sort: 'publishTime',
    resDicType: 'DIC_RESOURCE_TYPE_26',
    pageSize: '100',
    pageNumber: '1',
  });
  const response = await axios.post(NATIONAL_CULTURE_API, body, {
    timeout: 8_000,
    signal,
    maxContentLength: 2 * 1024 * 1024,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return parseNationalPublicCultureActivities(response.data, intent.hardConditions.city, now);
};

const fetchShanghaiMuseumActivities = async (signal: AbortSignal, now: Date) => {
  const response = await axios.get<string>(SHANGHAI_MUSEUM_ACTIVITY_URL, {
    timeout: 8_000, signal, maxContentLength: 2 * 1024 * 1024,
  });
  return parseShanghaiMuseumActivities(response.data, now);
};

const fetchShanghaiLibraryActivities = async (signal: AbortSignal, now: Date) => {
  const response = await axios.get<string>(SHANGHAI_LIBRARY_ACTIVITY_URL, {
    timeout: 8_000, signal, maxContentLength: 2 * 1024 * 1024,
  });
  return parseShanghaiLibraryActivities(response.data, now);
};

export const searchTrustedOfficialActivities = async (
  intent: ParsedExploreIntent, signal: AbortSignal, now: Date = new Date()
) => {
  const sources = [{ sourceKey: 'national-public-culture-cloud', search: () => fetchNationalActivities(intent, signal, now) }];
  if (normalizeCity(intent.hardConditions.city) === '上海') {
    sources.push(
      { sourceKey: 'shanghai-museum-events', search: () => fetchShanghaiMuseumActivities(signal, now) },
      { sourceKey: 'shanghai-library-activities', search: () => fetchShanghaiLibraryActivities(signal, now) },
    );
  }
  const settled = await Promise.allSettled(sources.map(source => source.search()));
  return {
    candidates: settled.flatMap(result => result.status === 'fulfilled' ? result.value : []),
    failedSourceKeys: settled.flatMap((result, index) => result.status === 'rejected' ? [sources[index].sourceKey] : []),
  };
};
