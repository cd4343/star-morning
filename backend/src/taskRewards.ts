export type TaskCompletionMode = 'timer' | 'participation' | 'count' | 'checklist';
export type TaskRewardCategory = '生活' | '学习' | '运动' | '活动' | '情绪调节' | '其他';

type RewardInput = {
  minutes?: number | string | null;
  category?: string | null;
  completionMode?: string | null;
  targetValue?: number | string | null;
  resistance?: string | null;
};

export type TaskRewardSuggestion = {
  coins: number;
  xp: number;
  privilegePoints: number;
  title: string;
  basis: string;
  settlement: string;
};

const CATEGORY_ALIASES: Record<TaskRewardCategory, string[]> = {
  生活: ['生活', '劳动', '生活习惯', '日常', '家务', '早晨启动', '晨间启动'],
  学习: ['学习', '学业', '阅读', '晨读', '早晨复习', '起床复习'],
  运动: ['运动', '锻炼', '体育'],
  活动: ['活动', '兴趣', '艺术', '亲子', '项目'],
  情绪调节: ['情绪调节', '情绪', '冷静', '冷静练习', '情绪自助'],
  其他: ['其他', '协作', '合作', '未分类'],
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const normalizeRewardCategory = (value?: string | null): TaskRewardCategory => {
  const raw = String(value || '').trim();
  if ((Object.keys(CATEGORY_ALIASES) as TaskRewardCategory[]).includes(raw as TaskRewardCategory)) {
    return raw as TaskRewardCategory;
  }
  const hit = (Object.entries(CATEGORY_ALIASES) as Array<[TaskRewardCategory, string[]]>)
    .find(([, aliases]) => aliases.includes(raw));
  return hit?.[0] || '其他';
};

export const normalizeRewardCompletionMode = (mode?: string | null, category?: string | null): TaskCompletionMode => {
  if (mode === 'timer' || mode === 'participation' || mode === 'count' || mode === 'checklist') return mode;
  const normalized = normalizeRewardCategory(category);
  return normalized === '运动' || normalized === '活动' || normalized === '情绪调节' ? 'participation' : 'timer';
};

const getMinutes = (value: RewardInput['minutes']) => clamp(Math.round(Number(value || 15) || 15), 1, 180);

// R1 经济锚点：任务建议价 = 基准(10分钟=10金币) × 时长系数(√(分钟/10)) × 抗拒系数(轻松0.8/普通1.0/勇气1.3)
export type TaskResistanceLevel = '轻松' | '普通' | '勇气';

const RESISTANCE_FACTORS: Record<TaskResistanceLevel, number> = { 轻松: 0.8, 普通: 1, 勇气: 1.3 };

// 未显式指定抗拒程度时按类别推断：学习对孩子是「勇气工作」，生活/情绪调节保持轻量
const CATEGORY_DEFAULT_RESISTANCE: Record<TaskRewardCategory, TaskResistanceLevel> = {
  生活: '轻松',
  学习: '勇气',
  运动: '普通',
  活动: '普通',
  情绪调节: '轻松',
  其他: '普通',
};

export const normalizeRewardResistance = (value?: string | null, category?: string | null): TaskResistanceLevel => {
  const raw = String(value || '').trim();
  if (raw === '轻松' || raw === '普通' || raw === '勇气') return raw;
  if (raw === 'easy' || raw === 'light') return '轻松';
  if (raw === 'normal' || raw === 'medium') return '普通';
  if (raw === 'courage' || raw === 'hard' || raw === 'brave') return '勇气';
  return CATEGORY_DEFAULT_RESISTANCE[normalizeRewardCategory(category)];
};

// 金币统一走锚点公式；各类别保留自己的经验倍率、特权点门槛与结算口径说明
const CATEGORY_PROFILES: Record<TaskRewardCategory, { xpFactor: number; privilegeMinutes: number | null; title: string; settlement: string }> = {
  学习: {
    xpFactor: 1.5,
    privilegeMinutes: 45,
    title: '学习奖励建议',
    settlement: '结算时不奖励“做得越快”，主要看是否按小步完成、是否认真、是否需要过多提醒。',
  },
  生活: {
    xpFactor: 1.15,
    privilegeMinutes: 60,
    title: '生活奖励建议',
    settlement: '结算时看结果是否可用、是否少提醒、是否逐步独立；速度只作拖延提醒，不做加分项。',
  },
  运动: {
    xpFactor: 1.35,
    privilegeMinutes: null,
    title: '运动奖励建议',
    settlement: '结算时看参与完整度、动作安全、强度是否适合；时间只是参与量参考。',
  },
  活动: {
    xpFactor: 1.35,
    privilegeMinutes: 45,
    title: '活动奖励建议',
    settlement: '结算时看投入过程、约定成果和合作表达；不按完成快慢评价。',
  },
  情绪调节: {
    xpFactor: 2,
    privilegeMinutes: null,
    title: '情绪调节建议',
    settlement: '结算时看是否说出感受、是否用了冷静办法、恢复后能否表达需要。速度不作为评分依据。',
  },
  其他: {
    xpFactor: 1.15,
    privilegeMinutes: 60,
    title: '通用奖励建议',
    settlement: '结算时按约定目标、完成质量和提醒次数判断。',
  },
};

export const getTaskRewardSuggestion = (input: RewardInput): TaskRewardSuggestion => {
  const category = normalizeRewardCategory(input.category);
  const minutes = getMinutes(input.minutes);
  const resistance = normalizeRewardResistance(input.resistance, category);
  const factor = RESISTANCE_FACTORS[resistance];
  const profile = CATEGORY_PROFILES[category];

  // 整数金币：时长开方防止“刷时长”，抗拒系数奖励勇气工作，四舍五入且至少 1
  const coins = Math.max(1, Math.round(10 * Math.sqrt(minutes / 10) * factor));
  const xp = Math.max(1, Math.round(coins * profile.xpFactor));

  return {
    coins,
    xp,
    privilegePoints: profile.privilegeMinutes !== null && minutes >= profile.privilegeMinutes ? 1 : 0,
    title: profile.title,
    basis: `基准10分钟=10金币 × 时长系数√(${minutes}/10) × ${resistance}系数${factor} ≈ ${coins}金币`,
    settlement: profile.settlement,
  };
};
