export type AchievementLike = {
  title?: string;
  description?: string;
  icon?: string;
  displayTitle?: string;
  displayDescription?: string;
  displayIcon?: string;
  rankLabel?: string;
  rankIcon?: string;
  rankOrder?: number;
  conditionType?: string;
  conditionValue?: number;
  conditionCategory?: string;
  category?: string;
};

const RANKS = [
  { label: '青铜', icon: '🥉', order: 1 },
  { label: '白银', icon: '🥈', order: 2 },
  { label: '黄金', icon: '🥇', order: 3 },
  { label: '铂金', icon: '💠', order: 4 },
  { label: '钻石', icon: '💎', order: 5 },
  { label: '王者', icon: '👑', order: 6 },
];

const THEMES: Record<string, Array<{ title: string; icon: string }>> = {
  task_count: [
    { title: '启程有光', icon: '🌱' },
    { title: '小步成章', icon: '🧭' },
    { title: '稳步前行', icon: '🚩' },
    { title: '百炼成章', icon: '🏆' },
    { title: '星路领航', icon: '🌟' },
    { title: '一路繁星', icon: '✨' },
  ],
  coin_count: [
    { title: '积少成多', icon: '🪙' },
    { title: '聚沙成塔', icon: '💰' },
    { title: '家财万贯', icon: '🏦' },
    { title: '富足有方', icon: '💎' },
    { title: '星河宝藏', icon: '🎁' },
    { title: '丰盈之库', icon: '👑' },
  ],
  growth: [
    { title: '初露锋芒', icon: '⭐' },
    { title: '渐入佳境', icon: '📈' },
    { title: '步步高升', icon: '🚀' },
    { title: '独当一面', icon: '🏅' },
    { title: '光芒万丈', icon: '🌟' },
    { title: '登峰造极', icon: '👑' },
  ],
  streak: [
    { title: '三日成习', icon: '📅' },
    { title: '一周有恒', icon: '🗓️' },
    { title: '习惯成风', icon: '💯' },
    { title: '月满常新', icon: '⚡' },
    { title: '久久为功', icon: '🔥' },
    { title: '百日如一', icon: '🎊' },
  ],
  生活: [
    { title: '井井有条', icon: '🧹' },
    { title: '自理有方', icon: '🛏️' },
    { title: '家务能手', icon: '🧺' },
    { title: '生活掌舵', icon: '🍽️' },
    { title: '日常小管家', icon: '🏠' },
    { title: '烟火小主人', icon: '🌤️' },
  ],
  学习: [
    { title: '开卷有益', icon: '📖' },
    { title: '勤学不倦', icon: '✏️' },
    { title: '学海拾贝', icon: '📚' },
    { title: '思路清亮', icon: '🔢' },
    { title: '博学笃行', icon: '🔬' },
    { title: '文思泉涌', icon: '🎓' },
  ],
  运动: [
    { title: '动若晨光', icon: '🏃' },
    { title: '活力满格', icon: '⚽' },
    { title: '身轻如燕', icon: '🏸' },
    { title: '元气奔跑', icon: '🚴' },
    { title: '风驰少年', icon: '🏅' },
    { title: '强健之星', icon: '💪' },
  ],
  活动: [
    { title: '妙趣初探', icon: '🎹' },
    { title: '灵感小匠', icon: '🎨' },
    { title: '兴味盎然', icon: '🎸' },
    { title: '艺海拾光', icon: '🎤' },
    { title: '创意满格', icon: '✨' },
    { title: '小小策展人', icon: '🌈' },
  ],
  情绪: [
    { title: '心声可见', icon: '💝' },
    { title: '冷静有方', icon: '🤫' },
    { title: '情绪复原', icon: '🍀' },
    { title: '表达清亮', icon: '🗣️' },
    { title: '内心有光', icon: '🌤️' },
    { title: '从容自如', icon: '🌈' },
  ],
  品格: [
    { title: '温言有礼', icon: '😊' },
    { title: '乐于相助', icon: '🤝' },
    { title: '心怀感谢', icon: '🙏' },
    { title: '诚实有信', icon: '🦁' },
    { title: '勇敢担当', icon: '🦸' },
    { title: '品格闪光', icon: '🌟' },
  ],
  家庭: [
    { title: '家中小手', icon: '🏠' },
    { title: '分担有心', icon: '🧺' },
    { title: '合作同心', icon: '🤝' },
    { title: '约定守护', icon: '🎯' },
    { title: '家庭星光', icon: '✨' },
    { title: '温暖同行', icon: '💝' },
  ],
  default: [
    { title: '小有收获', icon: '🏅' },
    { title: '渐有章法', icon: '🎯' },
    { title: '稳稳向前', icon: '🚩' },
    { title: '光芒初现', icon: '🌟' },
    { title: '一路闪耀', icon: '✨' },
    { title: '星河在握', icon: '👑' },
  ],
};

