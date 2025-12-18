import React, { useEffect, useState } from 'react';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Trophy, Lock, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Modal } from '../../components/Modal';
import api from '../../services/api';
import { useOutletContext } from 'react-router-dom';

interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  conditionType: string;
  conditionValue: number;
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

export default function ChildMe() {
  const context = useOutletContext<any>();
  const childData = context?.childData || { coins: 0, xp: 0, level: 1, privilegePoints: 0 };
  const refresh = context?.refresh || (() => {});
  
  const [allAchievements, setAllAchievements] = useState<Achievement[]>([]);
  const [punishmentRecords, setPunishmentRecords] = useState<PunishmentRecord[]>([]);
  const [punishmentStats, setPunishmentStats] = useState<PunishmentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedRecords, setExpandedRecords] = useState(false);
  const [timeFilter, setTimeFilter] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [selectedRecord, setSelectedRecord] = useState<PunishmentRecord | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const achRes = await api.get('/child/all-achievements');
        setAllAchievements(achRes.data || []);
        
        // 获取惩罚统计
        try {
          const statsRes = await api.get('/child/punishment-stats');
          setPunishmentStats(statsRes.data);
        } catch (statsErr) {
          console.error('获取惩罚统计失败:', statsErr);
        }
        
        // 获取惩罚记录
        await fetchPunishmentRecords();
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const fetchPunishmentRecords = async () => {
    try {
      const limit = expandedRecords ? 100 : 3;
      const punishRes = await api.get('/child/punishment-records', { 
        params: { limit, timeFilter } 
      });
      setPunishmentRecords(punishRes.data || []);
    } catch (punishErr) {
      console.error('获取惩罚记录失败:', punishErr);
    }
  };

  useEffect(() => {
    fetchPunishmentRecords();
  }, [timeFilter, expandedRecords]);

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
      default: return '⚠️';
    }
  };
  
  const getLevelName = (level: string) => {
    switch (level) {
      case 'mild': return '轻度警告';
      case 'moderate': return '中度惩罚';
      case 'severe': return '严重惩罚';
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

  return (
    <div className="p-4 space-y-6">
      {/* 惩罚记录区域 */}
      <div>
        <h2 className="font-bold text-lg mb-3 flex items-center gap-2">
          <Lock className="text-orange-500" size={20}/> 
          惩罚记录
        </h2>

        {/* 统计卡片 */}
        {punishmentStats && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Card className="p-3 bg-gradient-to-br from-orange-50 to-red-50 border border-orange-200">
              <div className="text-xs text-gray-600 mb-1">总惩罚次数</div>
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
            {punishmentStats?.daysSinceLastPunishment !== null && punishmentStats?.daysSinceLastPunishment !== undefined && punishmentStats.daysSinceLastPunishment > 0 && (
              <div className="text-xs text-gray-600 mt-1">
                距离上次惩罚已 {punishmentStats.daysSinceLastPunishment} 天
              </div>
            )}
          </Card>
        )}

        {/* 时间筛选 */}
        <div className="flex gap-2 mb-3 overflow-x-auto pb-2">
          {(['all', 'today', 'week', 'month'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setTimeFilter(filter)}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap transition-all ${
                timeFilter === filter
                  ? 'bg-orange-500 text-white shadow-md'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {filter === 'all' ? '全部' : filter === 'today' ? '今天' : filter === 'week' ? '本周' : '本月'}
            </button>
          ))}
        </div>

        {/* 惩罚记录列表 */}
        {punishmentRecords.length > 0 ? (
          <div className="space-y-2">
            {punishmentRecords.map((record) => (
              <Card 
                key={record.id} 
                className="p-3 bg-orange-50 border-l-4 border-orange-500 cursor-pointer hover:bg-orange-100 transition-colors"
                onClick={() => setSelectedRecord(record)}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{getLevelEmoji(record.level)}</span>
                      <span className="font-bold text-gray-800">{getLevelName(record.level)}</span>
                      <span className="text-xs text-gray-500">
                        {new Date(record.createdAt).toLocaleDateString('zh-CN', { 
                          month: 'short', 
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600 mb-1">
                      任务：<span className="font-semibold">{record.taskTitle}</span>
                    </div>
                    <div className="text-sm text-gray-700 bg-white p-2 rounded line-clamp-2">
                      <strong>原因：</strong>{record.reason}
                    </div>
                  </div>
                  <div className="text-right ml-3">
                    <div className="text-2xl font-black text-red-600">
                      -{record.deductedCoins}
                    </div>
                    <div className="text-xs text-gray-500">金币</div>
                  </div>
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  {record.parentName} 执行
                </div>
              </Card>
            ))}
            
            {/* 展开/收起按钮 */}
            {punishmentRecords.length >= 3 && (
              <button
                onClick={() => setExpandedRecords(!expandedRecords)}
                className="w-full py-2 text-sm font-semibold text-orange-600 bg-orange-50 rounded-xl hover:bg-orange-100 transition-colors flex items-center justify-center gap-1"
              >
                {expandedRecords ? (
                  <>
                    <ChevronUp size={16} />
                    收起记录
                  </>
                ) : (
                  <>
                    <ChevronDown size={16} />
                    查看全部记录
                  </>
                )}
              </button>
            )}
          </div>
        ) : (
          <Card className="p-8 text-center bg-gradient-to-br from-green-50 to-blue-50 border-2 border-dashed border-green-300">
            <div className="text-5xl mb-3">🎉</div>
            <div className="text-lg font-bold text-gray-800 mb-2">太棒了！</div>
            <div className="text-sm text-gray-600">
              {timeFilter === 'all' 
                ? '你还没有任何惩罚记录，继续保持！'
                : `在${timeFilter === 'today' ? '今天' : timeFilter === 'week' ? '本周' : '本月'}没有惩罚记录，继续努力！`
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

      {/* 详情弹窗 */}
      <Modal
        isOpen={selectedRecord !== null}
        onClose={() => setSelectedRecord(null)}
        title="惩罚详情"
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
                <div className="text-xs font-semibold text-gray-600 mb-1">惩罚原因</div>
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
      
      {/* 成就墙 - 显示所有成就（含未解锁） */}
      <div>
        <div className="flex items-center justify-between mb-3">
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
                                {ach.icon || '🏆'}
                            </div>
                            
                            {/* 标题 */}
                            <div className={`text-[10px] font-bold text-center leading-tight ${isUnlocked ? 'text-gray-800' : 'text-gray-400'}`}>
                                {ach.title}
                            </div>
                            
                            {/* 锁定图标或进度 */}
                            {!isUnlocked && (
                                <div className="absolute top-1 right-1">
                                    <Lock size={12} className="text-gray-300" />
                                </div>
                            )}
                            
                            {/* 悬停提示 */}
                            <div className="absolute inset-0 bg-black/80 text-white opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-2 rounded-2xl">
                                <div className="text-lg mb-1">{ach.icon || '🏆'}</div>
                                <div className="text-[10px] font-bold text-center">{ach.title}</div>
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
