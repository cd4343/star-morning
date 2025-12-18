import React, { useEffect, useState } from 'react';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Trophy, Lock } from 'lucide-react';
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

export default function ChildMe() {
  const context = useOutletContext<any>();
  const childData = context?.childData || { coins: 0, xp: 0, level: 1, privilegePoints: 0 };
  const refresh = context?.refresh || (() => {});
  
  const [allAchievements, setAllAchievements] = useState<Achievement[]>([]);
  const [punishmentRecords, setPunishmentRecords] = useState<PunishmentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const achRes = await api.get('/child/all-achievements');
        setAllAchievements(achRes.data || []);
        
        // 获取惩罚记录（最近5条）
        try {
          const punishRes = await api.get('/child/punishment-records', { params: { limit: 5 } });
          setPunishmentRecords(punishRes.data || []);
        } catch (punishErr) {
          console.error('获取惩罚记录失败:', punishErr);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

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

  return (
    <div className="p-4 space-y-6">
      {/* 惩罚记录提醒 */}
      {punishmentRecords.length > 0 && (
        <div>
          <h2 className="font-bold text-lg mb-3 flex items-center gap-2">
            <Lock className="text-orange-500" size={20}/> 
            惩罚记录
          </h2>
          <div className="space-y-2">
            {punishmentRecords.map((record) => (
              <Card key={record.id} className="p-3 bg-orange-50 border-l-4 border-orange-500">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{getLevelEmoji(record.level)}</span>
                      <span className="font-bold text-gray-800">{getLevelName(record.level)}</span>
                      <span className="text-xs text-gray-500">
                        {new Date(record.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600 mb-1">
                      任务：<span className="font-semibold">{record.taskTitle}</span>
                    </div>
                    <div className="text-sm text-gray-700 bg-white p-2 rounded">
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
          </div>
        </div>
      )}
      
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
