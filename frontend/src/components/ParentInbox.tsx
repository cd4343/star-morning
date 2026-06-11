import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { t } from '../i18n';

interface ParentInboxProps {
  pendingCount: number;
  loading?: boolean;
  onGoReview: () => void;
}

export function ParentInbox({ pendingCount, loading = false, onGoReview }: ParentInboxProps) {
  const navigate = useNavigate();
  const [exploreCount, setExploreCount] = useState(0);
  const [feedCount, setFeedCount] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // 探索端点缺失或报错时静默降级为 0，不打扰家长
      const [checkinRes, feedRes] = await Promise.allSettled([
        api.get('/parent/explore/checkins'),
        api.get('/parent/explore/feed-settings'),
      ]);
      if (cancelled) return;
      if (checkinRes.status === 'fulfilled' && Array.isArray(checkinRes.value.data)) {
        setExploreCount(checkinRes.value.data.filter((item: any) => !item.parentConfirmed).length);
      }
      if (feedRes.status === 'fulfilled' && Array.isArray(feedRes.value.data?.pendingReview)) {
        setFeedCount(feedRes.value.data.pendingReview.length);
      }
      setLoaded(true);
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const pills = [
    {
      key: 'review',
      icon: '📋',
      label: t('inbox.taskReview'),
      count: pendingCount,
      activeClass: 'bg-red-50 border-red-200 text-red-600',
      onClick: onGoReview,
    },
    {
      key: 'explore',
      icon: '🧭',
      label: t('inbox.exploreConfirm'),
      count: exploreCount,
      activeClass: 'bg-emerald-50 border-emerald-200 text-emerald-600',
      onClick: () => navigate('/parent/explore'),
    },
    {
      key: 'feed',
      icon: '📰',
      label: t('inbox.feedReview'),
      count: feedCount,
      activeClass: 'bg-blue-50 border-blue-200 text-blue-600',
      onClick: () => navigate('/parent/explore'),
    },
  ];

  const allDone = loaded && !loading && pills.every(pill => pill.count === 0);

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
      <div className="text-sm font-black text-gray-800 mb-2">{t('inbox.title')}</div>
      <div className="grid grid-cols-3 gap-2">
        {pills.map(pill => (
          <button
            key={pill.key}
            type="button"
            disabled={pill.count === 0}
            onClick={pill.onClick}
            className={`min-h-[44px] rounded-xl border px-2 py-1.5 flex flex-col items-center justify-center gap-0.5 transition-all ${
              pill.count > 0
                ? `${pill.activeClass} active:scale-[0.97]`
                : 'bg-gray-50 border-gray-100 text-gray-300'
            }`}
          >
            <span className="text-[11px] font-bold leading-tight">{pill.icon} {pill.label}</span>
            <span className="text-base font-black leading-none">{pill.count}</span>
          </button>
        ))}
      </div>
      {allDone && (
        <div className="text-center text-xs text-gray-400 font-bold mt-2">{t('inbox.allDone')}</div>
      )}
    </div>
  );
}
