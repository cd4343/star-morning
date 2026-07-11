import { useNavigate } from 'react-router-dom';
import { t } from '../i18n';

export type ParentInboxType = 'review' | 'overdue_session' | 'reward_debt' | 'setup_hint';

export interface ParentInboxItem {
  id: string;
  type: ParentInboxType;
  priority: 'must_handle' | 'suggested' | 'info';
  actionPath: string;
  count: number;
}

interface ParentInboxProps {
  items: ParentInboxItem[];
  totalActionCount: number;
  loading?: boolean;
  onGoReview: () => void;
}

const ICONS: Record<ParentInboxType, string> = {
  review: '📋',
  overdue_session: '⏰',
  reward_debt: '🎁',
  setup_hint: '✨',
};

export function ParentInbox({ items, totalActionCount, loading = false, onGoReview }: ParentInboxProps) {
  const navigate = useNavigate();

  const handleAction = (item: ParentInboxItem) => {
    if (item.type === 'review' || item.type === 'overdue_session') {
      onGoReview();
      return;
    }
    navigate(item.actionPath);
  };

  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm" aria-labelledby="parent-inbox-title">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="parent-inbox-title" className="text-sm font-black text-slate-800">{t('inbox.title')}</h2>
          <p className="mt-0.5 text-xs font-medium text-slate-500">
            {loading ? t('common.loading') : t('inbox.actionCount', { count: totalActionCount })}
          </p>
        </div>
        {totalActionCount > 0 && (
          <span className="min-w-8 rounded-full bg-red-50 px-2 py-1 text-center text-sm font-black text-red-600">
            {totalActionCount}
          </span>
        )}
      </div>

      {!loading && items.length === 0 && (
        <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-3 text-center text-sm font-bold text-emerald-700">
          {t('inbox.allDone')}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {items.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => handleAction(item)}
            className="flex min-h-[52px] w-full items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-left active:scale-[0.99]"
          >
            <span className="text-xl" aria-hidden="true">{ICONS[item.type]}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-black text-slate-800">{t(`inbox.${item.type}.title`)}</span>
              <span className="block text-xs font-medium text-slate-500">
                {t(`inbox.${item.type}.summary`, { count: item.count })}
              </span>
            </span>
            <span className="text-sm font-black text-blue-600">{t('inbox.handle')}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
