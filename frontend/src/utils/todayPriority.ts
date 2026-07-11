export interface TodayTask {
  id: string;
  title: string;
  category?: string;
  status?: string;
  icon?: string;
  coinReward?: number;
  durationMinutes?: number;
}

const isActionable = (task: TodayTask) => ['running', 'todo', 'rejected', ''].includes(String(task.status || ''));

export const sortTodayTasks = (tasks: TodayTask[]): TodayTask[] => (
  tasks
    .filter(isActionable)
    .map((task, index) => ({ task, index }))
    .sort((left, right) => {
      const priority = (task: TodayTask) => {
        if (task.status === 'running') return 0;
        if (task.category === '早晨启动') return 1;
        return 2;
      };
      return priority(left.task) - priority(right.task) || left.index - right.index;
    })
    .map(item => item.task)
);

export const selectPrimaryTodayTask = (tasks: TodayTask[]): TodayTask | null => sortTodayTasks(tasks)[0] || null;
