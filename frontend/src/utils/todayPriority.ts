export interface TodayTask {
  id: string;
  title: string;
  category?: string;
  status?: string;
  icon?: string;
  coinReward?: number;
  xpReward?: number;
  durationMinutes?: number;
  taskType?: string;
  completionMode?: string;
  targetValue?: number | string | null;
  targetUnit?: string | null;
  reviewFocus?: string | null;
  gameTicketPreviewMinutes?: number;
  gameTicketEarnBySpeed?: boolean;
}

const isActionable = (task: TodayTask) => ['running', 'todo', 'rejected', ''].includes(String(task.status || ''));

export const sortTodayTasks = (tasks: TodayTask[]): TodayTask[] => (
  tasks
    .filter(isActionable)
    .map((task, index) => ({ task, index }))
    .sort((left, right) => {
      const priority = (task: TodayTask) => task.status === 'running' ? 0 : 1;
      return priority(left.task) - priority(right.task) || left.index - right.index;
    })
    .map(item => item.task)
);

export const selectPrimaryTodayTask = (tasks: TodayTask[]): TodayTask | null => sortTodayTasks(tasks)[0] || null;
