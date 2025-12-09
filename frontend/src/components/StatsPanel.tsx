import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Flame, TrendingUp, Trophy, Target } from 'lucide-react';
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
}

// 类别颜色配置
const CATEGORY_COLORS: Record<string, { bg: string; text: string; fill: string }> = {
  '劳动': { bg: 'bg-orange-100', text: 'text-orange-600', fill: 'fill-orange-500' },
  '学习': { bg: 'bg-blue-100', text: 'text-blue-600', fill: 'fill-blue-500' },
  '兴趣': { bg: 'bg-purple-100', text: 'text-purple-600', fill: 'fill-purple-500' },
  '运动': { bg: 'bg-green-100', text: 'text-green-600', fill: 'fill-green-500' },
};

export const StatsPanel: React.FC = () => {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'coins' | 'achievements'>('overview');

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const res = await api.get('/parent/stats');
      setStats(res.data);
    } catch (e) {
      console.error('获取统计数据失败', e);
    } finally {
      setLoading(false);
    }
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

  const { overview, coins, categoryStats, dailyAverage, coinTrend, nearestAchievements } = stats;

  // 计算金币净值
  const weekNetCoins = coins.weekEarned - coins.weekSpent;
  const monthNetCoins = coins.monthEarned - coins.monthSpent;

  // 找到趋势中最大值用于计算比例
  const maxTrendValue = Math.max(...coinTrend.map(t => t.earned), 1);

  return (
    <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-2xl border border-indigo-100 overflow-hidden">
      {/* 头部 - 简要统计 */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <TrendingUp size={18} className="text-indigo-600"/>
            成长数据
          </h3>
          <button 
            onClick={() => setExpanded(!expanded)}
            className="text-xs bg-white/60 text-indigo-600 px-2 py-1 rounded-full font-bold flex items-center gap-1 hover:bg-white transition-colors"
          >
            {expanded ? '收起' : '展开详情'}
            {expanded ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
          </button>
        </div>

        {/* 核心指标卡片 */}
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

        {/* 分类任务统计 */}
        {categoryStats.length > 0 && (
          <div className="mt-3 bg-white/70 rounded-xl p-3">
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
                  '劳动': 'bg-orange-400',
                  '学习': 'bg-blue-400',
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

