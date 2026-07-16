import { Express } from 'express';

export type ExploreExperienceOption = {
  key: string;
  label: string;
  adultCategory: string;
  keywords: string[];
};

export type ExploreExperienceGroup = {
  key: string;
  label: string;
  icon: string;
  options: ExploreExperienceOption[];
};

export const EXPLORE_EXPERIENCE_GROUPS: ExploreExperienceGroup[] = [
  {
    key: 'create', label: '动手创造', icon: '🛠️', options: [
      { key: 'science_experiment', label: '做科学实验', adultCategory: '科学与创造', keywords: ['科学', '实验', '科技馆', '科普'] },
      { key: 'handcraft', label: '做手工', adultCategory: '科学与创造', keywords: ['手工', '手作', '非遗', '陶艺'] },
      { key: 'cooking', label: '烘焙或料理', adultCategory: '科学与创造', keywords: ['烘焙', '料理', '厨房', '美食'] },
      { key: 'building', label: '搭模型或机械', adultCategory: '科学与创造', keywords: ['模型', '搭建', '机械', '机器人'] },
      { key: 'art_design', label: '画画和设计', adultCategory: '科学与创造', keywords: ['绘画', '设计', '美术', '艺术'] },
    ],
  },
  {
    key: 'nature', label: '走进自然', icon: '🌿', options: [
      { key: 'park_walk', label: '逛公园散步', adultCategory: '自然与户外', keywords: ['公园', '散步', '步道', '湿地'] },
      { key: 'animals', label: '观察动物', adultCategory: '自然与户外', keywords: ['动物', '昆虫', '鸟类', '动物园'] },
      { key: 'plants', label: '发现植物', adultCategory: '自然与户外', keywords: ['植物', '花园', '森林', '自然'] },
      { key: 'hiking', label: '骑行或徒步', adultCategory: '自然与户外', keywords: ['骑行', '徒步', '登山', '定向'] },
      { key: 'picnic', label: '露营和野餐', adultCategory: '自然与户外', keywords: ['露营', '野餐', '郊野'] },
      { key: 'water', label: '亲水体验', adultCategory: '自然与户外', keywords: ['水上', '河流', '海洋', '划船'] },
    ],
  },
  {
    key: 'culture', label: '文化发现', icon: '🏛️', options: [
      { key: 'museum', label: '逛博物馆', adultCategory: '文化与艺术', keywords: ['博物馆', '文博', '历史'] },
      { key: 'science_museum', label: '去科技馆', adultCategory: '文化与艺术', keywords: ['科技馆', '科学馆', '科普'] },
      { key: 'exhibition', label: '看美术或展览', adultCategory: '文化与艺术', keywords: ['美术馆', '展览', '艺术', '画展'] },
      { key: 'library', label: '逛图书馆', adultCategory: '文化与艺术', keywords: ['图书馆', '阅读', '绘本'] },
      { key: 'heritage', label: '看历史建筑', adultCategory: '文化与艺术', keywords: ['古镇', '建筑', '遗址', '非遗'] },
      { key: 'performance', label: '看戏剧或音乐', adultCategory: '文化与艺术', keywords: ['戏剧', '音乐', '演出', '剧场'] },
    ],
  },
  {
    key: 'sport', label: '运动挑战', icon: '🏃', options: [
      { key: 'ball_games', label: '体验球类', adultCategory: '运动与挑战', keywords: ['足球', '篮球', '羽毛球', '球馆'] },
      { key: 'climbing', label: '攀岩或蹦床', adultCategory: '运动与挑战', keywords: ['攀岩', '蹦床', '挑战'] },
      { key: 'swim_skate', label: '游泳或滑冰', adultCategory: '运动与挑战', keywords: ['游泳', '滑冰', '冰雪'] },
      { key: 'run_orienteering', label: '跑步或定向', adultCategory: '运动与挑战', keywords: ['跑步', '定向', '越野'] },
      { key: 'dance_martial', label: '舞蹈或武术', adultCategory: '运动与挑战', keywords: ['舞蹈', '武术', '体操'] },
    ],
  },
  {
    key: 'city', label: '城市体验', icon: '🌆', options: [
      { key: 'market', label: '逛市集或节庆', adultCategory: '城市与公益', keywords: ['市集', '节庆', '庙会', '活动'] },
      { key: 'volunteer', label: '参加公益体验', adultCategory: '城市与公益', keywords: ['公益', '志愿', '社区'] },
      { key: 'transport', label: '体验交通工具', adultCategory: '城市与公益', keywords: ['地铁', '火车', '航空', '交通'] },
      { key: 'career', label: '体验一种职业', adultCategory: '城市与公益', keywords: ['职业', '工厂', '消防', '警察'] },
      { key: 'family_event', label: '参加亲子活动', adultCategory: '城市与公益', keywords: ['亲子', '家庭', '工作坊', '研学'] },
    ],
  },
  {
    key: 'any', label: '随便看看', icon: '✨', options: [
      { key: 'any', label: '给我一点惊喜', adultCategory: '不限', keywords: [] },
    ],
  },
];

