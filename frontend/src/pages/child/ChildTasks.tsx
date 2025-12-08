import React, { useEffect, useState, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { PullToRefresh } from '../../components/PullToRefresh';
import { Check, Clock, Play, X, Pause, Calendar } from 'lucide-react';
import api from '../../services/api';

interface Task {
  id: string;
  title: string;
  coins: number;
  xp: number;
  duration: number;
  status: 'todo' | 'pending' | 'completed' | 'approved';
}

// 存储键名
const ACTIVE_TASK_KEY = 'stellar_active_task';
const TASK_START_TIME_KEY = 'stellar_task_start_time';
const TASK_PAUSED_DURATION_KEY = 'stellar_task_paused_duration';

// 格式化时间显示
const formatTime = (totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
};

// Timer Modal Component - 使用时间戳方案，支持后台运行
const TaskTimerModal = ({ task, onClose, onComplete }: { task: Task, onClose: () => void, onComplete: (duration: number) => void }) => {
    const [displaySeconds, setDisplaySeconds] = useState(0);
    const [isActive, setIsActive] = useState(true);
    const [startTime, setStartTime] = useState<number>(Date.now());
    const [pausedDuration, setPausedDuration] = useState(0); // 累计暂停时长
    const [pauseStartTime, setPauseStartTime] = useState<number | null>(null);
    const intervalRef = useRef<any>(null);

    // 初始化：从 localStorage 恢复状态
    useEffect(() => {
        const savedStartTime = localStorage.getItem(TASK_START_TIME_KEY);
        const savedPausedDuration = localStorage.getItem(TASK_PAUSED_DURATION_KEY);
        
        if (savedStartTime) {
            setStartTime(parseInt(savedStartTime));
        } else {
            const now = Date.now();
            setStartTime(now);
            localStorage.setItem(TASK_START_TIME_KEY, now.toString());
        }
        
        if (savedPausedDuration) {
            setPausedDuration(parseInt(savedPausedDuration));
        }
        
        localStorage.setItem(ACTIVE_TASK_KEY, JSON.stringify(task));
    }, [task]);

    // 计算实际耗时（使用时间戳，即使切出画面也准确）
    const getElapsedSeconds = () => {
        const now = Date.now();
        let elapsed = Math.floor((now - startTime) / 1000) - Math.floor(pausedDuration / 1000);
        
        // 如果当前处于暂停状态，减去当前暂停的时间
        if (pauseStartTime) {
            elapsed -= Math.floor((now - pauseStartTime) / 1000);
        }
        
        return Math.max(0, elapsed);
    };

    // 更新显示（每秒更新，但实际时间基于时间戳计算）
    useEffect(() => {
        intervalRef.current = setInterval(() => {
            setDisplaySeconds(getElapsedSeconds());
        }, 1000);
        
        // 立即更新一次
        setDisplaySeconds(getElapsedSeconds());
        
        return () => clearInterval(intervalRef.current);
    }, [startTime, pausedDuration, pauseStartTime]);

    // 暂停/继续
    const togglePause = () => {
        if (isActive) {
            // 暂停
            setPauseStartTime(Date.now());
            setIsActive(false);
        } else {
            // 继续
            if (pauseStartTime) {
                const newPausedDuration = pausedDuration + (Date.now() - pauseStartTime);
                setPausedDuration(newPausedDuration);
                localStorage.setItem(TASK_PAUSED_DURATION_KEY, newPausedDuration.toString());
            }
            setPauseStartTime(null);
            setIsActive(true);
        }
    };

    const handleSubmit = () => {
        const totalSeconds = getElapsedSeconds();
        const durationMinutes = Math.max(1, Math.ceil(totalSeconds / 60));
        
        // 清理存储
        localStorage.removeItem(ACTIVE_TASK_KEY);
        localStorage.removeItem(TASK_START_TIME_KEY);
        localStorage.removeItem(TASK_PAUSED_DURATION_KEY);
        
        onComplete(durationMinutes);
    };

    const handleClose = () => {
        // 清理存储
        localStorage.removeItem(ACTIVE_TASK_KEY);
        localStorage.removeItem(TASK_START_TIME_KEY);
        localStorage.removeItem(TASK_PAUSED_DURATION_KEY);
        onClose();
    };

    return (
        <div className="absolute inset-0 bg-black/90 z-50 flex flex-col items-center justify-center text-white p-6 animate-in fade-in duration-200">
            <div className="text-center mb-12">
                <h2 className="text-2xl font-bold mb-2">{task.title}</h2>
                <p className="text-gray-400">建议时长: {task.duration}分钟</p>
            </div>

            {/* Timer Display */}
            <div className={`text-8xl font-mono font-bold mb-4 tracking-wider tabular-nums transition-all ${!isActive ? 'text-yellow-400 animate-pulse' : ''}`}>
                {formatTime(displaySeconds)}
            </div>
            
            {!isActive && (
                <div className="text-yellow-400 text-sm mb-8 flex items-center gap-2">
                    <Pause size={16} /> 已暂停
                </div>
            )}
            
            {isActive && (
                <div className="text-green-400 text-sm mb-8 flex items-center gap-2">
                    <Play size={16} /> 计时中...
                </div>
            )}

            {/* Controls */}
            <div className="flex flex-col gap-4 w-full max-w-xs">
                <button 
                    onClick={handleSubmit}
                    className="bg-green-500 hover:bg-green-600 text-white py-4 rounded-2xl font-bold text-xl shadow-lg shadow-green-500/30 active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                    <Check size={24} /> 完成提交
                </button>

                <div className="flex gap-4">
                    <button 
                        onClick={togglePause}
                        className={`flex-1 py-4 rounded-xl font-bold flex items-center justify-center gap-2 ${isActive ? 'bg-gray-800 hover:bg-gray-700' : 'bg-yellow-500 hover:bg-yellow-600 text-black'}`}
                    >
                        {isActive ? <><Pause/> 暂停</> : <><Play/> 继续</>}
                    </button>
                    
                    <button 
                        onClick={handleClose}
                        className="flex-1 bg-red-500/20 hover:bg-red-500/40 text-red-200 py-4 rounded-xl font-bold flex items-center justify-center gap-2"
                    >
                        <X /> 放弃
                    </button>
                </div>
            </div>
            
            {/* 提示 */}
            <div className="mt-8 text-xs text-gray-500 text-center max-w-xs">
                💡 计时器使用时间戳计算，即使切出应用或刷新页面，时间也会继续累计
            </div>
        </div>
    );
};

export default function ChildTasks() {
  const context = useOutletContext<any>();
  const refreshParent = context?.refresh; // 刷新父组件数据（顶栏金币等）
  
  const [tasks, setTasks] = useState<Task[]>([]);
  const [weeklyStats, setWeeklyStats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [activeTaskTimer, setActiveTaskTimer] = useState<number>(0); // 用于列表显示的计时

  // 恢复进行中的任务
  useEffect(() => {
    const savedTask = localStorage.getItem(ACTIVE_TASK_KEY);
    if (savedTask) {
      try {
        const task = JSON.parse(savedTask);
        setActiveTask(task);
      } catch (e) {
        localStorage.removeItem(ACTIVE_TASK_KEY);
      }
    }
  }, []);

  // 列表中显示进行中任务的计时
  useEffect(() => {
    if (!activeTask) {
      setActiveTaskTimer(0);
      return;
    }
    
    const updateTimer = () => {
      const savedStartTime = localStorage.getItem(TASK_START_TIME_KEY);
      const savedPausedDuration = localStorage.getItem(TASK_PAUSED_DURATION_KEY);
      
      if (savedStartTime) {
        const startTime = parseInt(savedStartTime);
        const pausedDuration = savedPausedDuration ? parseInt(savedPausedDuration) : 0;
        const elapsed = Math.floor((Date.now() - startTime) / 1000) - Math.floor(pausedDuration / 1000);
        setActiveTaskTimer(Math.max(0, elapsed));
      }
    };
    
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [activeTask]);

  useEffect(() => {
    fetchTasks();
  }, []);

  const fetchTasks = async () => {
    try {
      const res = await api.get('/child/dashboard');
      const adaptedTasks = res.data.tasks.map((t: any) => ({
        ...t,
        coins: t.coinReward,
        xp: t.xpReward,
        duration: t.durationMinutes
      }));
      setTasks(adaptedTasks);
      setWeeklyStats(res.data.weeklyStats || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleTaskComplete = async (duration: number) => {
      if (!activeTask) return;
      try {
          await api.post(`/child/tasks/${activeTask.id}/complete`, { duration });
          setActiveTask(null);
          fetchTasks(); // Refresh
      } catch (e: any) {
          alert(e.response?.data?.message || '提交失败');
      }
  };

  const completedCount = tasks.filter(t => t.status === 'approved' || t.status === 'completed' || t.status === 'pending').length;
  
  const getFormattedDate = (dateStr: string) => {
      const date = new Date(dateStr);
      const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const m = date.getMonth() + 1;
      const d = date.getDate();
      return { day: days[date.getDay()], date: `${m}.${d}` };
  };
  
  const maxCoins = Math.max(...weeklyStats.map(s => s.coins), 10); 
  const totalWeeklyCoins = weeklyStats.reduce((acc, cur) => acc + cur.coins, 0);

  // 下拉刷新处理
  const handleRefresh = async () => {
    await fetchTasks();
    if (refreshParent) await refreshParent(); // 同时刷新顶栏数据
  };

  return (
    <PullToRefresh onRefresh={handleRefresh} className="h-full">
      <div className="p-4 space-y-6">
        {/* Timer Modal */}
        {activeTask && (
            <TaskTimerModal 
              task={activeTask} 
              onClose={() => setActiveTask(null)} 
              onComplete={handleTaskComplete}
            />
        )}

      {/* Stats Chart */}
      <div className="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl p-5 shadow-lg text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 p-2 opacity-10">
            <Calendar size={100} />
        </div>
        
        <div className="flex justify-between items-start mb-6 relative z-10">
          <div>
              <h2 className="font-bold text-xl tracking-tight">本周收获</h2>
              <p className="text-xs text-indigo-200 mt-1">坚持就是胜利！</p>
          </div>
          <div className="text-right">
              <div className="text-3xl font-black text-yellow-300 drop-shadow-sm">
                  {totalWeeklyCoins} <span className="text-sm font-medium text-white/80">金币</span>
              </div>
              <div className="text-[10px] text-indigo-200 bg-indigo-800/30 px-2 py-0.5 rounded-full inline-block mt-1">
                  本周累计
              </div>
          </div>
        </div>
        
        <div className="flex justify-between items-end h-32 gap-2 pt-2 relative z-10">
            {weeklyStats.map((day, index) => {
                const isToday = index === 6; 
                const heightPercent = (day.coins / maxCoins) * 100;
                const { day: weekDay, date: dateNum } = getFormattedDate(day.date);
                
                return (
                    <div key={day.date} className="flex flex-col items-center gap-2 flex-1 group cursor-default">
                        {/* Bar */}
                        <div className="relative w-full flex justify-center items-end h-full">
                             {/* Tooltip */}
                            <div className="absolute -top-8 bg-white text-indigo-900 font-bold text-[10px] px-2 py-1 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-all whitespace-nowrap z-20 scale-90 group-hover:scale-100 pointer-events-none transform translate-y-2 group-hover:translate-y-0">
                                {day.coins}
                            </div>
                            
                            <div 
                                style={{ height: `${Math.max(heightPercent, 8)}%` }} 
                                className={`w-2.5 sm:w-3 rounded-t-md transition-all duration-500 ${isToday ? 'bg-gradient-to-t from-yellow-400 to-yellow-200 shadow-[0_0_15px_rgba(250,204,21,0.5)]' : 'bg-white/20 group-hover:bg-white/40'}`}
                            ></div>
                        </div>
                        
                        {/* Date Label */}
                        <div className="flex flex-col items-center gap-0.5">
                            <div className={`text-[10px] font-medium ${isToday ? 'text-yellow-300' : 'text-indigo-200'}`}>
                                {weekDay}
                            </div>
                            <div className={`text-[9px] scale-90 ${isToday ? 'text-white font-bold bg-indigo-500/50 px-1 rounded' : 'text-indigo-300'}`}>
                                {dateNum}
                            </div>
                        </div>
                    </div>
                )
            })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="font-bold text-lg text-gray-800 flex items-center gap-2">
              ✅ 今日待办 
            </h2>
            <div className="text-xs font-bold text-gray-500 bg-white px-3 py-1.5 rounded-full border shadow-sm">
                已完成 <span className="text-blue-600 text-sm mx-1">{completedCount}</span> / {tasks.length}
            </div>
        </div>
        
        <div className="space-y-3 pb-20">
          {loading && <div className="text-center text-gray-400 py-4">加载中...</div>}
          {!loading && tasks.length === 0 && (
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-6 border border-blue-100 text-center">
              <div className="text-5xl mb-4">📋</div>
              <h3 className="font-bold text-lg text-gray-800 mb-2">还没有任务</h3>
              <p className="text-gray-600 text-sm mb-4">
                请等待家长为你添加任务哦！
              </p>
              <div className="bg-white/60 rounded-xl p-4 text-sm text-left space-y-2">
                <div className="flex items-center gap-2 text-gray-600">
                  <span className="text-xl">✅</span>
                  <span>完成任务可以获得金币</span>
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <span className="text-xl">🛒</span>
                  <span>用金币在商店兑换心愿</span>
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <span className="text-xl">🎰</span>
                  <span>参与抽奖赢取惊喜奖品</span>
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <span className="text-xl">🏆</span>
                  <span>解锁成就成为小达人</span>
                </div>
              </div>
            </div>
          )}
          
          {tasks.map(task => (
            <Card key={task.id} className={`relative overflow-hidden transition-all border-0 shadow-sm ${task.status === 'approved' ? 'opacity-60 bg-gray-50' : 'bg-white'}`}>
              {/* Status Stripe */}
              <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${
                  task.status === 'approved' ? 'bg-green-400' : 
                  task.status === 'pending' ? 'bg-orange-400' : 
                  task.status === 'completed' ? 'bg-green-400' : 'bg-blue-500'
              }`}></div>

              <div className="flex justify-between items-center pl-3 py-1">
                <div className="flex-1">
                  <h3 className={`font-bold text-base text-gray-800 ${task.status === 'approved' && 'line-through text-gray-400'}`}>{task.title}</h3>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 mt-2">
                    <span className="flex items-center gap-1 bg-gray-100 px-2 py-1 rounded-md text-gray-600"><Clock size={12}/> {task.duration}分</span>
                    <span className="font-bold text-yellow-700 bg-yellow-100 px-2 py-1 rounded-md">+{task.coins} 💰</span>
                    <span className="font-bold text-purple-700 bg-purple-100 px-2 py-1 rounded-md">+{task.xp} ⭐</span>
                  </div>
                </div>
                
                <div className="ml-4">
                    {/* 进行中状态 - 显示计时 */}
                    {activeTask?.id === task.id && (
                      <button 
                        onClick={() => setActiveTask(task)} 
                        className="flex flex-col items-center gap-1 text-blue-600 animate-pulse"
                      >
                          <div className="bg-blue-100 p-2 rounded-full">
                            <Clock size={18} className="animate-spin" style={{ animationDuration: '3s' }}/>
                          </div>
                          <span className="text-[10px] font-bold font-mono">{formatTime(activeTaskTimer)}</span>
                          <span className="text-[8px] text-blue-400">点击查看</span>
                      </button>
                    )}
                    {/* 待开始状态 */}
                    {task.status === 'todo' && activeTask?.id !== task.id && (
                      <button onClick={() => setActiveTask(task)} className="bg-blue-600 active:bg-blue-700 text-white rounded-full p-3 shadow-blue-200 shadow-lg transition-transform hover:scale-105 flex items-center justify-center">
                          <Play size={20} fill="currentColor" className="ml-0.5" />
                      </button>
                    )}
                    {task.status === 'pending' && (
                      <div className="flex flex-col items-center gap-1 text-orange-500">
                          <div className="bg-orange-100 p-1.5 rounded-full"><Clock size={18}/></div>
                          <span className="text-[10px] font-bold">审核中</span>
                      </div>
                    )}
                    {(task.status === 'approved' || task.status === 'completed') && (
                      <div className="flex flex-col items-center gap-1 text-green-500">
                          <div className="bg-green-100 p-1.5 rounded-full"><Check size={18}/></div>
                          <span className="text-[10px] font-bold">已完成</span>
                      </div>
                    )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
      </div>
    </PullToRefresh>
  );
}
