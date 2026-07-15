export type ParentTaskView = 'today' | 'all' | 'family';

export type TodayTask = {
  id: string;
  title: string;
  icon?: string;
  coinReward: number;
  xpReward: number;
  durationMinutes: number;
  category: string;
  status: 'todo' | 'running' | 'pending' | 'approved' | 'completed';
  [key: string]: unknown;
};

export type TodayTaskSchedule = {
  childId: string;
  childName: string;
  tasks: TodayTask[];
};

export type TodayTaskPreviewResponse = {
  date: string;
  configuredTaskCount: number;
  schedules: TodayTaskSchedule[];
};
