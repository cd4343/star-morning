export type SystemAchievementDefinition = Readonly<{
  systemKey: string;
  title: string;
  description: string;
  displayTitleKey: string;
  displayDescriptionKey: string;
  iconKey: string;
  conditionType: string;
  conditionValue: number;
  conditionCategory?: string;
  category: string;
  legacyTitles: readonly string[];
}>;

const achievement = (
  systemKey: string,
  title: string,
  description: string,
  iconKey: string,
  conditionType: string,
  conditionValue: number,
  category: string,
  legacyTitle: string | readonly string[],
  conditionCategory?: string,
): SystemAchievementDefinition => Object.freeze({
  systemKey,
  title,
  description,
  displayTitleKey: `achievement.system.${systemKey}.title`,
  displayDescriptionKey: `achievement.system.${systemKey}.description`,
  iconKey,
  conditionType,
  conditionValue,
  ...(conditionCategory ? { conditionCategory } : {}),
  category,
  legacyTitles: Object.freeze(typeof legacyTitle === 'string' ? [legacyTitle] : [...legacyTitle]),
});

export const SYSTEM_ACHIEVEMENT_CATALOG: readonly SystemAchievementDefinition[] = Object.freeze([
  achievement('explore.checkin.1', '初次出发', '完成 1 次探索打卡', 'explore.first', 'explore_checkin_count', 1, '探索', '初次出发'),
  achievement('explore.checkin.5', '五站见闻', '完成 5 次探索打卡', 'explore.five', 'explore_checkin_count', 5, '探索', '见识在路上'),
  achievement('explore.checkin.10', '十次行走', '完成 10 次探索打卡', 'explore.ten', 'explore_checkin_count', 10, '探索', '行路少年'),
  achievement('explore.category.museum.1', '博物初见', '打卡 1 个博物馆', 'explore.museum-one', 'explore_category_count', 1, '探索', '博物初见', '博物馆'),
  achievement('explore.category.nature.3', '自然观察员', '打卡 3 个自然或公园地点', 'explore.nature-three', 'explore_category_count', 3, '探索', '自然观察员', '自然,公园'),
  achievement('explore.category.city.3', '城市发现家', '打卡 3 个城市地点', 'explore.city-three', 'explore_category_count', 3, '探索', '城市小旅人', '城市'),
  achievement('explore.voice.1', '勇敢开口', '留下 1 条语音留言', 'explore.voice-one', 'explore_voice_count', 1, '探索', '勇敢表达'),
  achievement('explore.photo.3', '光影记录员', '上传 3 次照片纪念', 'explore.photo-three', 'explore_media_count', 3, '探索', '小小记录家'),
  achievement('explore.confirmed.3', '亲子同行三站', '完成 3 次家长确认的探索', 'explore.family-three', 'explore_confirmed_count', 3, '探索', '亲子探索家'),
  achievement('explore.checkin.25', '探索足迹家', '完成 25 次探索打卡', 'explore.twenty-five', 'explore_checkin_count', 25, '探索', '探索老手'),
  achievement('explore.checkin.50', '城市远行者', '完成 50 次探索打卡', 'explore.fifty', 'explore_checkin_count', 50, '探索', '探索大师'),
  achievement('explore.category.museum.3', '博物馆常客', '打卡 3 个博物馆', 'explore.museum-three', 'explore_category_count', 3, '探索', '博物常客', '博物馆'),
  achievement('explore.category.museum.5', '博物小达人', '打卡 5 个博物馆', 'explore.museum-five', 'explore_category_count', 5, '探索', '博物达人', '博物馆'),
  achievement('explore.category.science.1', '科技初探', '打卡 1 个科技馆', 'explore.science-one', 'explore_category_count', 1, '探索', '科技初探', '科技馆'),
  achievement('explore.category.science.3', '科技实验家', '打卡 3 个科技馆', 'explore.science-three', 'explore_category_count', 3, '探索', '科技小达人', '科技馆'),
  achievement('explore.category.travel.3', '旅行小策划', '打卡 3 个旅行景点', 'explore.travel-three', 'explore_category_count', 3, '探索', '旅行小达人', '旅行'),
  achievement('explore.photo.10', '十次影像志', '上传 10 次照片纪念', 'explore.photo-ten', 'explore_media_count', 10, '探索', '记录小能手'),
  achievement('explore.voice.5', '小小讲述家', '留下 5 条语音留言', 'explore.voice-five', 'explore_voice_count', 5, '探索', '小小播音员'),
  achievement('explore.confirmed.10', '亲子探索十站', '完成 10 次家长确认的探索', 'explore.family-ten', 'explore_confirmed_count', 10, '探索', '亲子探索家·进阶'),
  achievement('explore.categories.5', '五类全能探索', '集齐 5 种不同类型场地各 1 次', 'explore.all-types', 'explore_distinct_categories', 5, '探索', '全能探索家'),
  achievement('explore.highlight.plan-first', '我的第一次出行计划', '自己规划并完成一次出行', 'explore.plan-first', 'manual', 0, '探索', '我的第一次出行计划'),
  achievement('explore.highlight.family-guide', '家庭小讲解员', '把探索学到的讲给家人听', 'explore.family-guide', 'manual', 0, '探索', '小讲解员'),
  achievement('explore.highlight.public-good', '公益体验星', '参与一次公益体验', 'explore.public-good', 'manual', 0, '探索', '公益小天使'),
  achievement('explore.highlight.outdoor', '户外挑战者', '完成一次有挑战的户外探索', 'explore.outdoor', 'manual', 0, '探索', '户外勇士'),
  achievement('task.count.1', '点亮第一步', '完成 1 个任务', 'task.first-step', 'task_count', 1, '启动', ['启程有光', '初来乍到']),
  achievement('task.count.10', '十步成行', '完成 10 个任务', 'task.ten-steps', 'task_count', 10, '启动', ['小步成章', '小小勤劳者']),
  achievement('task.count.50', '五十步成章', '完成 50 个任务', 'task.fifty', 'task_count', 50, '启动', ['百炼成章', '任务达人']),
  achievement('task.count.100', '百事小能手', '完成 100 个任务', 'task.hundred', 'task_count', 100, '启动', ['星路领航', '任务大师']),
  achievement('task.count.300', '星路长行', '完成 300 个任务', 'task.three-hundred', 'task_count', 300, '启动', '一路繁星'),
  achievement('streak.all.3', '三日不断线', '连续 3 天完成任务', 'streak.three', 'streak_days', 3, '坚持', '三天不断线'),
  achievement('streak.all.7', '一周守约', '连续 7 天完成任务', 'streak.week', 'streak_days', 7, '坚持', '一周节奏'),
  achievement('streak.all.21', '习惯发芽', '连续 21 天完成任务', 'streak.twenty-one', 'streak_days', 21, '坚持', '习惯成风'),
  achievement('streak.all.30', '月度稳行', '连续 30 天完成任务', 'streak.month', 'streak_days', 30, '坚持', '月满常新'),
  achievement('streak.all.60', '双月有恒', '连续 60 天完成任务', 'streak.sixty', 'streak_days', 60, '坚持', '久久为功'),
  achievement('streak.all.100', '百日长成', '连续 100 天完成任务', 'streak.hundred', 'streak_days', 100, '坚持', '百日如一'),
  achievement('life.count.1', '生活初上手', '完成 1 个生活任务', 'life.first', 'category_count', 1, '生活', '生活小帮手', '生活'),
  achievement('life.count.10', '自理小帮手', '完成 10 个生活任务', 'life.ten', 'category_count', 10, '生活', '自理有方', '生活'),
  achievement('life.count.30', '日常整理家', '完成 30 个生活任务', 'life.thirty', 'category_count', 30, '生活', '井井有条', '生活'),
  achievement('life.count.60', '家务小担当', '完成 60 个生活任务', 'life.sixty', 'category_count', 60, '生活', '家务担当', '生活'),
  achievement('life.count.100', '生活小管家', '完成 100 个生活任务', 'life.hundred', 'category_count', 100, '生活', '生活小管家', '生活'),
  achievement('life.streak.3', '三日小当家', '连续 3 天完成生活任务', 'life.streak-three', 'streak_days', 3, '生活', '三日小当家', '生活'),
  achievement('life.streak.7', '整洁一周星', '连续 7 天完成生活任务', 'life.streak-week', 'streak_days', 7, '生活', '整洁一周', '生活'),
  achievement('life.streak.21', '日常有序者', '连续 21 天完成生活任务', 'life.streak-twenty-one', 'streak_days', 21, '生活', '日常有序', '生活'),
  achievement('study.count.1', '学习启动星', '完成 1 个学习任务', 'study.first', 'category_count', 1, '学习', '学习启动', '学习'),
  achievement('study.count.10', '专注小苗', '完成 10 个学习任务', 'study.ten', 'category_count', 10, '学习', '专注小苗', '学习'),
  achievement('study.count.30', '作业小闯将', '完成 30 个学习任务', 'study.thirty', 'category_count', 30, '学习', '作业小闯将', '学习'),
  achievement('study.count.60', '学海拾贝者', '完成 60 个学习任务', 'study.sixty', 'category_count', 60, '学习', '学海拾贝', '学习'),
  achievement('study.count.100', '求知小灯塔', '完成 100 个学习任务', 'study.hundred', 'category_count', 100, '学习', '求知小灯塔', '学习'),
  achievement('study.streak.3', '三日书声', '连续 3 天完成学习任务', 'study.streak-three', 'streak_days', 3, '学习', '三日书声', '学习'),
  achievement('study.streak.7', '七日勤学星', '连续 7 天完成学习任务', 'study.streak-week', 'streak_days', 7, '学习', '学习一周星', '学习'),
  achievement('study.streak.21', '书声常伴', '连续 21 天完成学习任务', 'study.streak-twenty-one', 'streak_days', 21, '学习', '书声不断', '学习'),
  achievement('sport.count.1', '活力初启动', '完成 1 个运动任务', 'sport.first', 'category_count', 1, '运动', '动起来', '运动'),
  achievement('sport.count.10', '运动小火苗', '完成 10 个运动任务', 'sport.ten', 'category_count', 10, '运动', '活力小步', '运动'),
  achievement('sport.count.30', '活力小健将', '完成 30 个运动任务', 'sport.thirty', 'category_count', 30, '运动', '运动小将', '运动'),
  achievement('sport.count.60', '体能守护者', '完成 60 个运动任务', 'sport.sixty', 'category_count', 60, '运动', '体能守护者', '运动'),
  achievement('sport.count.100', '强健领跑星', '完成 100 个运动任务', 'sport.hundred', 'category_count', 100, '运动', '强健之星', '运动'),
  achievement('sport.streak.3', '连动三天', '连续 3 天完成运动任务', 'sport.streak-three', 'streak_days', 3, '运动', '连动三天', '运动'),
  achievement('sport.streak.7', '活力七日行', '连续 7 天完成运动任务', 'sport.streak-week', 'streak_days', 7, '运动', '活力一周', '运动'),
  achievement('sport.streak.21', '元气常在者', '连续 21 天完成运动任务', 'sport.streak-twenty-one', 'streak_days', 21, '运动', '元气常在', '运动'),
  achievement('activity.count.1', '兴趣初发现', '完成 1 个活动任务', 'activity.first', 'category_count', 1, '活动', '探索新事物', '活动'),
  achievement('activity.count.10', '灵感练习生', '完成 10 个活动任务', 'activity.ten', 'category_count', 10, '活动', '兴趣练习者', '活动'),
  achievement('activity.count.30', '创意小工匠', '完成 30 个活动任务', 'activity.thirty', 'category_count', 30, '活动', '灵感小匠', '活动'),
  achievement('activity.count.60', '小小创作者', '完成 60 个活动任务', 'activity.sixty', 'category_count', 60, '活动', '小小创作者', '活动'),
  achievement('activity.count.100', '创意满格家', '完成 100 个活动任务', 'activity.hundred', 'category_count', 100, '活动', '创意满格', '活动'),
  achievement('activity.streak.7', '兴趣七日行', '连续 7 天完成活动任务', 'activity.streak-week', 'streak_days', 7, '活动', '活动坚持星', '活动'),
  achievement('activity.streak.21', '艺海拾光者', '连续 21 天完成活动任务', 'activity.streak-twenty-one', 'streak_days', 21, '活动', '艺海拾光', '活动'),
  achievement('emotion.voice', '听见心声', '能说出自己现在的感受', 'emotion.voice', 'manual', 0, '情绪', '会说感受'),
  achievement('emotion.calm', '冷静有方法', '尝试一次冷静动作', 'emotion.calm', 'manual', 0, '情绪', '冷静有方'),
  achievement('emotion.help', '求助真勇敢', '卡住时能主动求助', 'emotion.help', 'manual', 0, '情绪', '求助很勇敢'),
  achievement('saving.coins.100', '百币小储蓄家', '获得 100 金币', 'saving.hundred', 'coin_count', 100, '金币', ['积少成多', '小小存钱罐']),
  achievement('saving.coins.500', '五百聚沙者', '获得 500 金币', 'saving.five-hundred', 'coin_count', 500, '金币', ['聚沙成塔', '财富小能手']),
  achievement('saving.coins.1000', '千币小金库', '获得 1000 金币', 'saving.thousand', 'coin_count', 1000, '金币', ['家财万贯', '金币大亨']),
  achievement('saving.coins.3000', '三千规划家', '获得 3000 金币', 'saving.three-thousand', 'coin_count', 3000, '金币', '富足有方'),
  achievement('saving.coins.5000', '五千梦想仓', '获得 5000 金币', 'saving.five-thousand', 'coin_count', 5000, '金币', '星河宝藏'),
  achievement('saving.coins.10000', '万币目标家', '获得 10000 金币', 'saving.ten-thousand', 'coin_count', 10000, '金币', '丰盈之库'),
  achievement('level.reach.2', '微光启程', '达到 Lv.2', 'level.two', 'level_reach', 2, '成长', '初露锋芒'),
  achievement('level.reach.5', '星芽成长', '达到 Lv.5', 'level.five', 'level_reach', 5, '成长', '成长之路'),
  achievement('level.reach.10', '星路进阶', '达到 Lv.10', 'level.ten', 'level_reach', 10, '成长', '进阶高手'),
  achievement('level.reach.20', '恒星闪耀', '达到 Lv.20', 'level.twenty', 'level_reach', 20, '成长', '闪耀成长'),
  achievement('level.reach.30', '星河领航', '达到 Lv.30', 'level.thirty', 'level_reach', 30, '成长', '登峰造极'),
  achievement('character.polite', '礼貌表达星', '能用礼貌的话表达需要', 'character.polite', 'manual', 0, '品格', '礼貌小天使'),
  achievement('character.helpful', '热心小帮手', '主动帮助别人一次', 'character.helpful', 'manual', 0, '品格', '乐于助人'),
  achievement('character.honest', '诚实守约者', '遇到问题能诚实说明', 'character.honest', 'manual', 0, '品格', '诚实守信'),
  achievement('family.helper', '家庭搭把手', '主动为家里做一件小事', 'family.helper', 'manual', 0, '家庭', '家庭小帮手'),
  achievement('family.cooperate', '同心合作星', '和家人合作完成一件事', 'family.cooperate', 'manual', 0, '家庭', '合作之星'),
  achievement('family.promise', '约定守护者', '遵守一次家庭约定', 'family.promise', 'manual', 0, '家庭', '约定守护者'),
  achievement('life.highlight.independent', '独立完成第一步', '不用任何帮助独立完成一件家务', 'life.independent', 'manual', 0, '生活', '第一次独立完成'),
  achievement('life.highlight.extra-step', '主动加一步', '没人要求，主动帮家里做了额外的事', 'life.extra-step', 'manual', 0, '生活', '主动多做一件'),
  achievement('study.highlight.self-correct', '发现错误小侦探', '检查作业时自己找出并改正了错误', 'study.self-correct', 'manual', 0, '学习', '自己发现错误'),
  achievement('study.highlight.teach', '分享知识小老师', '把学会的东西讲给家人听懂', 'study.teach', 'manual', 0, '学习', '教会别人一次'),
  achievement('sport.highlight.finish', '坚持到底小健将', '很累但坚持完成了整场运动', 'sport.finish', 'manual', 0, '运动', '坚持到最后'),
  achievement('growth.try-again', '再试一次小勇士', '失败后没放弃，重新尝试', 'growth.try-again', 'manual', 0, '成长', '勇敢再试一次'),
]);