const OPTION_MAP = new Map(
  EXPLORE_EXPERIENCE_GROUPS.flatMap(group => group.options).map(option => [option.key, option])
);

const cleanText = (value: unknown) => String(value ?? '').trim();

export const normalizeExploreSelections = (value: unknown, enabledKeys?: Set<string>): string[] => {
  const raw = Array.isArray(value) ? value : [];
  const selections = [...new Set(raw.map(item => cleanText(item)).filter(Boolean))];
  if (selections.length === 0) return ['any'];
  if (selections.length > 2) throw new Error('最多选择 2 项体验');
  if (selections.includes('any') && selections.length > 1) throw new Error('随便看看不能和其他选项一起选择');
  for (const key of selections) {
    if (!OPTION_MAP.has(key)) throw new Error('体验选项不存在');
    if (enabledKeys && key !== 'any' && !enabledKeys.has(key)) throw new Error('这个体验选项已被家长停用');
  }
  return selections;
};

const validImageUrl = (value: unknown) => {
  const url = cleanText(value);
  return /^https?:\/\//i.test(url) || url.startsWith('/uploads/explore/');
};

const finiteCoordinate = (value: unknown) => value !== null && value !== '' && Number.isFinite(Number(value));

export const isExploreFeedItemComplete = (item: any): boolean => {
  const title = cleanText(item?.title);
  const summary = cleanText(item?.summary);
  const genericTitle = /^(未命名|待补全|暂无|探索推荐|活动推荐)$/;
  if (title.length < 2 || genericTitle.test(title)) return false;
  if (!validImageUrl(item?.imageUrl) || summary.length < 4) return false;
  const hasLocation = (finiteCoordinate(item?.latitude) && finiteCoordinate(item?.longitude))
    || cleanText(item?.venue).length >= 2
    || cleanText(item?.district).length >= 2
    || cleanText(item?.city).length >= 2;
  const hasActivity = !!(cleanText(item?.activityStart) || cleanText(item?.activityEnd) || cleanText(item?.signupDeadline));
  return hasLocation || hasActivity;
};

const getRecommendationKind = (item: any): 'place' | 'activity' => (
  item?.type === 'source' || item?.type === 'festival'
  || cleanText(item?.activityStart) || cleanText(item?.activityEnd) || cleanText(item?.signupDeadline)
) ? 'activity' : 'place';

const getMatchedExperienceKeys = (item: any, selections: string[]): string[] => {
  if (selections.includes('any')) return [];
  const haystack = [item?.title, item?.summary, item?.category, item?.feedCategory, item?.venue, item?.experienceTags]
    .map(cleanText).join(' ').toLowerCase();
  return selections.filter(key => haystack.includes(key.toLowerCase()) || OPTION_MAP.get(key)?.keywords.some(keyword => haystack.includes(keyword.toLowerCase())));
};

export const selectExploreRecommendations = (items: any[], selectionsInput: unknown) => {
  const selections = normalizeExploreSelections(selectionsInput);
  const ranked = items
    .filter(isExploreFeedItemComplete)
    .map((item, index) => {
      const matchedExperienceKeys = getMatchedExperienceKeys(item, selections);
      const intentScore = selections.includes('any') ? 0 : matchedExperienceKeys.length * 100;
      const parentBoost = item.type === 'parent' ? 15 : 0;
      return {
        ...item,
        matchedExperienceKeys,
        recommendationKind: getRecommendationKind(item),
        _rank: intentScore + parentBoost + Math.max(0, Math.min(5, Number(item.recommendScore) || 0)),
        _index: index,
      };
    })
    .sort((a, b) => b._rank - a._rank || a._index - b._index);

  if (ranked.length === 0) return [];
  const picked = [ranked[0]];
  const differentKind = ranked.slice(1).find(item => item.recommendationKind !== ranked[0].recommendationKind);
  if (differentKind) picked.push(differentKind);
  for (const item of ranked.slice(1)) {
    if (picked.length >= 3) break;
    if (!picked.some(pickedItem => pickedItem.id === item.id)) picked.push(item);
  }
  return picked.map(({ _rank, _index, ...item }, index) => ({
    ...item,
    recommendationRole: index === 0 ? 'primary' as const : 'alternative' as const,
  }));
};

export const getEnrichmentRetryAt = (createdAt: string, attempts: number): string | null => {
  const hours = [1, 6, 24][attempts];
  if (hours === undefined) return null;
  const base = new Date(createdAt);
  if (Number.isNaN(base.getTime())) return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  return new Date(base.getTime() + hours * 60 * 60 * 1000).toISOString();
};

