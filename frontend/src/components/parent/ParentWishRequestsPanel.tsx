import { useCallback, useEffect, useState } from 'react';
import { HeartHandshake, RefreshCw } from 'lucide-react';
import api, { getErrorMessage } from '../../services/api';
import { t } from '../../i18n';
import { useToast } from '../Toast';

type WishRequest = {
  id: string;
  child_name: string;
  title: string;
  icon?: string;
  description?: string;
  status: string;
  approval_mode?: 'coins_direct' | 'coins_savings' | 'privilege_points';
  target_cost?: number;
  saved_amount?: number;
  parent_reason?: string;
};

type Draft = { mode: 'coins_direct' | 'coins_savings' | 'privilege_points'; cost: string; reason: string };

export function ParentWishRequestsPanel() {
  const toast = useToast();
  const [items, setItems] = useState<WishRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const load = useCallback(async () => {
    try {
      const response = await api.get('/parent/wish-requests');
      setItems(Array.isArray(response.data) ? response.data : []);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('wish.parent.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const draftFor = (id: string): Draft => drafts[id] || { mode: 'coins_direct', cost: '', reason: '' };
  const updateDraft = (id: string, patch: Partial<Draft>) => setDrafts(current => ({
    ...current,
    [id]: { ...draftFor(id), ...patch },
  }));

  const review = async (item: WishRequest, action: 'approve' | 'reject') => {
    const draft = draftFor(item.id);
    if (action === 'reject' && !draft.reason.trim()) return toast.warning(t('wish.parent.rejectReasonRequired'));
    if (action === 'approve' && (!Number.isInteger(Number(draft.cost)) || Number(draft.cost) < 1)) return toast.warning(t('wish.parent.costRequired'));
    setBusyId(item.id);
    try {
      await api.post(`/parent/wish-requests/${item.id}/review`, { action, mode: draft.mode, cost: Number(draft.cost), reason: draft.reason });
      toast.success(action === 'approve' ? t('wish.parent.approved') : t('wish.parent.rejected'));
      await load();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('wish.parent.reviewFailed')));
    } finally { setBusyId(''); }
  };

  const reviewChange = async (item: WishRequest, action: 'approve' | 'reject') => {
    const reason = draftFor(item.id).reason;
    if (action === 'reject' && !reason.trim()) return toast.warning(t('wish.parent.keepReasonRequired'));
    setBusyId(item.id);
    try {
      await api.post(`/parent/wish-requests/${item.id}/change-review`, { action, reason });
      toast.success(action === 'approve' ? t('wish.parent.changeApproved') : t('wish.parent.changeKept'));
      await load();
    } catch (error: unknown) { toast.error(getErrorMessage(error, t('wish.parent.reviewFailed'))); }
    finally { setBusyId(''); }
  };

  if (loading) return <div className="min-h-[180px] rounded-3xl bg-white border animate-pulse" />;

  const active = items.filter(item => ['pending', 'approved', 'change_requested'].includes(item.status));
  const history = items.filter(item => !['pending', 'approved', 'change_requested'].includes(item.status));

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-pink-100 bg-gradient-to-br from-pink-50 to-amber-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 font-black text-gray-900"><HeartHandshake size={20} className="text-pink-500" />{t('wish.parent.title')}</div>
            <p className="text-sm text-gray-600 mt-1">{t('wish.parent.hint')}</p>
          </div>
          <button type="button" onClick={() => void load()} className="min-w-[44px] min-h-[44px] rounded-xl bg-white flex items-center justify-center text-pink-600" aria-label={t('common.refresh')}><RefreshCw size={17}/></button>
        </div>
      </div>

      {active.length === 0 && <div className="rounded-2xl bg-white border p-8 text-center text-gray-500">{t('wish.parent.empty')}</div>}
      {active.map(item => {
        const draft = draftFor(item.id);
        return (
          <section key={item.id} className="rounded-3xl bg-white border border-gray-100 shadow-sm p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-2xl bg-pink-50 flex items-center justify-center text-2xl">{item.icon || '⭐'}</div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-pink-600">{item.child_name} · {t(`wish.status.${item.status}`)}</div>
                <h3 className="font-black text-lg text-gray-900 break-words">{item.title}</h3>
                {item.description && <p className="text-sm text-gray-500 mt-1">{item.description}</p>}
              </div>
            </div>

            {item.status === 'pending' && (
              <>
                <select value={draft.mode} onChange={event => updateDraft(item.id, { mode: event.target.value as Draft['mode'] })} className="w-full min-h-[44px] px-3 rounded-xl border bg-gray-50">
                  <option value="coins_direct">{t('wish.mode.coinsDirect')}</option>
                  <option value="coins_savings">{t('wish.mode.coinsSavings')}</option>
                  <option value="privilege_points">{t('wish.mode.privilegePoints')}</option>
                </select>
                <input type="number" min="1" max="999999" value={draft.cost} onChange={event => updateDraft(item.id, { cost: event.target.value })} placeholder={t('wish.parent.costPlaceholder')} className="w-full min-h-[44px] px-3 rounded-xl border bg-gray-50" />
                <input maxLength={200} value={draft.reason} onChange={event => updateDraft(item.id, { reason: event.target.value })} placeholder={t('wish.parent.notePlaceholder')} className="w-full min-h-[44px] px-3 rounded-xl border bg-gray-50" />
                <div className="grid grid-cols-2 gap-2">
                  <button disabled={busyId === item.id} onClick={() => void review(item, 'reject')} className="min-h-[44px] rounded-xl border font-bold text-gray-600 disabled:opacity-50">{t('wish.parent.reject')}</button>
                  <button disabled={busyId === item.id} onClick={() => void review(item, 'approve')} className="min-h-[44px] rounded-xl bg-pink-500 text-white font-black disabled:opacity-50">{t('wish.parent.approve')}</button>
                </div>
              </>
            )}

            {item.status === 'approved' && <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{t('wish.parent.approvedSummary', { cost: item.target_cost || 0, saved: item.saved_amount || 0 })}</div>}
            {item.status === 'change_requested' && (
              <>
                <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t('wish.parent.changeReason', { reason: item.parent_reason || '' })}</div>
                <input maxLength={200} value={draft.reason} onChange={event => updateDraft(item.id, { reason: event.target.value })} placeholder={t('wish.parent.keepReasonPlaceholder')} className="w-full min-h-[44px] px-3 rounded-xl border bg-gray-50" />
                <div className="grid grid-cols-2 gap-2">
                  <button disabled={busyId === item.id} onClick={() => void reviewChange(item, 'reject')} className="min-h-[44px] rounded-xl border font-bold text-gray-600">{t('wish.parent.keepWish')}</button>
                  <button disabled={busyId === item.id} onClick={() => void reviewChange(item, 'approve')} className="min-h-[44px] rounded-xl bg-amber-500 text-white font-black">{t('wish.parent.allowChange')}</button>
                </div>
              </>
            )}
          </section>
        );
      })}

      {history.length > 0 && <details className="rounded-2xl bg-white border p-3"><summary className="min-h-[44px] flex items-center font-bold text-gray-600 cursor-pointer">{t('wish.parent.history', { count: history.length })}</summary><div className="space-y-2 mt-2">{history.map(item => <div key={item.id} className="rounded-xl bg-gray-50 p-3 text-sm"><span className="mr-2">{item.icon || '⭐'}</span><b>{item.child_name} · {item.title}</b><span className="text-gray-500 ml-2">{t(`wish.status.${item.status}`)}</span></div>)}</div></details>}
    </div>
  );
}
