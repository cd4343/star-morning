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

// 探索地图一期：/api/child/explore/map-places 返回的地图标记数据
export type ExploreMapPlace = {
  id: string;
  title: string;
  category: string;
  status: string;
  latitude?: number | null;
  longitude?: number | null;
  checkinCount: number;
  lastCheckedInAt?: string;
  summary?: string;
  // 探索三期：来源发现卡的配图（地图抽屉顶部展示）
  imageUrl?: string | null;
  whyGo?: string;
  observeTips?: string;
  questionPrompts?: string;
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
  parentNote?: string;
  mediaCount?: number;
  parentVoiceCount?: number;
};

export type ExploreMedium = {
  id: string;
  checkinId: string;
  type: 'image' | 'audio';
  filePath: string;
  mimeType?: string;
  sizeBytes?: number;
  durationSeconds?: number;
  senderRole?: 'child' | 'parent';
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

// 探索改版③：回忆时间线
export type ExploreTimelineCheckin = {
  id: string;
  placeTitle: string;
  placeCategory: string;
  childName: string;
  mood?: string;
  note?: string;
  parentNote?: string;
  checkedInAt: string;
  media: ExploreMedium[];
};

export type ExploreTimelineMonth = {
  month: string;
  newPlaceCount: number;
  checkins: ExploreTimelineCheckin[];
};

// 探索二期（发现资讯流）：/api/child/explore/feed 卡片
export type ExploreFeedItem = {
  id: string;
  type: 'poi' | 'festival' | 'parent' | 'source';
  title: string;
  summary?: string | null;
  imageUrl?: string | null;
  category?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  sourceUrl?: string | null;
  status: string;
  recommendDate?: string;
  createdAt?: string;
};

export type ExploreFeedSource = {
  id: string;
  url: string;
  label?: string | null;
  lastFetchedAt?: string | null;
  createdAt?: string;
};

export type ExploreFeedSettings = {
  exploreCity: string;
  exploreFeedDailyLimit: number;
  exploreFeedCategories: string[] | null;
  // 探索三期：后端是否配置了高德 Web 服务 key（每日 POI 推荐开关）
  poiEnabled?: boolean;
  sources: ExploreFeedSource[];
  pendingReview: ExploreFeedItem[];
};

export type ExploreStats = {
  monthCheckinCount: number;
  visitedPlaceCount: number;
  categoryDistribution: { category: string; count: number }[];
  monthWantedCount: number;
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
