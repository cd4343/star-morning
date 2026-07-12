export type EconomyPreset = 'fast' | 'standard' | 'longTerm' | 'custom';

export interface EconomyDraft {
  coinPerRmb: number;
  dailyCoinTarget: number;
}

export interface EconomySettingsResponse {
  ecoCoinPerRmb: number;
  ecoTasksPerDay: number;
  dailyCoinTarget: number;
  settings: EconomyDraft & { preset: EconomyPreset };
}

export interface EconomyAuditItem {
  id: string;
  title: string;
  currentCoins: number;
  referenceRmb: number | null;
  suggestedCoins: number | null;
  alignment: 'aligned' | 'underpriced' | 'overpriced' | 'missing_reference' | 'invalid_reference';
  daysToRedeem: number;
}

export interface EconomyAuditResponse {
  settings: EconomySettingsResponse;
  production: { measuredDailyCoins: number; targetDailyCoins: number; sampleDays: number };
  catalog: {
    total: number;
    aligned: number;
    underpriced: number;
    overpriced: number;
    missingReference: number;
    invalidReference: number;
    items: EconomyAuditItem[];
  };
  warnings: Array<{ code: string; count?: number; measured?: number; target?: number }>;
  recentBatches: Array<{
    id: string;
    changeType: string;
    status: 'applied' | 'rolled_back';
    createdAt: string;
    rolledBackAt: string | null;
  }>;
}

export interface EconomyPreviewResponse {
  settings: EconomyDraft;
  changes: Array<{
    id: string;
    title: string;
    referenceRmb: number;
    oldValue: number;
    newValue: number;
    oldDaysToRedeem: number;
    newDaysToRedeem: number;
  }>;
  unchangedCount: number;
}