const getThresholds = (type?: string) => {
  if (type === 'streak_days') return [3, 7, 21, 30, 60, 100];
  if (type === 'coin_count') return [100, 500, 1000, 3000, 5000, 10000];
  if (type === 'level_reach') return [2, 5, 10, 15, 20, 30];
  return [1, 10, 20, 50, 100, 300];
};

const getRankIndex = (item: AchievementLike) => {
  const value = Number(item.conditionValue || 0);
  let index = 0;
  getThresholds(item.conditionType).forEach((threshold, i) => {
    if (value >= threshold) index = i;
  });
  return index;
};

const getThemeKey = (item: AchievementLike) => {
  if (item.conditionType === 'task_count') return 'task_count';
  if (item.conditionType === 'coin_count') return 'coin_count';
  if (item.conditionType === 'xp_count' || item.conditionType === 'level_reach') return 'growth';
  if (item.conditionType === 'streak_days') return 'streak';
  if (item.conditionType === 'category_count') return item.conditionCategory || item.category || 'default';
  return item.category || 'default';
};

export const getAchievementRank = (item: AchievementLike) => {
  if (item.rankLabel) {
    return {
      label: item.rankLabel,
      icon: item.rankIcon || '🏅',
      order: Number(item.rankOrder || 99),
    };
  }
  if (item.conditionType === 'manual') {
    return { label: '专属', icon: item.icon || '🎖️', order: 99 };
  }
  return RANKS[getRankIndex(item)] || RANKS[0];
};

export const getAchievementConditionDescription = (item: AchievementLike) => {
  const value = Number(item.conditionValue || 0);
  const category = item.conditionCategory || item.category || '';
  switch (item.conditionType) {
    case 'task_count':
      return `完成 ${value} 个任务`;
    case 'coin_count':
      return `获得 ${value} 金币`;
    case 'xp_count':
      return `获得 ${value} 经验`;
    case 'level_reach':
      return `达到 Lv.${value}`;
    case 'category_count':
      return `完成 ${value} 个${category || '指定'}任务`;
    case 'streak_days':
      return category && category !== '其他' ? `连续 ${value} 天${category}` : `连续 ${value} 天`;
    default:
      return item.description || '家长确认解锁';
  }
};

export const getAchievementDisplay = (item: AchievementLike) => {
  const rank = getAchievementRank(item);
  if (item.conditionType === 'manual') {
    return {
      title: item.displayTitle || item.title || '专属成就',
      description: item.displayDescription || item.description || '家长确认解锁',
      icon: item.displayIcon || item.icon || rank.icon,
      rank,
    };
  }

  const rankIndex = Math.max(0, Math.min(5, (rank.order || 1) - 1));
  const theme = THEMES[getThemeKey(item)] || THEMES.default;
  const picked = theme[rankIndex] || theme[0] || THEMES.default[0];
  const providedTitle = String(item.displayTitle || '');
  const providedIcon = String(item.displayIcon || '');
  const isOldRankTitle = RANKS.some(rankItem => providedTitle.includes(rankItem.label));
  const isOldRankIcon = RANKS.some(rankItem => rankItem.icon === providedIcon);

  return {
    title: providedTitle && !isOldRankTitle ? providedTitle : picked.title,
    description: item.displayDescription || getAchievementConditionDescription(item),
    icon: providedIcon && !isOldRankIcon ? providedIcon : picked.icon,
    rank,
  };
};
