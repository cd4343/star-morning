/**
 * 探索模块共享类型定义
 * 由 ChildExplore.tsx 和 ParentExplore.tsx 共同引用
 */

export type ExplorePlace = {
  id?: string;
  title: string;
  category: string;
  city?: string;
  address?: string;
  latitude?: number | null;
  longitude?: number | null;
  source?: string;
  externalId?: string;
  summary?: string;
  whyGo?: string;
  observeTips?: string;
  questionPrompts?: string;
  tags?: string;
  status?: string;
  checkinCount?: number;
  lastCheckedInAt?: string;
};

export type ExploreCheckin = {
  id: string;
  placeId?: string;
  placeTitle: string;
  placeCategory: string;
  childName?: string;
  mood: string;
  note?: string;
  checkedInAt: string;
  parentConfirmed?: number;
  mediaCount?: number;
};

export type ExploreMedium = {
  id: string;
  checkinId: string;
  type: 'image' | 'audio';
  filePath: string;
  mimeType?: string;
  sizeBytes?: number;
  durationSeconds?: number;
};

export const EXPLORE_CATEGORIES = ['博物馆', '自然', '公园', '城市', '活动', '旅行', '运动体验', '公益体验', '其他'] as const;
export const EXPLORE_MOODS = ['好奇', '开心', '勇敢', '惊喜', '有点累'] as const;

export const EXPLORE_CATEGORY_ICONS: Record<string, string> = {
  博物馆: '🏛️',
  自然: '🌿',
  公园: '🌳',
  城市: '🏙️',
  活动: '🎪',
  旅行: '🧳',
  运动体验: '🏃',
  公益体验: '🤝',
  其他: '📍'
};

// B4-07: 探索成就进度
export type ExploreAchievementProgress = {
  id: string;
  title: string;
  icon: string;
  conditionType: string;
  target: number;
  current: number;
  unlocked: boolean;
};
