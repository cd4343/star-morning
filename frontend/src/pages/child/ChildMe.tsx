import { useEffect, useState, useCallback, useRef } from 'react';
import { Card } from '../../components/Card';
import { Trophy, Lock, ChevronDown, Archive, ShieldCheck, Timer } from 'lucide-react';
import { Modal } from '../../components/Modal';
import api, { isAuthError } from '../../services/api';
import { getDateLocale, t } from '../../i18n';
import { useOutletContext } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import {
  getAchievementDisplay as getSharedAchievementDisplay,
} from '../../utils/achievementDisplay';
import { getLevelTitle, PERK_MILESTONES } from '../../utils/levelPerks';
import { GrowthIcon } from '../../components/GrowthIcon';

interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  displayTitle?: string;
  displayDescription?: string;
  displayIcon?: string;
  systemKey?: string | null;
  isSystem?: boolean;
  iconKey?: string | null;
  rankLabel?: string;
  rankIcon?: string;
  conditionType: string;
  conditionValue: number;
  conditionCategory?: string;
  category?: string;
  rewardCoins?: number;
  rewardXp?: number;
  rewardPrivilegePoints?: number;
  rewardDelivery?: string;
  rewardClaimedAt?: string | null;
  rewardClaimable?: boolean;
  unlocked?: boolean;
  unlockedAt?: string;
  progress?: number;
}

interface PunishmentRecord {
  id: string;
  level: string;
  reason: string;
  deductedCoins: number;
  taskTitle: string;
  taskCategory: string;
  parentName: string;
  createdAt: string;
}

interface PunishmentStats {
  totalCount: number;
  totalDeducted: number;
  weekCount: number;
  prevWeekCount: number;
  byLevel: Array<{ level: string; count: number; totalDeducted: number }>;
  lastPunishmentDate: string | null;
  daysSinceLastPunishment: number | null;
}

interface FocusStats {
  thisWeekMinutes: number;
  lastWeekMinutes: number;
  longestSessionMinutes: number;
  sessionsCount: number;
}

interface ChestRecord {
  id: string;
  rewardName: string;
  rewardType: string;
  rewardValue: number;
  rewardRarity?: string;
  rewardIcon?: string;
  taskTitle?: string;
  createdAt: string;
}

const CHEST_TIME_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'today', label: '今天' },
  { value: 'week', label: '近7天' },
  { value: 'month', label: '本月' },
] as const;

const CHEST_REWARD_TYPES = [
  { value: 'all', labelKey: 'growth.rewardTypeAll' },
  { value: 'coins', labelKey: 'growth.rewardTypeCoins' },
  { value: 'xp', labelKey: 'growth.rewardTypeXp' },
  { value: 'privilegePoints', labelKey: 'growth.rewardTypeRights' },
  { value: 'lotteryTicket', labelKey: 'growth.rewardTypeTicket' },
  { value: 'shopDiscount', labelKey: 'growth.rewardTypeDiscount' },
] as const;

type ChestTimeFilter = typeof CHEST_TIME_FILTERS[number]['value'];

const formatLocalDate = (date: Date) => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

const getChestDateParams = (filter: ChestTimeFilter) => {
  const now = new Date();
  if (filter === 'today') return { startDate: formatLocalDate(now), endDate: formatLocalDate(now) };
  if (filter === 'week') {
    const start = new Date(now);
    start.setDate(now.getDate() - 6);
    return { startDate: formatLocalDate(start), endDate: formatLocalDate(now) };
  }
  if (filter === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { startDate: formatLocalDate(start), endDate: formatLocalDate(now) };
  }
  return {};
};

