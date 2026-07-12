import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Coins, RotateCcw, Scale } from 'lucide-react';
import api, { getErrorMessage } from '../services/api';
import { t } from '../i18n';
import { useToast } from './Toast';
import { BottomSheet } from './BottomSheet';
import { useConfirmDialog } from './ConfirmDialog';
import type {
  EconomyAuditResponse,
  EconomyDraft,
  EconomyPreviewResponse,
  EconomySettingsResponse,
} from '../types/economy';

const PRESETS = [
  { id: 'fast', coinPerRmb: 5, labelKey: 'economy.presetFast', descriptionKey: 'economy.presetFastDesc' },
  { id: 'standard', coinPerRmb: 10, labelKey: 'economy.presetStandard', descriptionKey: 'economy.presetStandardDesc' },
  { id: 'longTerm', coinPerRmb: 20, labelKey: 'economy.presetLongTerm', descriptionKey: 'economy.presetLongTermDesc' },
] as const;

const DAILY_TARGETS = [20, 30, 50] as const;

export function EconomyModeSelector({
  value,
  onChange,
  compact = false,
}: {
  value: EconomyDraft;
  onChange: (value: EconomyDraft) => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'space-y-4' : 'space-y-5'}>
      <div>
        <div className="mb-2 text-sm font-black text-gray-800">{t('economy.valueAnchor')}</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {PRESETS.map(preset => {
            const selected = value.coinPerRmb === preset.coinPerRmb;
            return (
              <button
                key={preset.id}
                type="button"
                data-testid={`economy-preset-${preset.id}`}
                aria-pressed={selected}
                onClick={() => onChange({ ...value, coinPerRmb: preset.coinPerRmb })}
                className={`min-h-[68px] rounded-2xl border-2 px-3 py-2 text-left transition-colors ${selected ? 'border-blue-500 bg-blue-50 text-blue-900' : 'border-gray-100 bg-white text-gray-700'}`}
              >
                <span className="block text-sm font-black">{t(preset.labelKey)}</span>
                <span className="mt-0.5 block text-xs leading-5 text-gray-500">{t(preset.descriptionKey)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="mb-2 text-sm font-black text-gray-800">{t('economy.dailyTarget')}</div>
        <div className="grid grid-cols-3 gap-2">
          {DAILY_TARGETS.map(target => (
            <button
              key={target}
              type="button"
              aria-pressed={value.dailyCoinTarget === target}
              onClick={() => onChange({ ...value, dailyCoinTarget: target })}
              className={`min-h-11 rounded-xl border-2 px-2 text-sm font-bold ${value.dailyCoinTarget === target ? 'border-blue-500 bg-blue-50 text-blue-800' : 'border-gray-100 bg-white text-gray-600'}`}
            >
              {t('economy.dailyCoins', { coins: target })}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function EconomySettingsPanel({
  onSettingsChange,
  onCatalogChanged,
}: {
  onSettingsChange?: (settings: EconomyDraft) => void;
  onCatalogChanged?: () => void;
}) {
  const toast = useToast();
  const { confirm, Dialog } = useConfirmDialog();
  const [audit, setAudit] = useState<EconomyAuditResponse | null>(null);
  const [draft, setDraft] = useState<EconomyDraft>({ coinPerRmb: 10, dailyCoinTarget: 30 });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<EconomyPreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadAudit = useCallback(async () => {
    try {
      const response = await api.get<EconomyAuditResponse>('/parent/economy-audit');
      setAudit(response.data);
      setDraft(response.data.settings.settings);
      onSettingsChange?.(response.data.settings.settings);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [onSettingsChange, toast]);

  useEffect(() => { void loadAudit(); }, [loadAudit]);

  const adjustableItems = useMemo(
    () => audit?.catalog.items.filter(item => item.suggestedCoins !== null && item.currentCoins !== item.suggestedCoins) || [],
    [audit],
  );

  const saveSettings = async () => {
    setBusy(true);
    try {
      const response = await api.put<EconomySettingsResponse>('/parent/economy-settings', draft);
      toast.success(t('economy.settingsSaved'));
      onSettingsChange?.(response.data.settings);
      await loadAudit();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const openPreview = async () => {
    if (selectedIds.size === 0) return toast.warning(t('economy.selectItemsFirst'));
    setBusy(true);
    try {
      const response = await api.post<EconomyPreviewResponse>('/parent/economy-recalibration-preview', {
        wishIds: Array.from(selectedIds),
      });
      setPreview(response.data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const applyPreview = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      await api.post('/parent/economy-recalibration-apply', { wishIds: preview.changes.map(change => change.id) });
      toast.success(t('economy.recalibrationApplied'));
      setPreview(null);
      setSelectedIds(new Set());
      await loadAudit();
      onCatalogChanged?.();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const rollback = async (batchId: string) => {
    const accepted = await confirm({
      title: t('economy.rollbackTitle'),
      message: t('economy.rollbackMessage'),
      confirmText: t('economy.rollbackConfirm'),
      type: 'warning',
    });
    if (!accepted) return;
    setBusy(true);
    try {
      await api.post(`/parent/economy-recalibration/${batchId}/rollback`);
      toast.success(t('economy.rollbackSuccess'));
      await loadAudit();
      onCatalogChanged?.();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <section className="rounded-3xl border border-blue-100 bg-white p-4 text-sm text-gray-500">{t('common.loading')}</section>;
  }
  if (!audit) return null;

  const dirty = draft.coinPerRmb !== audit.settings.settings.coinPerRmb
    || draft.dailyCoinTarget !== audit.settings.settings.dailyCoinTarget;
  const activeBatch = audit.recentBatches.find(batch => batch.status === 'applied');

  return (
    <section data-testid="economy-settings-panel" className="rounded-3xl border border-blue-100 bg-gradient-to-b from-blue-50 to-white p-4 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white"><Scale size={22} /></div>
        <div>
          <h2 className="font-black text-gray-900">{t('economy.title')}</h2>
          <p className="mt-1 text-xs leading-5 text-gray-500">{t('economy.description')}</p>
        </div>
      </div>

      <EconomyModeSelector value={draft} onChange={setDraft} />
      <div className="mt-3 rounded-2xl bg-blue-600 px-4 py-3 text-white">
        <div className="flex items-center gap-2 font-black"><Coins size={18} />{t('economy.currentAnchor', { coins: draft.coinPerRmb })}</div>
        <div className="mt-1 text-xs text-blue-100">{t('economy.currentDaily', { coins: draft.dailyCoinTarget })}</div>
      </div>
      <button
        type="button"
        data-testid="economy-save-settings"
        disabled={!dirty || busy}
        onClick={saveSettings}
        className="mt-3 min-h-11 w-full rounded-xl bg-blue-600 px-4 font-black text-white disabled:bg-gray-300"
      >
        {t('economy.saveSettings')}
      </button>

      <div className="mt-5 border-t border-blue-100 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-gray-900">{t('economy.catalogAudit')}</h3>
            <p className="mt-1 text-xs text-gray-500">{t('economy.productionSummary', { measured: audit.production.measuredDailyCoins, target: audit.production.targetDailyCoins })}</p>
          </div>
          <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-blue-700">{t('economy.alignedCount', { aligned: audit.catalog.aligned, total: audit.catalog.total })}</span>
        </div>

        {adjustableItems.length > 0 ? (
          <div className="mt-3 space-y-2">
            {adjustableItems.map(item => (
              <label key={item.id} className="flex min-h-[60px] items-center gap-3 rounded-2xl border border-gray-100 bg-white p-3">
                <input
                  type="checkbox"
                  data-testid={`economy-item-${item.id}`}
                  checked={selectedIds.has(item.id)}
                  onChange={event => setSelectedIds(current => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(item.id); else next.delete(item.id);
                    return next;
                  })}
                  className="h-5 w-5 shrink-0 accent-blue-600"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-gray-800">{item.title}</span>
                  <span className="block text-xs text-gray-500">{t('economy.priceChange', { old: item.currentCoins, next: item.suggestedCoins ?? 0 })}</span>
                </span>
                <span className="text-xs font-bold text-blue-700">{t('economy.referenceRmb', { rmb: item.referenceRmb ?? 0 })}</span>
              </label>
            ))}
            <button
              type="button"
              data-testid="economy-preview"
              disabled={busy || selectedIds.size === 0}
              onClick={openPreview}
              className="min-h-11 w-full rounded-xl border-2 border-blue-600 bg-white px-4 font-black text-blue-700 disabled:border-gray-200 disabled:text-gray-400"
            >
              {t('economy.previewSelected', { count: selectedIds.size })}
            </button>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2 rounded-2xl bg-emerald-50 p-3 text-sm font-bold text-emerald-700"><CheckCircle2 size={18} />{t('economy.catalogAligned')}</div>
        )}

        {audit.catalog.missingReference > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-xs leading-5 text-amber-800"><AlertCircle size={18} className="mt-0.5 shrink-0" />{t('economy.missingReference', { count: audit.catalog.missingReference })}</div>
        )}

        {activeBatch && (
          <button
            type="button"
            data-testid={`economy-rollback-${activeBatch.id}`}
            disabled={busy}
            onClick={() => rollback(activeBatch.id)}
            className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-gray-100 px-4 text-sm font-bold text-gray-700"
          >
            <RotateCcw size={17} />{t('economy.rollbackRecent')}
          </button>
        )}
      </div>

      <BottomSheet
        isOpen={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={t('economy.previewTitle')}
        footer={preview && (
          <div className="flex gap-3">
            <button type="button" onClick={() => setPreview(null)} className="min-h-11 flex-1 rounded-xl bg-gray-100 font-bold text-gray-700">{t('common.cancel')}</button>
            <button type="button" data-testid="economy-apply" disabled={busy || preview.changes.length === 0} onClick={applyPreview} className="min-h-11 flex-1 rounded-xl bg-blue-600 font-black text-white disabled:bg-gray-300">{t('economy.applyChanges')}</button>
          </div>
        )}
      >
        <div data-testid="economy-preview-sheet" className="space-y-3">
          <p className="text-sm leading-6 text-gray-600">{t('economy.previewDescription')}</p>
          {preview?.changes.map(change => (
            <div key={change.id} className="rounded-2xl border border-gray-100 p-3">
              <div className="font-bold text-gray-900">{change.title}</div>
              <div className="mt-1 text-sm font-black text-blue-700">{t('economy.priceArrow', { old: change.oldValue, next: change.newValue })}</div>
              <div className="mt-1 text-xs text-gray-500">{t('economy.daysArrow', { old: change.oldDaysToRedeem, next: change.newDaysToRedeem })}</div>
            </div>
          ))}
        </div>
      </BottomSheet>
      <Dialog />
    </section>
  );
}

export default EconomySettingsPanel;