const assertUnique = (label: string, values: readonly string[]) => {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value.trim()) throw new Error(`System achievement ${label} cannot be empty`);
    if (seen.has(value)) throw new Error(`Duplicate system achievement ${label}: ${value}`);
    seen.add(value);
  }
};

if (SYSTEM_ACHIEVEMENT_CATALOG.length !== 92) {
  throw new Error(`Expected 92 system achievements, received ${SYSTEM_ACHIEVEMENT_CATALOG.length}`);
}
assertUnique('systemKey', SYSTEM_ACHIEVEMENT_CATALOG.map(item => item.systemKey));
assertUnique('title', SYSTEM_ACHIEVEMENT_CATALOG.map(item => item.title));
assertUnique('iconKey', SYSTEM_ACHIEVEMENT_CATALOG.map(item => item.iconKey));

const SYSTEM_ACHIEVEMENT_BY_KEY = new Map(
  SYSTEM_ACHIEVEMENT_CATALOG.map(item => [item.systemKey, item] as const),
);

type AchievementConditionIdentity = Pick<
  SystemAchievementDefinition,
  'conditionType' | 'conditionValue' | 'conditionCategory'
>;

export const getAchievementLegacySignature = (item: AchievementConditionIdentity) => [
  item.conditionType,
  item.conditionValue,
  item.conditionCategory || '',
].join('|');

const SYSTEM_ACHIEVEMENTS_BY_LEGACY_SIGNATURE = new Map<string, readonly SystemAchievementDefinition[]>();
for (const item of SYSTEM_ACHIEVEMENT_CATALOG) {
  const signature = getAchievementLegacySignature(item);
  const matches = SYSTEM_ACHIEVEMENTS_BY_LEGACY_SIGNATURE.get(signature) || [];
  SYSTEM_ACHIEVEMENTS_BY_LEGACY_SIGNATURE.set(signature, Object.freeze([...matches, item]));
}

export const getSystemAchievementByKey = (systemKey: string) => (
  SYSTEM_ACHIEVEMENT_BY_KEY.get(systemKey)
);

export const getSystemAchievementsByLegacySignature = (item: AchievementConditionIdentity) => (
  SYSTEM_ACHIEVEMENTS_BY_LEGACY_SIGNATURE.get(getAchievementLegacySignature(item)) || []
);