export default function ChildMe() {
  const context = useOutletContext<any>();
  const childData = context?.childData || { coins: 0, xp: 0, level: 1, privilegePoints: 0, rewardXpTotal: 0 };
  const toast = useToast();

  const [allAchievements, setAllAchievements] = useState<Achievement[]>([]);
  const [punishmentRecords, setPunishmentRecords] = useState<PunishmentRecord[]>([]);
  const [chestRecords, setChestRecords] = useState<ChestRecord[]>([]);
  const [punishmentStats, setPunishmentStats] = useState<PunishmentStats | null>(null);
  const [focusStats, setFocusStats] = useState<FocusStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedRecords, setExpandedRecords] = useState(false);
  // M19b: 时间筛选只留「最近30天 / 全部」，列表固定按时间倒序
  const [timeFilter, setTimeFilter] = useState<'month' | 'all'>('month');
  const [chestTimeFilter, setChestTimeFilter] = useState<ChestTimeFilter>('today');
  const [chestTypeFilter, setChestTypeFilter] = useState('all');
  const [selectedRecord, setSelectedRecord] = useState<PunishmentRecord | null>(null);
  const [activePanel, setActivePanel] = useState<'achievements' | 'review' | 'chest'>('achievements');
  const [achievementsExpanded, setAchievementsExpanded] = useState(false);
  const [levelPathExpanded, setLevelPathExpanded] = useState(false); // R3: 等级之路折叠卡
  // 原先声明在 loading 提前 return 之后，会破坏 hooks 调用顺序，移到这里
  const [achievementCategory, setAchievementCategory] = useState('全部');
  const chestDefaultDateRef = useRef(formatLocalDate(new Date()));

  const fetchAchievements = useCallback(async () => {
    const achRes = await api.get('/child/all-achievements');
    setAllAchievements(achRes.data || []);
  }, []);

  const fetchPunishmentRecords = useCallback(async (limit?: number) => {
    try {
      const actualLimit = limit ?? (expandedRecords ? 100 : 3);
      const punishRes = await api.get('/child/punishment-records', {
        params: { limit: actualLimit, timeFilter }
      });
      setPunishmentRecords(punishRes.data || []);
    } catch (punishErr) {
      console.error('获取惩罚记录失败:', punishErr);
    }
  }, [expandedRecords, timeFilter]);

  const fetchChestRecords = useCallback(async () => {
    try {
      const params = {
        limit: 30,
        ...getChestDateParams(chestTimeFilter),
        ...(chestTypeFilter !== 'all' ? { rewardType: chestTypeFilter } : {}),
      };
      const chestRes = await api.get('/child/chest-records', { params });
      setChestRecords(chestRes.data || []);
    } catch (chestErr) {
      console.error('获取宝箱记录失败:', chestErr);
    }
  }, [chestTimeFilter, chestTypeFilter]);

  // 复盘记录固定按时间倒序展示
  const sortedRecords = [...punishmentRecords].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  useEffect(() => {
    const fetchData = async () => {
      try {
        await fetchAchievements();

        // 获取惩罚统计
        try {
          const statsRes = await api.get('/child/punishment-stats');
          setPunishmentStats(statsRes.data);
        } catch (statsErr) {
          console.error('获取惩罚统计失败:', statsErr);
        }

        // 专注可视化卡数据，拿不到就静默隐藏卡片
        try {
          const focusRes = await api.get('/child/focus-stats');
          setFocusStats(focusRes.data);
        } catch (focusErr) {
          console.error('获取专注统计失败:', focusErr);
        }
      } catch (e) {
        console.error(e);
        if (isAuthError(e)) return;
        toast.error('加载数据失败');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [toast, fetchAchievements]);

  useEffect(() => {
    fetchPunishmentRecords();
  }, [fetchPunishmentRecords]);

  useEffect(() => {
    fetchChestRecords();
  }, [fetchChestRecords]);

  const getConditionText = (ach: any) => {
    switch (ach.conditionType) {
      case 'task_count': return `完成 ${ach.conditionValue} 个任务`;
      case 'coin_count': return `累计获得 ${ach.conditionValue} 金币`;
      case 'xp_count': return t('growth.achievementXpCount', { value: ach.conditionValue });
      case 'level_reach': return `达到 ${ach.conditionValue} 级`;
      case 'category_count': return `完成 ${ach.conditionValue} 个${ach.conditionCategory || ''}任务`;
      case 'streak_days': return `连续 ${ach.conditionValue} 天${ach.conditionCategory ? `完成${ach.conditionCategory}` : '完成任务'}`;
      case 'manual': return '特殊成就';
      case 'explore_checkin_count': return `完成 ${ach.conditionValue} 次探索打卡`;
      case 'explore_category_count': return `打卡 ${ach.conditionValue} 个${ach.conditionCategory || '探索'}地点`;
      case 'explore_media_count': return `上传 ${ach.conditionValue} 次照片纪念`;
      case 'explore_voice_count': return `留下 ${ach.conditionValue} 条语音留言`;
      case 'explore_confirmed_count': return `完成 ${ach.conditionValue} 次家长确认探索`;
      default: return ach.description;
    }
  };

  const getAchievementDisplay = getSharedAchievementDisplay;

  const getProgressPercent = (ach: Achievement) => {
    if (ach.unlocked) return 100;
    if (!ach.progress || !ach.conditionValue) return 0;
    return Math.min(Math.round((ach.progress / ach.conditionValue) * 100), 99);
  };

  if (loading) {
    return <div className="p-4 text-center text-gray-400">加载中...</div>;
  }

  const unlockedCount = allAchievements.filter(a => a.unlocked).length;

  const getLevelEmoji = (level: string) => {
    switch (level) {
      case 'mild': return '🟡';
      case 'moderate': return '🟠';
      case 'severe': return '🔴';
      case 'custom': return '🟣';
      default: return '⚠️';
    }
  };

  const getLevelName = (level: string) => {
    switch (level) {
      case 'mild': return '小提醒';
      case 'moderate': return '需要注意';
      case 'severe': return '重要约定';
      case 'custom': return '特别约定';
      default: return '约定';
    }
  };

  // 获取趋势提示
  const getTrendMessage = () => {
    if (!punishmentStats) return null;
    const { weekCount, prevWeekCount, daysSinceLastPunishment } = punishmentStats;

    if (weekCount === 0 && daysSinceLastPunishment !== null) {
      if (daysSinceLastPunishment >= 7) {
        return { text: `🎉 太棒了！已连续 ${daysSinceLastPunishment} 天没有惩罚，继续保持！`, type: 'success' };
      } else {
        return { text: `✅ 最近7天没有惩罚，继续努力！`, type: 'success' };
      }
    }

    if (weekCount < prevWeekCount) {
      return { text: '📈 有进步！提醒比上周少了', type: 'improve' };
    } else if (weekCount > prevWeekCount) {
      return { text: '💬 这周提醒多了一些，看看是哪件事卡住了？', type: 'warn' };
    } else if (weekCount === prevWeekCount && weekCount > 0) {
      return { text: '📊 保持稳定，继续努力减少提醒', type: 'neutral' };
    }

    return null;
  };

  const trendMessage = getTrendMessage();
  const achievementPercent = allAchievements.length ? Math.round((unlockedCount / allAchievements.length) * 100) : 0;
  const xpCurrent = Number(childData?.xp || 0) % Number(childData?.maxXp || 100);
  const xpMax = Number(childData?.maxXp || 100);
  const xpRemaining = Math.max(xpMax - xpCurrent, 0);
  const rewardXpTotal = Math.max(0, Number(childData?.rewardXpTotal || 0));
  const rewardXpCurrent = rewardXpTotal % 100;
  const rewardXpRemaining = rewardXpCurrent === 0 ? 100 : 100 - rewardXpCurrent;
  const privilegePoints = Math.max(0, Number(childData?.privilegePoints || 0));
  const focusCards = [
    {
      label: '成就完成',
      value: `${achievementPercent}%`,
      hint: `${unlockedCount}/${allAchievements.length || 0} 个`,
      icon: <Trophy size={18} />,
      className: 'bg-amber-50 text-amber-700 border-amber-100',
    },
    {
      label: '近期开箱',
      value: `${chestRecords.length} 次`,
      hint: CHEST_TIME_FILTERS.find(item => item.value === chestTimeFilter)?.label || '近7天',
      icon: <Archive size={18} />,
      className: 'bg-violet-50 text-violet-700 border-violet-100',
    },
    {
      label: '本周复盘',
      value: punishmentStats ? `${punishmentStats.weekCount} 次` : '-',
      hint: '帮助下次做得更好',
      icon: <ShieldCheck size={18} />,
      className: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    },
  ];
  const getAchCategory = (a: Achievement) => a.category || (a.conditionType?.startsWith('explore_') ? '探索' : '成长');
  const achievementCategories = ['全部', ...Array.from(new Set(allAchievements.map(getAchCategory)))];
  const categoryFiltered = achievementCategory === '全部' ? allAchievements : allAchievements.filter(a => getAchCategory(a) === achievementCategory);
  const visibleAchievements = achievementsExpanded ? categoryFiltered : categoryFiltered.slice(0, 6);
  const panelTabs = [
    { value: 'achievements' as const, label: '成就', count: `${unlockedCount}/${allAchievements.length || 0}` },
    { value: 'review' as const, label: '复盘', count: String(punishmentStats?.weekCount ?? 0) },
    { value: 'chest' as const, label: '宝箱', count: String(chestRecords.length) },
  ];
  const switchPanel = (panel: typeof activePanel) => {
    if (panel === 'chest') {
      const today = formatLocalDate(new Date());
      if (chestDefaultDateRef.current !== today) {
        chestDefaultDateRef.current = today;
        setChestTimeFilter('today');
        setChestTypeFilter('all');
      }
    }
    setActivePanel(panel);
  };

  return (
    <div className="p-4 space-y-4">
      <div data-testid="child-growth-account" className="rounded-[1.75rem] bg-white border border-indigo-100 p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-black text-indigo-500">{t('growth.accountTitle')}</div>
            <div className="mt-1 text-xl font-black text-slate-900 truncate">
              {getLevelTitle(Number(childData?.level || 1))}
              <span className="ml-2 text-xs font-black text-indigo-500">Lv.{childData?.level || 1}</span>
            </div>
          </div>
          <div className="rounded-2xl bg-indigo-50 px-3 py-2 text-right">
            <div className="text-lg font-black text-indigo-700">{privilegePoints} {t('growth.pointsUnit')}</div>
            <div className="text-[10px] font-black text-indigo-400">{t('growth.available')}</div>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <div className="flex items-center justify-between gap-2 text-xs font-black">
              <span className="text-violet-600">{t('growth.levelXp')}</span>
              <span className="text-slate-500">{xpCurrent} / {xpMax}</span>
            </div>
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-violet-50">
              <div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-indigo-500" style={{ width: `${Math.min((xpCurrent / Math.max(1, xpMax)) * 100, 100)}%` }} />
            </div>
            <div className="mt-1 text-[10px] font-bold text-slate-400">
              {t('growth.levelXpHint', { remaining: xpRemaining })}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 text-xs font-black">
              <span className="text-blue-600">{t('growth.rightsProgress')}</span>
              <span className="text-slate-500">{rewardXpCurrent} / 100</span>
            </div>
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-blue-50">
              <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-blue-500" style={{ width: `${rewardXpCurrent}%` }} />
            </div>
            <div className="mt-1 text-[10px] font-bold text-slate-400">
              {t('growth.rightsHint', { remaining: rewardXpRemaining })}
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 text-[11px] font-bold leading-relaxed text-slate-500">
          {t('growth.accountsExplain')}
        </div>
      </div>

      <div className="rounded-[1.75rem] bg-white border border-slate-100 p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-black text-slate-900">我的记录中心</div>
            <div className="mt-1 text-xs font-bold text-slate-500">
              看成就、复盘和宝箱，不重复顶部档案。
            </div>
          </div>
          <div className="rounded-2xl bg-indigo-50 text-indigo-600 px-3 py-2 text-right">
            <div className="text-xl font-black">{achievementPercent}%</div>
            <div className="text-[10px] font-black">成就进度</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {focusCards.map(card => (
            <div key={card.label} className={`rounded-2xl border p-2.5 min-h-[64px] ${card.className}`}>
              <div className="flex items-center justify-between gap-1">
                <div className="text-[10px] font-black leading-tight">{card.label}</div>
                <div className="opacity-80">{card.icon}</div>
              </div>
              <div className="mt-1 text-base font-black text-gray-900 leading-tight">{card.value}</div>
              <div className="text-[9px] font-bold opacity-75 mt-0.5 leading-tight">{card.hint}</div>
            </div>
          ))}
        </div>
      </div>

      {/* R3: 我的等级之路——称号 + 权益里程碑（纯展示，不锁功能） TODO i18n */}
      <div className="rounded-[1.75rem] bg-white border border-indigo-100 p-4 shadow-sm">
        <button
          type="button"
          onClick={() => setLevelPathExpanded(prev => !prev)}
          aria-expanded={levelPathExpanded}
          className="w-full min-h-[44px] flex items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-2xl flex-shrink-0 shadow-sm">🌟</div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-gray-400">我的等级之路</div>
              <div className="text-lg font-black text-indigo-700 truncate">
                {getLevelTitle(Number(childData?.level || 1))}
                <span className="ml-1.5 text-xs font-bold text-gray-400">Lv.{childData?.level || 1}</span>
              </div>
            </div>
          </div>
          <ChevronDown size={18} className={`text-gray-300 flex-shrink-0 transition-transform duration-200 ${levelPathExpanded ? 'rotate-180' : ''}`} />
        </button>

        {levelPathExpanded && (
          <div className="mt-3 space-y-2">
            {PERK_MILESTONES.map(milestone => {
              const reached = Number(childData?.level || 1) >= milestone.level;
              return (
                <div
                  key={milestone.level}
                  className={`flex items-center gap-3 rounded-2xl border p-3 ${reached ? 'bg-indigo-50 border-indigo-200' : 'bg-gray-50 border-gray-100'}`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0 ${reached ? 'bg-white shadow-sm' : 'bg-gray-100 grayscale opacity-60'}`}>
                    {milestone.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-black truncate ${reached ? 'text-indigo-900' : 'text-gray-400'}`}>{milestone.title}</div>
                    <div className={`text-[11px] truncate ${reached ? 'text-indigo-500' : 'text-gray-400'}`}>{milestone.desc}</div>
                  </div>
                  <div className="flex-shrink-0">
                    {milestone.status === 'coming' ? (
                      <span className="text-[10px] font-black px-2 py-1 rounded-full bg-amber-100 text-amber-600 whitespace-nowrap">
                        {reached ? '即将到来' : `Lv.${milestone.level} · 即将到来`}
                      </span>
                    ) : reached ? (
                      <span className="text-[10px] font-black px-2 py-1 rounded-full bg-emerald-100 text-emerald-600 whitespace-nowrap">✓ 已解锁</span>
                    ) : (
                      <span className="text-[10px] font-black text-gray-400 whitespace-nowrap">Lv.{milestone.level} 解锁</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 专注可视化卡：看见自己的专注力在长大（ADHD 特化 #1） */}
      {focusStats && (
        <div className="rounded-[1.75rem] bg-white border border-sky-100 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-sky-50 flex items-center justify-center flex-shrink-0">
              <Timer size={22} className="text-sky-500" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-gray-400">
                {t('focus.cardTitle')} · {t('focus.thisWeekLabel')}
              </div>
              <div className="text-2xl font-black text-sky-700 leading-tight">
                {t('focus.minutes', { minutes: focusStats.thisWeekMinutes })}
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-sky-50 border border-sky-100 px-3 py-2 text-[11px] font-black text-sky-700">
              {t('focus.longestSession', { minutes: focusStats.longestSessionMinutes })}
            </div>
            <div className="rounded-2xl bg-sky-50 border border-sky-100 px-3 py-2 text-[11px] font-black text-sky-700">
              {t('focus.sessionsCount', { count: focusStats.sessionsCount })}
            </div>
          </div>
          <div className="mt-2 text-xs font-bold text-gray-500">
            {focusStats.thisWeekMinutes === 0 && focusStats.lastWeekMinutes === 0
              ? t('focus.emptyHint')
              : focusStats.thisWeekMinutes > focusStats.lastWeekMinutes
                ? t('focus.moreThanLastWeek', { minutes: focusStats.thisWeekMinutes - focusStats.lastWeekMinutes })
                : focusStats.thisWeekMinutes < focusStats.lastWeekMinutes
                  ? t('focus.lessThanLastWeek')
                  : t('focus.sameAsLastWeek')}
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 rounded-[1.5rem] bg-white border border-gray-100 p-2 shadow-sm">
        {panelTabs.map(tab => (
          <button
            key={tab.value}
            type="button"
            onClick={() => switchPanel(tab.value)}
            className={`rounded-2xl px-2 py-2 text-center transition-all ${
              activePanel === tab.value ? 'bg-slate-900 text-white shadow-md' : 'text-gray-500 bg-gray-50'
            }`}
          >
            <div className="text-sm font-black">{tab.label}</div>
            <div className={`text-[10px] font-bold mt-0.5 ${activePanel === tab.value ? 'text-white/70' : 'text-gray-400'}`}>
              {tab.count}
            </div>
          </button>
        ))}
      </div>

      {activePanel === 'achievements' && (
      <Card className="bg-white border-sky-100">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-black text-gray-800 flex items-center gap-2">
              <Trophy size={18} className="text-amber-500" /> 成就与奖励
            </div>
            <div className="text-xs text-gray-500 mt-1">成就目标、当前进度和解锁奖励放在一起看。</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-black text-sky-600">{achievementPercent}%</div>
            <div className="text-[10px] text-gray-400 font-bold">成就完成</div>
          </div>
        </div>
        <div className="mt-4 h-2 rounded-full bg-gray-100 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500" style={{ width: `${achievementPercent}%` }} />
        </div>
        <div className="mt-2 text-[11px] font-bold text-gray-500">
          已解锁 {unlockedCount} 个，还剩 {Math.max(allAchievements.length - unlockedCount, 0)} 个可以点亮
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span className="text-[11px] font-bold text-gray-400 flex-shrink-0">分类</span>
          <select
            value={achievementCategory}
            onChange={e => { setAchievementCategory(e.target.value); setAchievementsExpanded(false); }}
            className="flex-1 min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-gray-700"
          >
            {achievementCategories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {allAchievements.length === 0 ? (
          <div className="text-center py-8 bg-gray-50 rounded-xl border-2 border-dashed text-gray-400 mt-4">
            <div className="text-4xl mb-2">🏅</div>
            <div>暂无成就，等待家长设置</div>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {visibleAchievements.map((ach, index) => {
              const isUnlocked = Boolean(ach.unlocked);
              const progressPercent = getProgressPercent(ach);
              const display = getAchievementDisplay(ach);
              const rewardParts = [
                Number(ach.rewardCoins || 0) > 0 ? `🪙 +${ach.rewardCoins}` : '',
                Number(ach.rewardXp || 0) > 0 ? `⭐ +${ach.rewardXp}` : '',
                Number(ach.rewardPrivilegePoints || 0) > 0 ? `👑 +${ach.rewardPrivilegePoints}` : '',
              ].filter(Boolean);
              return (
                <div key={ach.id || index} className={`rounded-2xl border p-3 ${isUnlocked ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-100'}`}>
                  <div className="flex items-center gap-3">
                    <GrowthIcon
                      iconKey={display.iconKey}
                      fallback={display.icon}
                      label={display.title}
                      locked={!isUnlocked}
                      className={isUnlocked ? 'shadow-sm' : ''}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-black text-gray-900 truncate">{display.title}</span>
                        {ach.conditionType?.startsWith('explore_') && <span className="text-[10px]">🧭</span>}
                      </div>
                      <div className="text-[11px] text-gray-500 truncate">{getConditionText(ach)}</div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div className={`h-full rounded-full ${isUnlocked ? 'bg-amber-400' : 'bg-sky-300'}`} style={{ width: `${progressPercent}%` }} />
                        </div>
                        <span className={`text-[10px] font-black flex-shrink-0 ${isUnlocked ? 'text-amber-600' : 'text-gray-400'}`}>
                          {isUnlocked ? '✅ 已点亮' : `${progressPercent}%`}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      {rewardParts.length > 0 ? (
                        <div className={`text-[11px] font-black ${isUnlocked ? 'text-amber-700' : 'text-gray-400'}`}>
                          {rewardParts.join(' ')}
                        </div>
                      ) : (
                        <div className="text-[10px] font-bold text-gray-300">无额外奖励</div>
                      )}
                      {ach.rewardDelivery === 'backpack' && (
                        <div className="text-[10px] font-bold text-gray-400">🎁 进背包</div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {categoryFiltered.length > 6 && (
              <button
                type="button"
                onClick={() => setAchievementsExpanded(prev => !prev)}
                className="w-full py-2.5 min-h-[44px] rounded-2xl bg-amber-50 border border-amber-100 text-sm font-black text-amber-700"
              >
                {achievementsExpanded ? '收起成就' : `展开全部 ${categoryFiltered.length} 个成就`}
              </button>
            )}
          </div>
        )}
      </Card>
      )}

      {/* 复盘记录区域 */}
      {activePanel === 'review' && (
      <div>
        <h2 className="font-bold text-lg mb-3 flex items-center gap-2">
          <Lock className="text-orange-500" size={20}/>
          复盘记录
        </h2>
        <p className="text-xs text-gray-500 -mt-2 mb-3">这里记录需要提醒的事情，重点是找到下一次更顺的方法。</p>

        {/* 统计卡片 */}
        {punishmentStats && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Card className="p-3 bg-gradient-to-br from-orange-50 to-red-50 border border-orange-200">
              <div className="text-xs text-gray-600 mb-1">总复盘次数</div>
              <div className="text-2xl font-black text-orange-600">{punishmentStats.totalCount}</div>
            </Card>
            <Card className="p-3 bg-gradient-to-br from-red-50 to-orange-50 border border-red-200">
              <div className="text-xs text-gray-600 mb-1">总扣除金币</div>
              <div className="text-2xl font-black text-red-600">-{punishmentStats.totalDeducted}</div>
            </Card>
          </div>
        )}

        {/* 趋势提示 */}
        {trendMessage && (
          <Card className={`p-3 mb-4 border-l-4 ${
            trendMessage.type === 'success' ? 'bg-green-50 border-green-500' :
            trendMessage.type === 'improve' ? 'bg-blue-50 border-blue-500' :
            trendMessage.type === 'warn' ? 'bg-orange-50 border-orange-500' :
            'bg-gray-50 border-gray-400'
          }`}>
            <div className="text-sm font-semibold text-gray-800">{trendMessage.text}</div>
            {punishmentStats?.daysSinceLastPunishment !== null && punishmentStats?.daysSinceLastPunishment !== undefined && (
              <div className="mt-3 border-t border-black/5 pt-3">
                <div className="flex justify-between text-xs text-gray-600 mb-1.5">
                  <span>表现良好天数：<strong className="text-green-600">{punishmentStats.daysSinceLastPunishment}</strong> 天</span>
                  <span>目标：7 天</span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-green-400 to-emerald-500 transition-all duration-1000"
                    style={{ width: `${Math.min((punishmentStats.daysSinceLastPunishment / 7) * 100, 100)}%` }}
                  />
                </div>
                {punishmentStats.daysSinceLastPunishment >= 7 && (
                  <div className="text-[10px] text-green-600 mt-1 font-medium">
                    🌟 你的惩罚影响已经清零啦！继续保持好习惯哦~
                  </div>
                )}
              </div>
            )}
          </Card>
        )}

        {/* 时间筛选：只留两个选项，固定按时间倒序展示 */}
        <div className="rounded-3xl bg-white border border-orange-100 shadow-sm mb-4 p-3">
          <div className="text-sm font-black text-gray-800 mb-2">复盘查看</div>
          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-gray-50 p-1">
            {(['month', 'all'] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => setTimeFilter(filter)}
                className={`px-3 py-2 min-h-[44px] rounded-lg text-sm font-bold transition-all ${
                  timeFilter === filter ? 'bg-orange-500 text-white shadow-sm' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {filter === 'month' ? '最近30天' : '全部'}
              </button>
            ))}
          </div>
        </div>

        {/* 复盘记录列表 */}
        {punishmentRecords.length > 0 ? (
          <div className="space-y-4">
            <div className="space-y-2">
              {sortedRecords.map((record) => (
                <Card
                  key={record.id}
                  className="p-3 bg-orange-50 border-l-4 border-orange-500 cursor-pointer hover:bg-orange-100 transition-colors"
                  onClick={() => setSelectedRecord(record)}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">{getLevelEmoji(record.level)}</span>
                        <span className="font-bold text-gray-800">{getLevelName(record.level)}</span>
                        <span className="text-[10px] text-gray-500">
                          {new Date(record.createdAt).toLocaleDateString(getDateLocale(), {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                      <div className="text-xs text-gray-600 mb-1 flex items-center gap-1">
                        <span className="bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded text-[9px] font-bold">{record.taskCategory}</span>
                        任务：<span className="font-semibold">{record.taskTitle}</span>
                      </div>
                      <div className="text-sm text-gray-700 bg-white/60 p-2 rounded line-clamp-1 italic text-xs">
                        "{record.reason}"
                      </div>
                    </div>
                    <div className="text-right ml-3">
                      <div className="text-xl font-black text-red-600">
                        -{record.deductedCoins}
                      </div>
                      <div className="text-[9px] text-gray-400">金币</div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {/* 展开/收起按钮 */}
            {punishmentRecords.length >= 3 && !expandedRecords && (
              <button
                onClick={() => setExpandedRecords(true)}
                className="w-full py-3 text-sm font-bold text-orange-600 bg-orange-50 rounded-xl hover:bg-orange-100 transition-colors flex items-center justify-center gap-1 border border-orange-200 border-dashed"
              >
                <ChevronDown size={16} /> 查看全部历史记录
              </button>
            )}
          </div>
        ) : (
          <Card className="p-8 text-center bg-gradient-to-br from-green-50 to-blue-50 border-2 border-dashed border-green-300">
            <div className="text-5xl mb-3">🎉</div>
            <div className="text-lg font-bold text-gray-800 mb-2">太棒了！</div>
            <div className="text-sm text-gray-600">
              {timeFilter === 'all'
                ? '你还没有任何复盘记录，继续保持！'
                : '最近30天没有复盘记录，继续保持！'
              }
            </div>
          </Card>
        )}

        {/* 按等级统计（如果有数据） */}
        {punishmentStats && punishmentStats.byLevel.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-semibold text-gray-600 mb-2">按等级统计</div>
            <div className="flex gap-2">
              {punishmentStats.byLevel.map((item) => (
                <div key={item.level} className="flex-1 p-2 bg-gray-50 rounded-lg text-center">
                  <div className="text-lg mb-1">{getLevelEmoji(item.level)}</div>
                  <div className="text-xs text-gray-600 mb-1">{getLevelName(item.level)}</div>
                  <div className="text-sm font-bold text-gray-800">{item.count}次</div>
                  <div className="text-xs text-red-600">-{item.totalDeducted}💰</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      )}

      {/* 详情弹窗 */}
      <Modal
        isOpen={selectedRecord !== null}
        onClose={() => setSelectedRecord(null)}
        title="复盘详情"
      >
        {selectedRecord && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-3 bg-orange-50 rounded-xl">
              <span className="text-3xl">{getLevelEmoji(selectedRecord.level)}</span>
              <div>
                <div className="font-bold text-lg text-gray-800">{getLevelName(selectedRecord.level)}</div>
                <div className="text-xs text-gray-500">
                  {new Date(selectedRecord.createdAt).toLocaleString(getDateLocale())}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <div className="text-xs font-semibold text-gray-600 mb-1">相关任务</div>
                <div className="p-2 bg-gray-50 rounded-lg text-sm font-semibold text-gray-800">
                  {selectedRecord.taskTitle}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-gray-600 mb-1">复盘原因</div>
                <div className="p-3 bg-orange-50 rounded-lg text-sm text-gray-700 border border-orange-200">
                  {selectedRecord.reason}
                </div>
              </div>

              <div className="flex items-center justify-between p-3 bg-red-50 rounded-lg border border-red-200">
                <div>
                  <div className="text-xs font-semibold text-gray-600 mb-1">扣除金币</div>
                  <div className="text-2xl font-black text-red-600">-{selectedRecord.deductedCoins}</div>
                </div>
                <div className="text-4xl">💰</div>
              </div>

              <div className="pt-2 border-t">
                <div className="text-xs text-gray-500 text-center">
                  和你复盘的人：{selectedRecord.parentName}
                </div>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* 宝箱记录 */}
      {activePanel === 'chest' && (
      <div className="mb-6">
        <h2 className="font-bold text-lg flex items-center gap-2 mb-3">
          <span className="text-xl">🎁</span> 宝箱记录
        </h2>
        <div className="bg-white rounded-2xl p-3 border shadow-sm mb-3 space-y-3">
          <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
            {CHEST_TIME_FILTERS.map(option => (
              <button
                key={option.value}
                onClick={() => setChestTimeFilter(option.value)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                  chestTimeFilter === option.value ? 'bg-blue-500 text-white shadow-sm' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
            {CHEST_REWARD_TYPES.map(option => (
              <button
                key={option.value}
                onClick={() => setChestTypeFilter(option.value)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                  chestTypeFilter === option.value ? 'bg-amber-500 text-white shadow-sm' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </div>
        {chestRecords.length > 0 ? (
          <div className="space-y-2">
            {chestRecords.map(record => (
              <Card key={record.id} className="p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-2xl bg-amber-50 flex items-center justify-center text-2xl">
                    {record.rewardIcon || '🎁'}
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-gray-800 text-sm truncate">
                      开出了 {record.rewardName}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 truncate">
                      通过任务：{record.taskTitle || '完成任务'}
                    </div>
                    <div className="text-[10px] text-amber-600 font-bold mt-1">
                      {t(CHEST_REWARD_TYPES.find(type => type.value === record.rewardType)?.labelKey || record.rewardType)}
                      {record.rewardValue ? ` +${record.rewardValue}` : ''}
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-gray-400 flex-shrink-0 text-right">
                  {new Date(record.createdAt).toLocaleDateString(getDateLocale(), { month: 'numeric', day: 'numeric' })}
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="p-8 text-center bg-gradient-to-br from-amber-50 to-orange-50 border-2 border-dashed border-amber-200">
            <div className="text-4xl mb-2">🎁</div>
            <div className="text-sm font-bold text-gray-700">当前筛选下还没有宝箱记录</div>
            <div className="text-xs text-gray-500 mt-1">完成任务后会立刻获得一次开箱反馈。</div>
          </Card>
        )}
      </div>
      )}

    </div>
  );
}
