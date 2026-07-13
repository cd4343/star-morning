export type AchievementLike = {
  title?: string;
  description?: string;
  icon?: string;
  systemKey?: string | null;
  isSystem?: boolean;
  iconKey?: string | null;
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
    case 'task_count': return `完成 ${value} 个任务`;
    case 'coin_count': return `获得 ${value} 金币`;
    case 'xp_count': return `获得 ${value} 经验`;
    case 'level_reach': return `达到 Lv.${value}`;
    case 'category_count': return `完成 ${value} 个${category || '指定'}任务`;
    case 'streak_days': return category && category !== '其他' ? `连续 ${value} 天${category}` : `连续 ${value} 天`;
    case 'explore_checkin_count': return `完成 ${value} 次探索打卡`;
    case 'explore_category_count': return `打卡 ${value} 个${category || '探索'}地点`;
    case 'explore_media_count': return `上传 ${value} 次照片纪念`;
    case 'explore_voice_count': return `留下 ${value} 条语音留言`;
    case 'explore_confirmed_count': return `完成 ${value} 次家长确认探索`;
    default: return item.description || '家长确认解锁';
  }
};

export const getAchievementDisplay = (item: AchievementLike) => {
  const rank = getAchievementRank(item);
  return {
    title: item.displayTitle || item.title || '',
    description: item.displayDescription || item.description || getAchievementConditionDescription(item),
    icon: item.displayIcon || item.icon || rank.icon,
    iconKey: item.iconKey || null,
    isSystem: Boolean(item.isSystem),
    rank,
  };
};
