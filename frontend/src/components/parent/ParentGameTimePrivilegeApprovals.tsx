import { useCallback, useEffect, useState } from 'react';
import { Clock3, RefreshCw } from 'lucide-react';
import api, { getErrorMessage } from '../../services/api';
import { t } from '../../i18n';
import { useToast } from '../Toast';

type PendingPrivilege = {
  id: string;
  child_name: string;
  title: string;
  icon?: string;
  cost: number;
  game_minutes: number;
};

export function ParentGameTimePrivilegeApprovals() {
  const toast = useToast();
  const [items, setItems] = useState<PendingPrivilege[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [reason, setReason] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const response = await api.get('/parent/privilege-redemptions');
      setItems(Array.isArray(response.data) ? response.data : []);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('privilege.pending.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const resolve = async (item: PendingPrivilege, action: 'approve' | 'reject') => {
    const note = String(reason[item.id] || '').trim();
    if (action === 'reject' && !note) return toast.warning(t('privilege.pending.rejectReasonRequired'));
    setBusyId(item.id);
    try {
      const response = await api.post(`/parent/privilege-redemptions/${item.id}/resolve`, { action, reason: note });
      toast.success(action === 'approve'
        ? t('privilege.pending.approved', { minutes: response.data?.grantedMinutes || item.game_minutes })
        : t('privilege.pending.rejected'));
      await load();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('privilege.pending.resolveFailed')));
    } finally {
      setBusyId('');
    }
  };

  if (loading) return <div className="min-h-[88px] rounded-2xl bg-white border border-purple-100 animate-pulse" />;
  if (items.length === 0) return null;

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/80 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-black text-amber-950 flex items-center gap-2"><Clock3 size={18} /> {t('privilege.pending.title')}</h2>
          <p className="text-xs text-amber-800 mt-1">{t('privilege.pending.hint')}</p>
        </div>
        <button type="button" onClick={() => void load()} className="min-w-[44px] min-h-[44px] rounded-xl bg-white text-amber-700 flex items-center justify-center" aria-label={t('common.refresh')}>
          <RefreshCw size={17} />
        </button>
      </div>
      {items.map(item => (
        <div key={item.id} className="rounded-2xl bg-white border border-amber-100 p-3 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-amber-100 flex items-center justify-center text-2xl">{item.icon || '🎮'}</div>
          <div className="min-w-0 flex-1">
              <div className="font-black text-gray-900 truncate">{t('privilege.pending.item', { child: item.child_name, title: item.title })}</div>
              <div className="text-xs text-gray-500">{t('privilege.pending.cost', { minutes: item.game_minutes, cost: item.cost })}</div>
            </div>
          </div>
          <input
            value={reason[item.id] || ''}
            onChange={event => setReason(current => ({ ...current, [item.id]: event.target.value }))}
            maxLength={200}
            placeholder={t('privilege.pending.notePlaceholder')}
            className="w-full min-h-[44px] px-3 rounded-xl border border-gray-200 bg-gray-50 outline-none focus:ring-2 focus:ring-amber-400"
          />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={busyId === item.id} onClick={() => void resolve(item, 'reject')} className="min-h-[44px] rounded-xl border border-gray-200 font-bold text-gray-600 disabled:opacity-50">{t('privilege.pending.reject')}</button>
            <button type="button" disabled={busyId === item.id} onClick={() => void resolve(item, 'approve')} className="min-h-[44px] rounded-xl bg-amber-500 text-white font-black disabled:opacity-50">{t('privilege.pending.approve')}</button>
          </div>
        </div>
      ))}
    </section>
  );
}
