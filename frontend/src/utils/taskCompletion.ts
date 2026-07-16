import { normalizeTaskCategory } from './taskCategories';

export type TaskCompletionMode = 'timer' | 'participation' | 'count' | 'checklist';

export type TaskCompletionLike = {
  category?: string | null;
  completionMode?: string | null;
  targetValue?: number | string | null;
  targetUnit?: string | null;
  reviewFocus?: string | null;
  durationMinutes?: number | string | null;
  duration?: number | string | null;
};

export const TASK_COMPLETION_MODE_OPTIONS: Array<{
  value: TaskCompletionMode;
  label: string;
  parentDesc: string;
  childHint: string;
}> = [
  {
    value: 'timer',
    label: '计时完成',
    parentDesc: '适合需要记录开始和结束的任务。学习和生活类里，时间主要看节奏，不鼓励“越快越好”。',
    childHint: '按开始和结束记录时间，做完后提交给家长确认。',
  },
  {
    value: 'participation',
    label: '参与完成',
    parentDesc: '适合运动和活动。看参与完整度、动作安全和投入，不奖励“越快越好”。',
    childHint: '重点是参与到位，不是和时间赛跑。',
  },
  {
    value: 'count',
    label: '数量完成',
    parentDesc: '适合跳绳、仰卧起坐、朗读遍数等有明确数量的任务。',
    childHint: '完成约定数量后提交，时间只作记录。',
  },
  {
    value: 'checklist',
    label: '清单完成',
    parentDesc: '适合分步骤任务。孩子完成关键动作，家长按清单确认。',
    childHint: '照着清单一步步完成，不需要一下子全想起来。',
  },
];

export const getRecommendedCompletionMode = (category?: string | null): TaskCompletionMode => {
  const normalized = normalizeTaskCategory(category);
  if (normalized === '运动' || normalized === '活动' || normalized === '情绪调节') return 'participation';
  return 'timer';
};

export const normalizeCompletionMode = (mode?: string | null, category?: string | null): TaskCompletionMode => {
  if (mode === 'timer' || mode === 'participation' || mode === 'count' || mode === 'checklist') return mode;
  return getRecommendedCompletionMode(category);
};

export const getCompletionModeInfo = (mode?: string | null, category?: string | null) => {
  const normalized = normalizeCompletionMode(mode, category);
  return TASK_COMPLETION_MODE_OPTIONS.find(item => item.value === normalized) || TASK_COMPLETION_MODE_OPTIONS[0];
};

export const getDefaultTargetUnit = (mode: TaskCompletionMode, category?: string | null) => {
  const normalized = normalizeTaskCategory(category);
  if (mode === 'count') return normalized === '运动' ? '个/组' : '项';
  if (mode === 'checklist') return '项';
  if (normalized === '情绪调节') return '次/步骤';
  if (mode === 'participation') return normalized === '运动' ? '分钟/组' : '分钟/次';
  return '分钟';
};

export const getDefaultReviewFocus = (mode: TaskCompletionMode, category?: string | null) => {
  const normalized = normalizeTaskCategory(category);
  if (normalized === '运动') return '参与完整、动作安全、愿意开始';
  if (normalized === '活动') return '投入过程、完成约定、合作表达';
  if (normalized === '情绪调节') return '识别感受、使用冷静方法、恢复后表达';
  if (normalized === '学习') return '开始及时、质量认真、少量提醒';
  if (normalized === '生活') return '动作完成、结果可用、逐步独立';
  if (mode === 'checklist') return '关键步骤是否完成';
  return '按约定完成';
};

export const getTaskCompletionSummary = (task: TaskCompletionLike) => {
  const mode = normalizeCompletionMode(task.completionMode, task.category);
  const info = getCompletionModeInfo(mode, task.category);
  const targetValue = Number(task.targetValue || 0);
  const duration = Number(task.durationMinutes ?? task.duration ?? 0);
  const unit = String(task.targetUnit || getDefaultTargetUnit(mode, task.category));
  const reviewFocus = String(task.reviewFocus || getDefaultReviewFocus(mode, task.category));
  const targetText = targetValue > 0 ? `${targetValue}${unit}` : duration > 0 ? `${duration}分钟` : '按约定';

  if (mode === 'timer') {
    return {
      mode,
      label: info.label,
      targetText: duration > 0 ? `${duration}分钟` : '按预计时间',
      childHint: info.childHint,
      reviewFocus,
    };
  }

  if (mode === 'count') {
    return {
      mode,
      label: info.label,
      targetText,
      childHint: '完成约定数量后提交，家长看数量和动作质量。',
      reviewFocus,
    };
  }

  if (mode === 'checklist') {
    return {
      mode,
      label: info.label,
      targetText,
      childHint: '按步骤完成，家长看关键步骤有没有做到。',
      reviewFocus,
    };
  }

  return {
    mode,
    label: info.label,
    targetText,
    childHint: info.childHint,
    reviewFocus,
  };
};
