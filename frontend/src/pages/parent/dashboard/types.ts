import type { ParentInboxItem } from '../../../components/ParentInbox';

export type ParentDashboardTab = 'overview' | 'approvals' | 'reports' | 'tools';

export type ParentDashboardStats = {
  weekTasks: number;
  weekCompleted: number;
};

export type ParentDashboardInbox = {
  items: ParentInboxItem[];
  totalActionCount: number;
};

export type ParentTaskSessionReminder = {
  id: string;
  childName: string;
  title: string;
  icon?: string;
  durationMinutes?: number;
};

export type ParentWeeklyReport = {
  id: string;
  childName?: string;
  weekStart: string;
  parentNarrative?: string;
  suggestion?: string;
  stats?: {
    tasksCompleted?: number;
    activeStarts?: number;
    coinsEarned?: number;
  };
};
