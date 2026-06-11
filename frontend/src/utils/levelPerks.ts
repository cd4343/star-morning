// R3: 等级称号与权益里程碑表（纯展示，不对任何现有功能加门槛）
// TODO i18n: 称号与权益文案后续迁移到 t('key')

export type PerkStatus = 'active' | 'coming';

export interface PerkMilestone {
  level: number;
  title: string;
  desc: string;
  icon: string;
  status: PerkStatus;
}

// 称号锚点表：未列出的中间等级沿用上一档称号 + 罗马数字序号（如 Lv9 = 耀眼新星 II）
const LEVEL_TITLE_ANCHORS: ReadonlyArray<{ level: number; title: string }> = [
  { level: 1, title: '启程小星' },
  { level: 2, title: '微光' },
  { level: 3, title: '小火花' },
  { level: 4, title: '闪烁之星' },
  { level: 5, title: '小航星' },
  { level: 6, title: '晨光' },
  { level: 7, title: '探路星' },
  { level: 8, title: '耀眼新星' },
  { level: 10, title: '星际领航' },
  { level: 12, title: '星河船长' },
  { level: 15, title: '璀璨恒星' },
  { level: 20, title: '传说之星' },
];

const ROMAN_UNITS: ReadonlyArray<readonly [number, string]> = [
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

function toRoman(num: number): string {
  let remaining = Math.max(1, Math.floor(num));
  let result = '';
  for (const [value, symbol] of ROMAN_UNITS) {
    while (remaining >= value) {
      result += symbol;
      remaining -= value;
    }
  }
  return result;
}

// 等级称号：等级 = floor(xp / 100) + 1（与后端口径一致）
export function getLevelTitle(level: number): string {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  let anchor = LEVEL_TITLE_ANCHORS[0];
  for (const candidate of LEVEL_TITLE_ANCHORS) {
    if (candidate.level <= safeLevel) anchor = candidate;
    else break;
  }
  const offset = safeLevel - anchor.level;
  if (offset === 0) return anchor.title;
  return `${anchor.title} ${toRoman(offset + 1)}`;
}

// 权益里程碑：active = 已可用；coming = 预告（仅展示，不锁任何现有功能）
export const PERK_MILESTONES: ReadonlyArray<PerkMilestone> = [
  { level: 3, title: '背包转赠权', desc: '可以把背包里的物品转赠给家人', icon: '🎁', status: 'active' },
  { level: 5, title: '抽奖资格徽章', desc: '抽奖达人认证（你已经在用啦）', icon: '🎰', status: 'active' },
  { level: 8, title: '自选头像', desc: '即将到来', icon: '🖼️', status: 'coming' },
  { level: 10, title: '自主任务权', desc: '自己设计任务，请爸爸妈妈批准（即将到来）', icon: '📝', status: 'coming' },
  { level: 15, title: '周末自主计划权', desc: '即将到来', icon: '🗓️', status: 'coming' },
];
