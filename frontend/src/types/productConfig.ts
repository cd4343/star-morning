export type ChildAgeBand = '6-8' | '9-10' | '11-12';
export type FocusArea = 'morning' | 'homework' | 'self_care' | 'housework' | 'outdoor';

export interface QuickSetupInput {
  childAgeBand: ChildAgeBand;
  focusAreas: FocusArea[];
  dailyCoreActions: 1 | 2 | 3;
  weeklyRewardBudgetRmb: number;
  screenTimeCapMinutes: number;
}

export interface QuickSetupPreview {
  tasks: Array<{ templateKey: string; title: string; icon: string }>;
  wishes: Array<{ templateKey: string; title: string; icon: string }>;
  privileges: Array<{ templateKey: string; title: string; icon: string }>;
}

export interface ProductSetupResponse {
  setupStatus: 'not_started' | 'completed';
  settings: QuickSetupInput | null;
  defaults?: QuickSetupInput;
  preview: QuickSetupPreview;
}
