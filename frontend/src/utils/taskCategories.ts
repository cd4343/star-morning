export type TaskCategoryKey = '生活' | '学习' | '早晨启动' | '运动' | '活动' | '情绪调节' | '其他';

export const TASK_CATEGORY_OPTIONS: Array<{
  value: TaskCategoryKey;
  icon: string;
  label: string;
  parentDesc: string;
  childHint: string;
  aliases: string[];
}> = [
  {
    value: '生活',
    icon: '🌱',
    label: '生活',
    parentDesc: '自理、卫生、整理、家务和日常习惯。目标是让生活更稳定，不建议单次奖励过高。',
    childHint: '让今天更顺一点的小动作。',
    aliases: ['劳动', '生活习惯', '日常', '家务'],
  },
  {
    value: '学习',
    icon: '📚',
    label: '学习',
    parentDesc: '作业、阅读、复习、背诵、练字等需要专注和认知投入的任务。',
    childHint: '先开始一小步，不用一下子做完全部。',
    aliases: ['学业', '阅读'],
  },
  {
    value: '早晨启动',
    icon: '🌤️',
    label: '早晨启动',
    parentDesc: '晨读、复习朗读、准备学习状态等3到6分钟的小启动。目标是降低抗拒，不追求一次学很多。',
    childHint: '只做一个很小的开始，让早晨先顺起来。',
    aliases: ['晨间启动', '晨读', '早晨复习', '起床复习'],
  },
  {
    value: '运动',
    icon: '🏃',
    label: '运动',
    parentDesc: '跑跳、球类、拉伸、体能和户外锻炼。更适合按参与、动作组数和连续性奖励。',
    childHint: '动起来就已经在给身体充能。',
    aliases: ['锻炼', '体育'],
  },
  {
    value: '活动',
    icon: '🎨',
    label: '活动',
    parentDesc: '兴趣、艺术、游戏化挑战、亲子活动、探索类项目。重点是参与和体验，不按效率衡量。',
    childHint: '这是探索和练习，不是和时间赛跑。',
    aliases: ['兴趣', '艺术', '亲子', '项目'],
  },
  {
    value: '情绪调节',
    icon: '💗',
    label: '情绪调节',
    parentDesc: '冷静练习、表达感受、使用替代动作等自我调节任务。建议少金币、多认可和经验，不把情绪本身当成可刷奖励。',
    childHint: '先把感觉说出来，再选一个让自己慢下来的办法。',
    aliases: ['情绪', '冷静', '冷静练习', '情绪自助'],
  },
  {
    value: '其他',
    icon: '✨',
    label: '其他',
    parentDesc: '临时任务或暂时无法归类的事项。长期使用后建议再归入更明确的类别。',
    childHint: '一个特别任务，按今天的约定来完成。',
    aliases: ['协作', '合作', '未分类'],
  },
];

export const TASK_CATEGORY_VALUES = TASK_CATEGORY_OPTIONS.map(item => item.value);
export const TASK_CATEGORY_FILTERS = ['全部', ...TASK_CATEGORY_VALUES] as const;

export const normalizeTaskCategory = (category?: string | null): TaskCategoryKey => {
  const raw = String(category || '').trim();
  const direct = TASK_CATEGORY_OPTIONS.find(item => item.value === raw);
  if (direct) return direct.value;
  const alias = TASK_CATEGORY_OPTIONS.find(item => item.aliases.includes(raw));
  return alias?.value || '其他';
};

export const getTaskCategoryInfo = (category?: string | null) => {
  const normalized = normalizeTaskCategory(category);
  return TASK_CATEGORY_OPTIONS.find(item => item.value === normalized) || TASK_CATEGORY_OPTIONS[TASK_CATEGORY_OPTIONS.length - 1];
};

export const taskMatchesCategory = (category: string | undefined, filter: string) => {
  if (filter === '全部') return true;
  return normalizeTaskCategory(category) === filter;
};
