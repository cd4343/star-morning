/**
 * 商店 / 储蓄 / 抽奖 / 背包 / 特权共享类型定义
 * 由 ChildWishes.tsx 和 ParentWishes.tsx 共同引用
 * 字段以后端实际返回为准，未确认的字段保持可选
 */

export type WishType = 'shop' | 'savings' | 'lottery';

export type WishRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export type LotteryEffectType = 'normal' | 'draw_again' | 'bonus_coins' | 'bonus_xp' | 'bonus_privilege';

export type Wish = {
  id: string;
  title: string;
  icon?: string;
  type?: WishType;
  description?: string;
  category?: string | null;
  cost: number;
  costType?: 'coins' | 'privilegePoints' | string;
  stock?: number;
  rarity?: WishRarity | null;
  effectType?: LotteryEffectType | string | null;
  weight?: number;
  currentAmount?: number;
  targetAmount?: number;
  isActive?: number | boolean;
  isSystemDefault?: number | boolean;
  timeWindow?: string | null;
};

export type InventoryItem = {
  id: string;
  title: string;
  icon?: string;
  status?: 'pending' | 'redeemed' | 'cancelled' | string;
  source?: string;
  cost?: number;
  costType?: 'coins' | 'privilegePoints' | string;
  effectType?: string | null;
  timeWindow?: string | null;
  acquiredAt: string;
  rewardCoins?: number;
  rewardXp?: number;
  rewardPrivilegePoints?: number;
};

export type Privilege = {
  id: string;
  title: string;
  icon?: string;
  description?: string;
  cost: number;
  level?: string;
  timeWindow?: string | null;
};
