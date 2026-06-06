import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Card } from '../../components/Card';
import { Trophy, Lock, ChevronDown, ChevronUp, TrendingUp, Archive, ShieldCheck } from 'lucide-react';
import { Modal } from '../../components/Modal';
import api, { isAuthError } from '../../services/api';
import { useOutletContext } from 'react-router-dom';
import { useToast } from '../../components/Toast';
import {
  getAchievementDisplay as getSharedAchievementDisplay,
} from '../../utils/achievementDisplay';

interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  displayTitle?: string;
  displayDescription?: string;
  displayIcon?: string;
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
  { value: 'all', label: '全部奖励' },
  { value: 'coins', label: '金币' },
  { value: 'xp', label: '经验' },
  { value: 'privilegePoints', label: '特权点' },
  { value: 'lotteryTicket', label: '游戏票' },
  { value: 'shopDiscount', label: '兑换折扣' },
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
  const childData = context?.childData || { coins: 0, xp: 0, level: 1, privilegePoints: 0 };
  const toast = useToast();

  const [allAchievements, setAllAchievements] = useState<Achievement[]>([]);
  const [punishmentRecords, setPunishmentRecords] = useState<PunishmentRecord[]>([]);
  const [chestRecords, setChestRecords] = useState<ChestRecord[]>([]);
  const [punishmentStats, setPunishmentStats] = useState<PunishmentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedRecords, setExpandedRecords] = useState(false);
  const [timeFilter, setTimeFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [groupMode, setGroupMode] = useState<'none' | 'category'>('none');
  const [sortMode, setSortMode] = useState<'time' | 'coins' | 'name'>('time');
  const [chestTimeFilter, setChestTimeFilter] = useState<ChestTimeFilter>('today');
  const [chestTypeFilter, setChestTypeFilter] = useState('all');
  const [selectedRecord, setSelectedRecord] = useState<PunishmentRecord | null>(null);
  const [openCategories, setOpenCategories] = useState<string[]>([]);
  const [activePanel, setActivePanel] = useState<'achievements' | 'review' | 'chest'>('achievements');
  const [achievementsExpanded, setAchievementsExpanded] = useState(false);
  const [claimingAchievementId, setClaimingAchievementId] = useState<string | null>(null);
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

  // 处理排序与归类
  const getProcessedRecords = () => {
    let list = [...punishmentRecords];

    // 排序
    list.sort((a, b) => {
      if (sortMode === 'time') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sortMode === 'coins') return b.deductedCoins - a.deductedCoins;
      if (sortMode === 'name') return a.taskTitle.localeCompare(b.taskTitle);
      return 0;
    });

    if (groupMode === 'none') return { groups: [{ name: '所有记录', items: list }] };

    const groups: Record<string, PunishmentRecord[]> = {};
    list.forEach(r => {
      const cat = r.taskCategory || '未分类';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(r);
    });

    return {
      groups: Object.entries(groups).map(([name, items]) => ({ name, items }))
    };
  };

  const processedData = getProcessedRecords();

  const toggleCategory = (cat: string) => {
    setOpenCategories(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
  };

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

  const claimAchievementReward = async (ach: Achievement) => {
    if (!ach.unlocked || !ach.rewardClaimable || claimingAchievementId) return;
    setClaimingAchievementId(ach.id);
    try {
      const res = await api.post(`/child/achievements/${ach.id}/claim`);
      const parts = [
        res.data?.rewardCoins ? `${res.data.rewardCoins} 金币` : '',
        res.data?.rewardXp ? `${res.data.rewardXp} 经验` : '',
        res.data?.rewardPrivilegePoints ? `${res.data.rewardPrivilegePoints} 特权点` : '',
      ].filter(Boolean).join('、');
      toast.success(res.data?.rewardDelivery === 'backpack'
        ? '成就礼包已放入背包'
        : `领取成功${parts ? `：${parts}` : ''}`);
      await fetchAchievements();
      context?.refresh?.();
    } catch (e: any) {
      toast.error(e.response?.data?.message || '领取失败');
    } finally {
      setClaimingAchievementId(null);
    }
  };

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
      case 'xp_count': return `累计获得 ${ach.conditionValue} 经验`;
      case 'level_reach': return `达到 ${ach.conditionValue} 级`;
      case 'category_count': return `完成 ${ach.conditionValue} 个${ach.conditionCategory || ''}任务`;
      case 'streak_days': return `连续 ${ach.conditionValue} 天${ach.conditionCategory ? `完成${ach.conditionCategory}` : '完成任务'}`;
      case 'manual': return '特殊成就';
      default: return ach.description;
    }
  };

  const getAchievementDisplay = getSharedAchievementDisplay;

  const getProgressPercent = (ach: Achievement) => {
    if (ach.unlocked) return 100;
    if (!ach.progress || !ach.conditionValue) return 0;
    return Math.min(Math.round((ach.progress / ach.conditionValue) * 100), 99);
  };

  const getRewardText = (ach: Achievement) => {
    const parts = [
      Number(ach.rewardCoins || 0) > 0 ? `${ach.rewardCoins} 金币` : '',
      Number(ach.rewardXp || 0) > 0 ? `${ach.rewardXp} 经验` : '',
      Number(ach.rewardPrivilegePoints || 0) > 0 ? `${ach.rewardPrivilegePoints} 特权点` : '',
    ].filter(Boolean);
    if (!parts.length) return '无额外奖励';
    return `${parts.join(' + ')}${ach.rewardDelivery === 'backpack' ? '，放入背包' : '，立即发放'}`;
  };

  const sortMeta = {
    time: { label: '最近优先', hint: '按复盘发生时间从新到旧排列' },
    coins: { label: '扣分最多', hint: '把影响最大的记录放在前面' },
    name: { label: '任务名称 A-Z', hint: '按任务名称归并查看，适合找重复触发点' },
  }[sortMode];

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
      case 'mild': return '轻度警告';
      case 'moderate': return '中度惩罚';
      case 'severe': return '严重惩罚';
      case 'custom': return '自定义扣除';
      default: return '惩罚';
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
      return { text: '📈 有进步！惩罚次数比上周减少了', type: 'improve' };
    } else if (weekCount > prevWeekCount) {
      return { text: '⚠️ 需要改进，惩罚次数比上周增加了', type: 'warn' };
    } else if (weekCount === prevWeekCount && weekCount > 0) {
      return { text: '📊 保持稳定，继续努力减少惩罚', type: 'neutral' };
    }

    return null;
  };

  const trendMessage = getTrendMessage();
  const achievementPercent = allAchievements.length ? Math.round((unlockedCount / allAchievements.length) * 100) : 0;
  const xpCurrent = Number(childData?.xp || 0) % Number(childData?.maxXp || 100);
  const xpMax = Number(childData?.maxXp || 100);
  const xpRemaining = Math.max(xpMax - xpCurrent, 0);
  const focusCards = [
    {
      label: '升级还差',
      value: `${xpRemaining} XP`,
      hint: `当前 Lv.${childData?.level || 1}`,
      icon: <TrendingUp size={18} />,
      className: 'bg-sky-50 text-sky-700 border-sky-100',
    },
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
  const visibleAchievements = achievementsExpanded ? allAchievements : allAchievements.slice(0, 3);
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
        <div className="mt-3 grid grid-cols-4 gap-2">
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

        {allAchievements.length === 0 ? (
          <div className="text-center py-8 bg-gray-50 rounded-xl border-2 border-dashed text-gray-400 mt-4">
            <div className="text-4xl mb-2">🏅</div>
            <div>暂无成就，等待家长设置</div>
          </div>
        ) : (
          <div className="space-y-3 mt-4">
            {visibleAchievements.map((ach, index) => {
              const isUnlocked = Boolean(ach.unlocked);
              const progressPercent = getProgressPercent(ach);
              const display = getAchievementDisplay(ach);
              const displayTitle = display.title;
              const displayDescription = display.description;
              const displayIcon = display.icon;
              return (
                <div
                  key={ach.id || index}
                  className={`rounded-3xl border p-3 ${
                    isUnlocked
                      ? 'bg-gradient-to-br from-yellow-50 to-orange-50 border-yellow-200'
                      : 'bg-gray-50 border-gray-100'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0 ${isUnlocked ? 'bg-white shadow-sm' : 'bg-white grayscale opacity-60'}`}>
                      {displayIcon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <div className="font-black text-gray-900">{displayTitle}</div>
                            {display.rank.label && (
                              <span className="text-[9px] font-black text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full">
                                {display.rank.icon || displayIcon} {display.rank.label}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">{displayDescription}</div>
                        </div>
                        <span className={`text-[10px] font-black px-2 py-1 rounded-full flex-shrink-0 ${isUnlocked ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>
                          {isUnlocked ? '已解锁' : `${progressPercent}%`}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                        <div className="rounded-2xl bg-white/80 p-2">
                            <div className="font-black text-gray-400">达成条件</div>
                          <div className="font-bold text-gray-700 mt-0.5">{displayDescription}</div>
                        </div>
                        <div className="rounded-2xl bg-white/80 p-2">
                          <div className="font-black text-gray-400">解锁奖励</div>
                          <div className="font-bold text-gray-700 mt-0.5">{getRewardText(ach)}</div>
                        </div>
                      </div>
                      {isUnlocked && (
                        <div className="mt-3">
                          {ach.rewardClaimable ? (
                            <button
                              type="button"
                              disabled={claimingAchievementId === ach.id}
                              onClick={() => claimAchievementReward(ach)}
                              className="w-full rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 py-2.5 text-sm font-black text-white shadow-sm disabled:opacity-60"
                            >
                              {claimingAchievementId === ach.id
                                ? '领取中...'
                                : ach.rewardDelivery === 'backpack'
                                  ? '领取成就礼包'
                                  : '领取奖励'}
                            </button>
                          ) : (
                            <div className="rounded-2xl bg-white/70 px-3 py-2 text-[11px] font-bold text-emerald-700">
                              {ach.rewardClaimedAt
                                ? `奖励已领取：${new Date(ach.rewardClaimedAt).toLocaleDateString('zh-CN')}`
                                : '这个成就没有额外奖励'}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="mt-3">
                        <div className="flex justify-between text-[10px] font-bold text-gray-400 mb-1">
                          <span>{isUnlocked ? '完成进度' : `当前 ${Math.min(Number(ach.progress || 0), Number(ach.conditionValue || 0))}/${ach.conditionValue || 0}`}</span>
                          <span>{isUnlocked && ach.unlockedAt ? `解锁于 ${new Date(ach.unlockedAt).toLocaleDateString('zh-CN')}` : `${progressPercent}%`}</span>
                        </div>
                        <div className="h-2 rounded-full bg-white overflow-hidden">
                          <div className={`h-full rounded-full ${isUnlocked ? 'bg-emerald-400' : 'bg-blue-400'}`} style={{ width: `${progressPercent}%` }} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {allAchievements.length > 3 && (
              <button
                type="button"
                onClick={() => setAchievementsExpanded(prev => !prev)}
                className="w-full py-3 rounded-2xl bg-amber-50 border border-amber-100 text-sm font-black text-amber-700"
              >
                {achievementsExpanded ? '收起成就' : `展开全部 ${allAchievements.length} 个成就`}
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

        {/* 筛选与排序控制 */}
        <div className="rounded-3xl bg-white border border-orange-100 shadow-sm mb-4 p-3 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-black text-gray-800">复盘查看</div>
              <div className="text-[11px] font-bold text-gray-400 mt-0.5">{sortMeta.hint}</div>
            </div>
            <div className="rounded-full bg-purple-50 px-2 py-1 text-[10px] font-black text-purple-700">
              {sortMeta.label}
            </div>
          </div>
          <div className="space-y-2">
            <div>
              <div className="text-[10px] font-black text-gray-400 mb-1">时间</div>
              <div className="grid grid-cols-4 gap-1 rounded-2xl bg-gray-50 p-1">
              {(['all', 'today', 'week', 'month'] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setTimeFilter(filter)}
                  className={`px-3 py-1 rounded-lg text-[10px] font-bold transition-all ${
                    timeFilter === filter ? 'bg-orange-500 text-white shadow-sm' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {filter === 'all' ? '全部' : filter === 'today' ? '今天' : filter === 'week' ? '本周' : '本月'}
                </button>
              ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] font-black text-gray-400 mb-1">显示</div>
                <div className="grid grid-cols-2 gap-1 rounded-2xl bg-gray-50 p-1">
              <button onClick={() => setGroupMode('none')} className={`px-3 py-1 rounded-lg text-[10px] font-bold transition-all ${groupMode === 'none' ? 'bg-blue-500 text-white shadow-sm' : 'bg-gray-100 text-gray-500'}`}>列表</button>
              <button onClick={() => setGroupMode('category')} className={`px-3 py-1 rounded-lg text-[10px] font-bold transition-all ${groupMode === 'category' ? 'bg-blue-500 text-white shadow-sm' : 'bg-gray-100 text-gray-500'}`}>分类</button>
                </div>
              </div>
              <div>
                <div className="text-[10px] font-black text-gray-400 mb-1">排序</div>
                <div className="grid grid-cols-3 gap-1 rounded-2xl bg-gray-50 p-1">
                  <button onClick={() => setSortMode('time')} className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${sortMode === 'time' ? 'bg-purple-500 text-white shadow-sm' : 'bg-gray-100 text-gray-500'}`}>最近</button>
                  <button onClick={() => setSortMode('coins')} className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${sortMode === 'coins' ? 'bg-purple-500 text-white shadow-sm' : 'bg-gray-100 text-gray-500'}`}>扣分</button>
                  <button onClick={() => setSortMode('name')} className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${sortMode === 'name' ? 'bg-purple-500 text-white shadow-sm' : 'bg-gray-100 text-gray-500'}`}>名称</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 复盘记录列表 */}
        {punishmentRecords.length > 0 ? (
          <div className="space-y-4">
            {processedData.groups.map((group) => {
              const isCollapsed = groupMode === 'category' && !openCategories.includes(group.name);
              return (
                <div key={group.name} className="space-y-2">
                  {groupMode === 'category' && (
                    <button
                      onClick={() => toggleCategory(group.name)}
                      className="w-full flex items-center justify-between px-2 py-1 bg-gray-100/50 rounded-lg"
                    >
                      <span className="text-xs font-bold text-gray-500">{group.name} ({group.items.length})</span>
                      {isCollapsed ? <ChevronDown size={14} className="text-gray-400"/> : <ChevronUp size={14} className="text-gray-400"/>}
                    </button>
                  )}

                  {!isCollapsed && group.items.map((record) => (
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
                              {new Date(record.createdAt).toLocaleDateString('zh-CN', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </span>
                            <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                              {sortMode === 'time'
                                ? '按时间'
                                : sortMode === 'coins'
                                  ? `扣 ${record.deductedCoins}`
                                  : record.taskTitle?.slice(0, 1) || '#'}
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
              );
            })}

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
                : `在${timeFilter === 'today' ? '今天' : timeFilter === 'week' ? '本周' : '本月'}没有复盘记录，继续努力！`
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
                  {new Date(selectedRecord.createdAt).toLocaleString('zh-CN')}
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
                  执行人：{selectedRecord.parentName}
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
                {option.label}
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
                      {CHEST_REWARD_TYPES.find(t => t.value === record.rewardType)?.label || record.rewardType}
                      {record.rewardValue ? ` +${record.rewardValue}` : ''}
                    </div>
                  </div>
                </div>
                <div className="text-[10px] text-gray-400 flex-shrink-0 text-right">
                  {new Date(record.createdAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
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

      {/* 成就墙 - 显示所有成就（含未解锁） */}
      <div className="hidden">
        <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-lg flex items-center gap-2">
                <Trophy className="text-yellow-500" size={20}/>
                成就殿堂
            </h2>
            <div className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full font-bold">
                {unlockedCount} / {allAchievements.length} 已解锁
            </div>
        </div>

        {allAchievements.length === 0 ? (
            <div className="text-center py-8 bg-gray-50 rounded-xl border-2 border-dashed text-gray-400">
                <div className="text-4xl mb-2">🏅</div>
                <div>暂无成就，等待家长设置</div>
            </div>
        ) : (
            <div className="grid grid-cols-3 gap-3">
                {allAchievements.map((ach, index) => {
                    const isUnlocked = ach.unlocked;
                    const progressPercent = getProgressPercent(ach);
                    const display = getAchievementDisplay(ach);

                    return (
                        <div
                            key={ach.id || index}
                            className={`relative aspect-square rounded-2xl flex flex-col items-center justify-center p-2 transition-all duration-300 overflow-hidden group
                                ${isUnlocked
                                    ? 'bg-gradient-to-br from-yellow-50 to-orange-100 border-2 border-yellow-300 shadow-md hover:scale-105 hover:shadow-lg'
                                    : 'bg-gray-100 border-2 border-gray-200 hover:border-gray-300'
                                }`}
                        >
                            {/* 进度条背景 (未解锁时显示) */}
                            {!isUnlocked && progressPercent > 0 && (
                                <div
                                    className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-blue-200/50 to-transparent transition-all"
                                    style={{ height: `${progressPercent}%` }}
                                />
                            )}

                            {/* 图标 */}
                            <div className={`text-3xl mb-1 transition-all ${isUnlocked ? 'drop-shadow-md' : 'grayscale opacity-40'}`}>
                                {display.icon}
                            </div>

                            {/* 标题 */}
                            <div className={`text-[10px] font-bold text-center leading-tight ${isUnlocked ? 'text-gray-800' : 'text-gray-400'}`}>
                                {display.title}
                            </div>

                            {/* 锁定图标或进度 */}
                            {!isUnlocked && (
                                <div className="absolute top-1 right-1">
                                    <Lock size={12} className="text-gray-300" />
                                </div>
                            )}

                            {/* 悬停提示 */}
                            <div className="absolute inset-0 bg-black/80 text-white opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-2 rounded-2xl">
                                <div className="text-lg mb-1">{display.icon}</div>
                                <div className="text-[10px] font-bold text-center">{display.title}</div>
                                <div className="text-[8px] text-gray-300 text-center mt-1 leading-tight">
                                    {isUnlocked ? '✅ 已解锁' : getConditionText(ach)}
                                </div>
                                {!isUnlocked && progressPercent > 0 && (
                                    <div className="text-[8px] text-blue-300 mt-1">
                                        进度: {progressPercent}%
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        )}
      </div>
    </div>
  );
}
