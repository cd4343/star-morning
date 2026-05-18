import { normalizeTaskCategory } from './taskCategories';
import { normalizeCompletionMode } from './taskCompletion';

export type TaskRewardSuggestion = {
  coins: number;
  xp: number;
  privilegePoints: number;
  title: string;
  basis: string;
  settlement: string;
};

type RewardInput = {
  minutes?: number | string | null;
  category?: string | null;
  completionMode?: string | null;
  targetValue?: number | string | null;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const roundToFive = (value: number) => Math.max(0, Math.round(value / 5) * 5);

const getMinutes = (value: RewardInput['minutes']) => clamp(Math.round(Number(value || 15) || 15), 1, 180);

export const getSuggestedTaskReward = (input: RewardInput): TaskRewardSuggestion => {
  const category = normalizeTaskCategory(input.category);
  const mode = normalizeCompletionMode(input.completionMode, category);
  const minutes = getMinutes(input.minutes);
  const targetValue = Math.max(0, Number(input.targetValue || 0) || 0);
  const targetSize = targetValue > 0 ? targetValue : minutes;

  if (category === '学习') {
    const coins = clamp(roundToFive(8 + Math.sqrt(minutes / 10) * 18), 10, 60);
    const xp = clamp(roundToFive(coins * 1.5), 15, 90);
    return {
      coins,
      xp,
      privilegePoints: minutes >= 45 ? 1 : 0,
      title: '学习奖励建议',
      basis: '金币适中，经验更高；重点奖励开始、坚持、求助和质量。',
      settlement: '结算时不奖励“做得越快”，主要看是否按小步完成、是否认真、是否需要过多提醒。',
    };
  }

  if (category === '生活') {
    const coins = clamp(roundToFive(4 + minutes * 0.55), 5, 25);
    const xp = clamp(roundToFive(coins * 1.15), 5, 35);
    return {
      coins,
      xp,
      privilegePoints: minutes >= 60 ? 1 : 0,
      title: '生活奖励建议',
      basis: '单次金币要小，连续稳定和独立完成比一次给很多更重要。',
      settlement: '结算时看结果是否可用、是否少提醒、是否逐步独立；速度只作拖延提醒，不做加分项。',
    };
  }

  if (category === '运动') {
    const sizeFactor = mode === 'count' ? Math.sqrt(Math.max(1, targetSize) / 30) : Math.sqrt(minutes / 10);
    const coins = clamp(roundToFive(7 + sizeFactor * 8), 10, 30);
    const xp = clamp(roundToFive(coins * 1.35), 15, 45);
    return {
      coins,
      xp,
      privilegePoints: 0,
      title: '运动奖励建议',
      basis: '不按效率快慢奖励，先奖励愿意动起来，再奖励参与完整和连续性。',
      settlement: '结算时看参与完整度、动作安全、强度是否适合；时间只是参与量参考。',
    };
  }

  if (category === '活动') {
    const coins = clamp(roundToFive(8 + Math.sqrt(minutes / 10) * 12), 10, 40);
    const xp = clamp(roundToFive(coins * 1.35), 15, 60);
    return {
      coins,
      xp,
      privilegePoints: minutes >= 45 ? 1 : 0,
      title: '活动奖励建议',
      basis: '活动更像探索和兴趣练习，经验可以高一点，金币保持中等。',
      settlement: '结算时看投入过程、约定成果和合作表达；不按完成快慢评价。',
    };
  }

  if (category === '情绪调节') {
    const coins = clamp(roundToFive(3 + Math.sqrt(minutes / 10) * 4), 0, 15);
    const xp = clamp(roundToFive(Math.max(5, coins * 2)), 10, 40);
    return {
      coins,
      xp,
      privilegePoints: 0,
      title: '情绪调节建议',
      basis: '情绪类更适合给经验、认可和复盘记录，金币保持很小，避免把情绪变成刷奖励。',
      settlement: '结算时看是否说出感受、是否用了冷静办法、恢复后能否表达需要。速度不作为评分依据。',
    };
  }

  const coins = clamp(roundToFive(6 + Math.sqrt(minutes / 10) * 10), 5, 35);
  return {
    coins,
    xp: clamp(roundToFive(coins * 1.15), 5, 45),
    privilegePoints: minutes >= 60 ? 1 : 0,
    title: '通用奖励建议',
    basis: '先明确这个任务训练什么，再决定金币和经验。',
    settlement: '结算时按约定目标、完成质量和提醒次数判断。',
  };
};
