import { useCallback, useEffect, useState } from 'react';
import { MapPin, RefreshCw, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api, { getErrorMessage } from '../../services/api';
import { t } from '../../i18n';
import { useToast } from '../Toast';

type WishRequest = {
  id: string;
  title: string;
  icon?: string;
  description?: string;
  status: string;
  approval_mode?: 'coins_direct' | 'coins_savings' | 'privilege_points';
  target_cost?: number;
  saved_amount?: number;
  parent_reason?: string;
};

export function ChildWishRequestPanel({ coins, privilegePoints, onBalanceChange }: { coins: number; privilegePoints: number; onBalanceChange: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [active, setActive] = useState<WishRequest | null>(null);
  const [history, setHistory] = useState<WishRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState('⭐');
  const [description, setDescription] = useState('');
  const [changeReason, setChangeReason] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await api.get('/child/wish-requests');
      setActive(response.data?.active || null);
      setHistory(Array.isArray(response.data?.history) ? response.data.history : []);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('wish.child.loadFailed')));
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (!title.trim()) return toast.warning(t('wish.child.titleRequired'));
    setBusy(true);
    try {
      await api.post('/child/wish-requests', { title, icon, description });
      setTitle(''); setDescription(''); setIcon('⭐');
      toast.success(t('wish.child.submitted'));
      await load();
    } catch (error: unknown) { toast.error(getErrorMessage(error, t('wish.child.submitFailed'))); }
    finally { setBusy(false); }
  };

  const redeem = async () => {
    if (!active) return;
    setBusy(true);
    try {
      await api.post(`/child/wish-requests/${active.id}/redeem`);
      toast.success(t('wish.child.redeemed'));
      onBalanceChange();
      await load();
    } catch (error: unknown) { toast.error(getErrorMessage(error, t('wish.child.redeemFailed'))); }
    finally { setBusy(false); }
  };

  const deposit = async (requested: number) => {
    if (!active) return;
    const remaining = Math.max(0, Number(active.target_cost || 0) - Number(active.saved_amount || 0));
    const amount = Math.min(requested, remaining, coins);
    if (amount < 1) return toast.warning(t('wish.child.notEnoughCoins'));
    setBusy(true);
    try {
      await api.post(`/child/wish-requests/${active.id}/deposit`, { amount });
      toast.success(t('wish.child.deposited', { amount }));
      onBalanceChange();
      await load();
    } catch (error: unknown) { toast.error(getErrorMessage(error, t('wish.child.depositFailed'))); }
    finally { setBusy(false); }
  };

  const requestChange = async () => {
    if (!active) return;
    if (!changeReason.trim()) return toast.warning(t('wish.child.changeReasonRequired'));
    setBusy(true);
    try {
      await api.post(`/child/wish-requests/${active.id}/request-change`, { reason: changeReason });
      toast.success(t('wish.child.changeRequested'));
      setChangeReason('');
      await load();
    } catch (error: unknown) { toast.error(getErrorMessage(error, t('wish.child.changeFailed'))); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="min-h-[220px] rounded-3xl bg-white animate-pulse" />;

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-violet-100 bg-gradient-to-br from-violet-50 via-white to-pink-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div><div className="font-black text-lg text-gray-900 flex items-center gap-2"><Sparkles size={20} className="text-violet-500" />{t('wish.child.title')}</div><p className="text-sm text-gray-600 mt-1">{t('wish.child.hint')}</p></div>
          <button type="button" onClick={() => void load()} className="min-w-[44px] min-h-[44px] rounded-xl bg-white flex items-center justify-center text-violet-600" aria-label={t('common.refresh')}><RefreshCw size={17}/></button>
        </div>
      </section>

      {!active ? (
        <section className="rounded-3xl bg-white border border-gray-100 shadow-sm p-4 space-y-3">
          <div className="grid grid-cols-[72px_1fr] gap-3">
            <input value={icon} onChange={event => setIcon(event.target.value)} maxLength={4} aria-label={t('wish.child.icon')} className="min-h-[48px] rounded-xl border bg-gray-50 text-center text-2xl" />
            <input value={title} onChange={event => setTitle(event.target.value)} maxLength={50} placeholder={t('wish.child.titlePlaceholder')} className="min-h-[48px] px-3 rounded-xl border bg-gray-50" />
          </div>
          <textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={200} rows={3} placeholder={t('wish.child.descriptionPlaceholder')} className="w-full p-3 rounded-xl border bg-gray-50 resize-none" />
          <button type="button" disabled={busy} onClick={() => void submit()} className="w-full min-h-[48px] rounded-xl bg-violet-600 text-white font-black disabled:opacity-50">{t('wish.child.submit')}</button>
        </section>
      ) : (
        <section className="rounded-3xl bg-white border border-gray-100 shadow-sm p-4 space-y-4">
          <div className="flex items-start gap-3"><div className="w-14 h-14 rounded-2xl bg-violet-50 flex items-center justify-center text-3xl">{active.icon || '⭐'}</div><div className="min-w-0 flex-1"><div className="text-xs font-black text-violet-600">{t(`wish.status.${active.status}`)}</div><h3 className="font-black text-xl text-gray-900 break-words">{active.title}</h3>{active.description && <p className="text-sm text-gray-500 mt-1">{active.description}</p>}</div></div>
          {active.status === 'pending' && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t('wish.child.waiting')}</div>}
          {active.status === 'approved' && (
            <>
              <div className="rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-900">
                {t(`wish.mode.${active.approval_mode === 'coins_direct' ? 'coinsDirect' : active.approval_mode === 'coins_savings' ? 'coinsSavings' : 'privilegePoints'}`)} · {active.target_cost || 0}
                {active.parent_reason && <div className="mt-1 text-emerald-700">{active.parent_reason}</div>}
              </div>
              {active.approval_mode === 'coins_savings' ? (
                <div className="space-y-3">
                  <div className="h-3 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-violet-500" style={{ width: `${Math.min(100, Math.round(Number(active.saved_amount || 0) / Math.max(1, Number(active.target_cost || 1)) * 100))}%` }} /></div>
                  <div className="text-sm font-bold text-gray-600">{t('wish.child.saved', { saved: active.saved_amount || 0, target: active.target_cost || 0 })}</div>
                  <div className="grid grid-cols-3 gap-2">{[1, 5, 10].map(amount => <button key={amount} disabled={busy || coins < 1} onClick={() => void deposit(amount)} className="min-h-[44px] rounded-xl border border-violet-200 text-violet-700 font-black disabled:opacity-40">+{amount}</button>)}</div>
                </div>
              ) : (
                <button disabled={busy || (active.approval_mode === 'privilege_points' ? privilegePoints : coins) < Number(active.target_cost || 0)} onClick={() => void redeem()} className="w-full min-h-[48px] rounded-xl bg-emerald-500 text-white font-black disabled:bg-gray-200 disabled:text-gray-400">{t('wish.child.redeem')}</button>
              )}
              <div className="border-t pt-3 space-y-2"><input value={changeReason} onChange={event => setChangeReason(event.target.value)} maxLength={200} placeholder={t('wish.child.changePlaceholder')} className="w-full min-h-[44px] px-3 rounded-xl border bg-gray-50" /><button disabled={busy} onClick={() => void requestChange()} className="w-full min-h-[44px] rounded-xl border font-bold text-gray-600">{t('wish.child.requestChange')}</button></div>
            </>
          )}
          {active.status === 'change_requested' && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t('wish.child.changeWaiting')}</div>}
        </section>
      )}

      <button type="button" onClick={() => navigate('/child/explore')} className="w-full min-h-[64px] rounded-2xl bg-sky-50 border border-sky-100 px-4 flex items-center gap-3 text-left"><MapPin className="text-sky-600" /><span><b className="block text-sky-900">{t('wish.child.wantToGo')}</b><span className="text-xs text-sky-700">{t('wish.child.wantToGoHint')}</span></span></button>
      {history.length > 0 && <details className="rounded-2xl bg-white border p-3"><summary className="min-h-[44px] flex items-center font-bold text-gray-600 cursor-pointer">{t('wish.child.history', { count: history.length })}</summary><div className="space-y-2 mt-2">{history.map(item => <div key={item.id} className="rounded-xl bg-gray-50 p-3 text-sm"><span className="mr-2">{item.icon || '⭐'}</span><b>{item.title}</b><span className="text-gray-500 ml-2">{t(`wish.status.${item.status}`)}</span>{item.parent_reason && <div className="text-xs text-gray-500 mt-1">{item.parent_reason}</div>}</div>)}</div></details>}
    </div>
  );
}
