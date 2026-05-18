import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Flame, TrendingUp, Trophy, Target, RefreshCw } from 'lucide-react';
import api from '../services/api';

interface StatsData {
  overview: {
    todayTasks: number;
    weekTasks: number;
    monthTasks: number;
    totalTasks: number;
    streakDays: number;
    maxStreakDays: number;
  };
  coins: {
    todayEarned: number;
    weekEarned: number;
    monthEarned: number;
    totalEarned: number;
    todaySpent: number;
    weekSpent: number;
    monthSpent: number;
    totalSpent: number;
  };
  categoryStats: { category: string; count: number; percent: number }[];
  dailyAverage: number;
  coinTrend: { date: string; dayOfWeek: string; earned: number }[];
  nearestAchievements: {
    id: string;
    title: string;
    description: string;
    icon: string;
    progress: number;
    percent: number;
    conditionValue: number;
  }[];
  children: {
    id: string;
    name: string;
    coins: number;
    xp: number;
    level: number;
    totalTasks: number;
  }[];
  wellbeing?: {
    punishmentCount: number;
    autoCompletedCount: number;
    emotionCheckins: number;
    helpfulEmotionRate: number | null;
    screenMinutes: number;
    screenSessions: number;
    chestCount: number;
    achievementCount: number;
  };
  dimensionScores?: {
    key: string;
    label: string;
    value: string;
    score: number;
    tone: 'green' | 'blue' | 'orange' | 'red' | string;
    hint: string;
  }[];
  recommendations?: string[];
}

// 类别颜色配置
const CATEGORY_COLORS: Record<string, { bg: string; text: string; fill: string }> = {
  '生活': { bg: 'bg-emerald-100', text: 'text-emerald-600', fill: 'fill-emerald-500' },
  '劳动': { bg: 'bg-orange-100', text: 'text-orange-600', fill: 'fill-orange-500' },
  '学习': { bg: 'bg-blue-100', text: 'text-blue-600', fill: 'fill-blue-500' },
  '活动': { bg: 'bg-purple-100', text: 'text-purple-600', fill: 'fill-purple-500' },
  '兴趣': { bg: 'bg-purple-100', text: 'text-purple-600', fill: 'fill-purple-500' },
  '运动': { bg: 'bg-green-100', text: 'text-green-600', fill: 'fill-green-500' },
};

const DIMENSION_TONES: Record<string, string> = {
  green: 'text-emerald-700 bg-emerald-50 border-emerald-100',
  blue: 'text-blue-700 bg-blue-50 border-blue-100',
  orange: 'text-orange-700 bg-orange-50 border-orange-100',
  red: 'text-red-700 bg-red-50 border-red-100',
};

const getDimensionTone = (tone?: string) => DIMENSION_TONES[tone || 'blue'] || DIMENSION_TONES.blue;