const parseJsonArray = (value: unknown): string[] => {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.map(cleanText).filter(Boolean) : [];
  } catch {
    return [];
  }
};

const enabledOptionKeys = (disabledKeys: string[]) => new Set(
  [...OPTION_MAP.keys()].filter(key => key === 'any' || !disabledKeys.includes(key))
);

const getFamilyDisabledKeys = async (db: any, familyId: string): Promise<string[]> => {
  const row = await db.get('SELECT disabledOptionsJson FROM explore_experience_settings WHERE familyId = ?', familyId);
  return parseJsonArray(row?.disabledOptionsJson).filter(key => key !== 'any' && OPTION_MAP.has(key));
};

export const saveChildExploreIntent = async (db: any, familyId: string, childId: string, rawSelections: unknown) => {
  const child = await db.get("SELECT id FROM users WHERE id = ? AND familyId = ? AND role = 'child'", childId, familyId);
  if (!child) throw Object.assign(new Error('孩子不存在'), { statusCode: 404 });
  const disabledKeys = await getFamilyDisabledKeys(db, familyId);
  const selections = normalizeExploreSelections(rawSelections, enabledOptionKeys(disabledKeys));
  await db.run(
    `INSERT INTO explore_child_intents (childId, familyId, selectionsJson, updatedAt)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(childId) DO UPDATE SET familyId = excluded.familyId, selectionsJson = excluded.selectionsJson, updatedAt = CURRENT_TIMESTAMP`,
    childId, familyId, JSON.stringify(selections)
  );
  return selections;
};

export const getChildExploreIntent = async (db: any, familyId: string, childId: string) => {
  const disabledKeys = await getFamilyDisabledKeys(db, familyId);
  const row = await db.get('SELECT selectionsJson FROM explore_child_intents WHERE childId = ? AND familyId = ?', childId, familyId);
  const enabled = enabledOptionKeys(disabledKeys);
  let selections: string[];
  try {
    selections = normalizeExploreSelections(parseJsonArray(row?.selectionsJson).filter(key => enabled.has(key)), enabled);
  } catch {
    selections = ['any'];
  }
  return {
    selections,
    groups: EXPLORE_EXPERIENCE_GROUPS.map(group => ({
      ...group,
      options: group.options.filter(option => enabled.has(option.key)),
    })).filter(group => group.options.length > 0),
  };
};

export const registerExploreExperienceRoutes = (
  app: Express,
  getDb: () => any,
  protect: any,
  requireParent?: any,
  requireChild?: any
) => {
  const childGuards = requireChild ? [protect, requireChild] : [protect];
  const parentGuards = requireParent ? [protect, requireParent] : [protect];

  app.get('/api/child/explore/intents', ...childGuards, async (req: any, res: any) => {
    res.json(await getChildExploreIntent(getDb(), req.user.familyId, req.user.id));
  });

  app.put('/api/child/explore/intents', ...childGuards, async (req: any, res: any) => {
    try {
      const selections = await saveChildExploreIntent(getDb(), req.user.familyId, req.user.id, req.body?.selections);
      res.json({ message: '已经记住你想体验的内容', selections });
    } catch (error: any) {
      res.status(error?.statusCode || 400).json({ message: error?.message || '体验选择保存失败' });
    }
  });

  app.get('/api/parent/explore/intent-settings', ...parentGuards, async (req: any, res: any) => {
    const db = getDb();
    const disabledKeys = await getFamilyDisabledKeys(db, req.user.familyId);
    const children = await db.all(
      `SELECT u.id, u.name, i.selectionsJson
         FROM users u
         LEFT JOIN explore_child_intents i ON i.childId = u.id AND i.familyId = u.familyId
        WHERE u.familyId = ? AND u.role = 'child'
        ORDER BY u.createdAt ASC`,
      req.user.familyId
    );
    res.json({
      groups: EXPLORE_EXPERIENCE_GROUPS,
      disabledKeys,
      children: children.map((child: any) => ({
        id: child.id,
        name: child.name,
        selections: parseJsonArray(child.selectionsJson).filter(key => OPTION_MAP.has(key)),
      })),
    });
  });

  app.put('/api/parent/explore/intent-settings', ...parentGuards, async (req: any, res: any) => {
    const raw = Array.isArray(req.body?.disabledKeys) ? req.body.disabledKeys : [];
    const disabledKeys = [...new Set<string>(raw.map((item: unknown) => cleanText(item)).filter((key: string) => key !== 'any' && OPTION_MAP.has(key)))];
    await getDb().run(
      `INSERT INTO explore_experience_settings (familyId, disabledOptionsJson, updatedAt)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(familyId) DO UPDATE SET disabledOptionsJson = excluded.disabledOptionsJson, updatedAt = CURRENT_TIMESTAMP`,
      req.user.familyId, JSON.stringify(disabledKeys)
    );
    res.json({ message: '孩子端体验选项已更新', disabledKeys });
  });
};