export const StatsPanel: React.FC = () => {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'coins' | 'achievements'>('overview');

  useEffect(() => {
    fetchStats();
    // 每60秒自动刷新统计数据，确保家长端看到最新的任务完成情况
    const refreshInterval = setInterval(fetchStats, 60000);
    return () => clearInterval(refreshInterval);
  }, []);

  const fetchStats = async (showLoading = false) => {
    try {
      if (showLoading) {
        setRefreshing(true);
      }
      const res = await api.get('/parent/stats');
      setStats(res.data);
    } catch (e) {
      console.error('获取统计数据失败', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    fetchStats(true);
  };

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl p-4 border border-indigo-100">
        <div className="animate-pulse flex items-center justify-center py-4">
          <div className="text-gray-400">加载统计数据...</div>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const { overview, coins, categoryStats, dailyAverage, coinTrend, nearestAchievements, children } = stats;
  const dimensionScores = stats.dimensionScores || [];
  const recommendations = stats.recommendations || [];
  const wellbeing = stats.wellbeing || {
    punishmentCount: 0,
    autoCompletedCount: 0,
    emotionCheckins: 0,
    helpfulEmotionRate: null,
    screenMinutes: 0,
    screenSessions: 0,
    chestCount: 0,
    achievementCount: 0,
  };
  const growthScore = dimensionScores.length > 0
    ? Math.round(dimensionScores.reduce((sum, item) => sum + item.score, 0) / dimensionScores.length)
    : null;
  const topRecommendation = recommendations[0];

  // 计算金币净值
  const weekNetCoins = coins.weekEarned - coins.weekSpent;
  const monthNetCoins = coins.monthEarned - coins.monthSpent;

  // 找到趋势中最大值用于计算比例
  const maxTrendValue = Math.max(...coinTrend.map(t => t.earned), 1);
  const topCategory = categoryStats[0];
  const growthSignals = [
    {
      label: '今日启动',
      value: `${overview.todayTasks} 个`,
      hint: overview.todayTasks > 0 ? '今天已经有行动记录' : '先完成一个低阻力任务',
      tone: 'text-emerald-700 bg-emerald-50 border-emerald-100',
    },
    {
      label: '稳定性',
      value: `${overview.streakDays} 天`,
      hint: overview.streakDays >= 3 ? '连续节奏正在形成' : '目标是连续 3 天不断线',
      tone: 'text-orange-700 bg-orange-50 border-orange-100',
    },
    {
      label: '能力分布',
      value: topCategory ? topCategory.category : '暂无',
      hint: topCategory ? `当前最常完成：${topCategory.percent}%` : '完成后会显示偏好',
      tone: 'text-blue-700 bg-blue-50 border-blue-100',
    },
    {
      label: '奖励流向',
      value: `${monthNetCoins >= 0 ? '+' : ''}${monthNetCoins}`,
      hint: monthNetCoins >= 0 ? '本月金币在积累' : '本月兑换多于获得',
      tone: monthNetCoins >= 0 ? 'text-violet-700 bg-violet-50 border-violet-100' : 'text-rose-700 bg-rose-50 border-rose-100',
    },
  ];

  return (
    <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl border border-indigo-100 overflow-hidden">
      {/* 头部 - 简要统计 */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
              <TrendingUp size={18} className="text-indigo-600"/>
              成长数据
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className={`px-2 py-1 rounded-full text-[11px] font-bold flex items-center gap-1 transition-all ${
                refreshing
                  ? 'bg-indigo-200 text-indigo-500 cursor-not-allowed'
                  : 'bg-white/70 text-indigo-600 hover:bg-white active:scale-95'
              }`}
              title="刷新数据"
            >
              <RefreshCw
                size={12}
                className={`text-indigo-600 ${refreshing ? 'animate-spin' : ''}`}
              />
              {refreshing ? '更新中' : '更新'}
            </button>
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs bg-white/60 text-indigo-600 px-2 py-1 rounded-full font-bold flex items-center gap-1 hover:bg-white transition-colors"
            >
              {expanded ? '收起' : '展开详情'}
              {expanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
            </button>
          </div>
        </div>

        {/* 核心指标卡片 */}
        <div className="mb-3 rounded-xl bg-white/70 border border-white p-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-black text-indigo-700">总览看什么</div>
            <div className="mt-1 text-[11px] leading-relaxed text-gray-500">
              看孩子有没有启动、奖励是否及时、规则压力是否合适，以及游戏票和情绪自助是否健康。
            </div>
          </div>
          {growthScore !== null && (
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-700 flex flex-col items-center justify-center flex-shrink-0">
              <div className="text-xl font-black">{growthScore}</div>
              <div className="text-[9px] font-bold">画像分</div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {/* 连续打卡 */}
          <div className="bg-white/70 rounded-xl p-3 text-center">
            <div className="flex items-center justify-center gap-1">
              <Flame size={18} className="text-orange-500"/>
              <span className="text-2xl font-black text-orange-500">{overview.streakDays}</span>
            </div>
            <div className="text-[10px] text-gray-500 mt-1">连续打卡</div>
          </div>

          {/* 今日任务 */}
          <div className="bg-white/70 rounded-xl p-3 text-center">
            <div className="text-2xl font-black text-green-600">{overview.todayTasks}</div>
            <div className="text-[10px] text-gray-500 mt-1">今日完成</div>
          </div>

          {/* 日均完成 */}
          <div className="bg-white/70 rounded-xl p-3 text-center">
            <div className="text-2xl font-black text-blue-600">{dailyAverage}</div>
            <div className="text-[10px] text-gray-500 mt-1">日均任务</div>
          </div>
        </div>

        {!expanded && topRecommendation && (
          <div className="mt-2 rounded-xl bg-amber-50 border border-amber-100 p-2.5">
            <div className="flex items-center gap-1.5 text-xs font-black text-amber-700">
              <Target size={14} /> 下一步建议
            </div>
            <div className="mt-1 text-[11px] leading-relaxed text-amber-800 font-bold line-clamp-2">
              {topRecommendation}
            </div>
          </div>
        )}
      </div>

      {/* 展开详情区域 */}
      {expanded && (
        <div className="border-t border-indigo-100">
          {/* Tab 切换 */}
          <div className="flex bg-white/50 p-1 mx-4 mt-3 rounded-lg">
            {[
              { key: 'overview', label: '📊 概览' },
              { key: 'coins', label: '💰 金币' },
              { key: 'achievements', label: '🏆 成就' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${
                  activeTab === tab.key
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="p-4 pt-3">
            {/* 概览 Tab */}
            {activeTab === 'overview' && (
              <div className="space-y-3">
                <div className="bg-white rounded-xl p-3">
                  <div className="text-xs font-bold text-gray-600 mb-2">核心信号</div>
                  <div className="grid grid-cols-2 gap-2">
                    {growthSignals.map(signal => (
                      <div key={signal.label} className={`rounded-xl border p-3 ${signal.tone}`}>
                        <div className="text-[10px] font-black opacity-80">{signal.label}</div>
                        <div className="mt-1 text-lg font-black truncate">{signal.value}</div>
                        <div className="mt-1 text-[10px] leading-snug opacity-75">{signal.hint}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {dimensionScores.length > 0 && (
                  <div className="bg-white rounded-xl p-3">
                    <div className="text-xs font-bold text-gray-600 mb-2">成长维度明细</div>
                    <div className="space-y-2">
                      {dimensionScores.map(item => (
                        <div key={item.key} className={`rounded-xl border p-3 ${getDimensionTone(item.tone)}`}>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-xs font-black">{item.label}</div>
                              <div className="text-[10px] mt-0.5 opacity-75 leading-snug">{item.hint}</div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <div className="text-lg font-black">{item.score}</div>
                              <div className="text-[10px] font-bold opacity-75">{item.value}</div>
                            </div>
                          </div>
                          <div className="mt-2 h-2 rounded-full bg-white/70 overflow-hidden">
                            <div className="h-full rounded-full bg-current opacity-70" style={{ width: `${item.score}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {categoryStats.length > 0 && (
                  <div className="bg-white rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-bold text-gray-600">任务类型分布</div>
                      <div className="text-[10px] text-gray-400">
                        共 {categoryStats.reduce((sum, c) => sum + c.count, 0)} 个任务
                      </div>
                    </div>
                    <div className="space-y-2">
                      {categoryStats.map(cat => {
                        const colors = CATEGORY_COLORS[cat.category] || { bg: 'bg-gray-100', text: 'text-gray-600' };
                        const barColor = {
                          '生活': 'bg-emerald-400',
                          '劳动': 'bg-orange-400',
                          '学习': 'bg-blue-400',
                          '活动': 'bg-purple-400',
                          '兴趣': 'bg-purple-400',
                          '运动': 'bg-green-400'
                        }[cat.category] || 'bg-gray-400';
                        return (
                          <div key={cat.category} className="flex items-center gap-2">
                            <span className={`text-[10px] w-8 font-bold ${colors.text}`}>
                              {cat.category}
                            </span>
                            <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${barColor} rounded-full transition-all`}
                                style={{ width: `${cat.percent}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-gray-500 w-12 text-right">
                              {cat.count}次 <span className="text-gray-400">{cat.percent}%</span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {recommendations.length > 0 && (
                  <div className="bg-white rounded-xl p-3">
                    <div className="text-xs font-bold text-gray-600 mb-2">接下来优先看</div>
                    <div className="space-y-2">
                      {recommendations.slice(0, 3).map((item, index) => (
                        <div key={index} className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-xs text-amber-800 font-bold leading-relaxed">
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="bg-white rounded-xl p-3">
                  <div className="text-xs font-bold text-gray-600 mb-2">体验质量</div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div>
                      <div className="text-lg font-black text-purple-600">{wellbeing.chestCount}</div>
                      <div className="text-[10px] text-gray-400">宝箱</div>
                    </div>
                    <div>
                      <div className="text-lg font-black text-red-500">{wellbeing.punishmentCount}</div>
                      <div className="text-[10px] text-gray-400">惩罚</div>
                    </div>
                    <div>
                      <div className="text-lg font-black text-blue-600">{wellbeing.screenMinutes}</div>
                      <div className="text-[10px] text-gray-400">游戏分钟</div>
                    </div>
                    <div>
                      <div className="text-lg font-black text-emerald-600">
                        {wellbeing.helpfulEmotionRate === null ? '-' : `${wellbeing.helpfulEmotionRate}%`}
                      </div>
                      <div className="text-[10px] text-gray-400">情绪有效</div>
                    </div>
                  </div>
                  {wellbeing.autoCompletedCount > 0 && (
                    <div className="mt-2 rounded-xl bg-blue-50 border border-blue-100 p-2 text-[11px] text-blue-700 font-bold leading-relaxed">
                      有 {wellbeing.autoCompletedCount} 个任务由系统跨日自动完成，孩子端和家长端会保留提醒记录。
                    </div>
                  )}
                </div>

                {children.length > 0 && (
                  <div className="bg-white rounded-xl p-3">
                    <div className="text-xs font-bold text-gray-600 mb-2">孩子成长快照</div>
                    <div className="space-y-2">
                      {children.map(child => (
                        <div key={child.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                          <div className="min-w-0">
                            <div className="text-sm font-black text-slate-800 truncate">{child.name}</div>
                            <div className="text-[10px] text-slate-400">Lv.{child.level} · {child.totalTasks} 个已通过任务</div>
                          </div>
                          <div className="text-right text-[10px] font-bold text-slate-500">
                            <div>{child.coins} 金币</div>
                            <div>{child.xp} 经验</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* 任务完成数统计 */}
                <div className="bg-white rounded-xl p-3">
                  <div className="text-xs font-bold text-gray-600 mb-2">任务完成数</div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div>
                      <div className="text-lg font-black text-gray-800">{overview.todayTasks}</div>
                      <div className="text-[10px] text-gray-400">今日</div>
                    </div>
                    <div>
                      <div className="text-lg font-black text-gray-800">{overview.weekTasks}</div>
                      <div className="text-[10px] text-gray-400">本周</div>
                    </div>
                    <div>
                      <div className="text-lg font-black text-gray-800">{overview.monthTasks}</div>
                      <div className="text-[10px] text-gray-400">本月</div>
                    </div>
                    <div>
                      <div className="text-lg font-black text-indigo-600">{overview.totalTasks}</div>
                      <div className="text-[10px] text-gray-400">累计</div>
                    </div>
                  </div>
                </div>

                {/* 连续打卡 */}
                <div className="bg-white rounded-xl p-3">
                  <div className="text-xs font-bold text-gray-600 mb-2">连续打卡</div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Flame size={24} className="text-orange-500"/>
                      <div>
                        <div className="text-2xl font-black text-orange-500">{overview.streakDays} 天</div>
                        <div className="text-[10px] text-gray-400">当前连续</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-gray-600">{overview.maxStreakDays} 天</div>
                      <div className="text-[10px] text-gray-400">历史最长</div>
                    </div>
                  </div>
                  {overview.streakDays > 0 && overview.streakDays >= overview.maxStreakDays && (
                    <div className="mt-2 text-xs text-center text-orange-600 bg-orange-50 py-1 rounded-lg">
                      🎉 正在创造新纪录！
                    </div>
                  )}
                </div>

                {/* 最近7天趋势 */}
                <div className="bg-white rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-bold text-gray-600">最近7天金币获得</div>
                    <div className="text-sm font-black text-indigo-600">
                      共 {coinTrend.reduce((sum, d) => sum + d.earned, 0)} 💰
                    </div>
                  </div>
                  <div className="flex items-end justify-between h-16 gap-1">
                    {coinTrend.map((day, i) => (
                      <div key={i} className="flex-1 flex flex-col items-center">
                        <div className="text-[8px] text-indigo-600 font-bold mb-0.5">
                          {day.earned > 0 ? day.earned : ''}
                        </div>
                        <div
                          className="w-full bg-gradient-to-t from-indigo-400 to-indigo-300 rounded-t transition-all"
                          style={{
                            height: `${Math.max((day.earned / maxTrendValue) * 100, 4)}%`,
                            minHeight: day.earned > 0 ? '8px' : '2px'
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  {/* 日期和周几 */}
                  <div className="flex justify-between mt-1.5 border-t border-gray-100 pt-1.5">
                    {coinTrend.map((day, i) => (
                      <div key={i} className="flex-1 text-center">
                        <div className="text-[9px] text-gray-500 font-medium">{day.dayOfWeek}</div>
                        <div className="text-[8px] text-gray-400">
                          {day.date.slice(5).replace('-', '/')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 金币 Tab */}
            {activeTab === 'coins' && (
              <div className="space-y-3">
                {/* 获得金币 */}
                <div className="bg-white rounded-xl p-3">
                  <div className="text-xs font-bold text-green-600 mb-2">💰 金币获得</div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div>
                      <div className="text-lg font-black text-green-600">+{coins.todayEarned}</div>
                      <div className="text-[10px] text-gray-400">今日</div>
                    </div>
                    <div>
                      <div className="text-lg font-black text-green-600">+{coins.weekEarned}</div>
                      <div className="text-[10px] text-gray-400">本周</div>
                    </div>
                    <div>
                      <div className="text-lg font-black text-green-600">+{coins.monthEarned}</div>
                      <div className="text-[10px] text-gray-400">本月</div>
                    </div>
                    <div>
                      <div className="text-lg font-black text-green-700">+{coins.totalEarned}</div>
                      <div className="text-[10px] text-gray-400">累计</div>
                    </div>
                  </div>
                </div>

                {/* 消耗金币 */}
                <div className="bg-white rounded-xl p-3">
                  <div className="text-xs font-bold text-red-500 mb-2">🛒 金币消耗</div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div>
                      <div className="text-lg font-black text-red-500">-{coins.todaySpent}</div>
                      <div className="text-[10px] text-gray-400">今日</div>
                    </div>
                    <div>
                      <div className="text-lg font-black text-red-500">-{coins.weekSpent}</div>
                      <div className="text-[10px] text-gray-400">本周</div>
                    </div>
                    <div>
                      <div className="text-lg font-black text-red-500">-{coins.monthSpent}</div>
                      <div className="text-[10px] text-gray-400">本月</div>
                    </div>
                    <div>
                      <div className="text-lg font-black text-red-600">-{coins.totalSpent}</div>
                      <div className="text-[10px] text-gray-400">累计</div>
                    </div>
                  </div>
                </div>

                {/* 净流入 */}
                <div className="bg-white rounded-xl p-3">
                  <div className="text-xs font-bold text-gray-600 mb-2">📈 金币净流入</div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center">
                      <div className={`text-xl font-black ${weekNetCoins >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {weekNetCoins >= 0 ? '+' : ''}{weekNetCoins}
                      </div>
                      <div className="text-[10px] text-gray-400">本周净值</div>
                    </div>
                    <div className="text-center">
                      <div className={`text-xl font-black ${monthNetCoins >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {monthNetCoins >= 0 ? '+' : ''}{monthNetCoins}
                      </div>
                      <div className="text-[10px] text-gray-400">本月净值</div>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-center text-gray-500 bg-gray-50 py-1 rounded-lg">
                    {monthNetCoins >= 0
                      ? '✨ 孩子正在积极存钱！'
                      : '💡 消费超过收入，可以鼓励多完成任务'}
                  </div>
                </div>
              </div>
            )}

            {/* 成就 Tab */}
            {activeTab === 'achievements' && (
              <div className="space-y-3">
                {nearestAchievements.length === 0 ? (
                  <div className="bg-white rounded-xl p-4 text-center text-gray-400">
                    <Trophy size={32} className="mx-auto mb-2 text-gray-300"/>
                    <div>暂无接近解锁的成就</div>
                    <div className="text-xs mt-1">去"成就管理"添加一些吧！</div>
                  </div>
                ) : (
                  <>
                    <div className="text-xs text-gray-500 mb-1">🎯 最接近解锁的成就</div>
                    {nearestAchievements.map(ach => (
                      <div key={ach.id} className="bg-white rounded-xl p-3">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 bg-gradient-to-br from-yellow-100 to-orange-100 rounded-xl flex items-center justify-center text-2xl">
                            {ach.icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-bold text-gray-800 truncate">{ach.title}</div>
                            <div className="text-xs text-gray-500 truncate">{ach.description}</div>
                            <div className="mt-1 flex items-center gap-2">
                              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-yellow-400 to-orange-400 transition-all"
                                  style={{ width: `${ach.percent}%` }}
                                />
                              </div>
                              <span className="text-xs font-bold text-orange-600">{ach.percent}%</span>
                            </div>
                            <div className="text-[10px] text-gray-400 mt-0.5">
                              进度: {ach.progress} / {ach.conditionValue}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default StatsPanel;
