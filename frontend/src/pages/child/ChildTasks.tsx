import React, { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useOutletContext } from 'react-router-dom';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { PullToRefresh } from '../../components/PullToRefresh';
import { Check, Clock, Play, X, Pause, Calendar, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../components/Toast';

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

// Timer Modal Component - 使用时间戳方案，支持后台运行，可最小化
const TaskTimerModal = ({ task, onClose, onComplete }: { task: Task, onClose: () => void, onComplete: (duration: number) => void }) => {
    const [displaySeconds, setDisplaySeconds] = useState(0);
    const [isActive, setIsActive] = useState(true);
    const [startTime, setStartTime] = useState<number>(Date.now());
    const [pausedDuration, setPausedDuration] = useState(0); // 累计暂停时长
    const [pauseStartTime, setPauseStartTime] = useState<number | null>(null);
    const [isMinimized, setIsMinimized] = useState(false); // 是否最小化
    const intervalRef = useRef<any>(null);
    
    // 拖拽相关状态
    // 默认位置：屏幕右下角（会在 useEffect 中根据实际屏幕尺寸调整）
    const [position, setPosition] = useState({ x: 16, y: 100 });
    const [isDragging, setIsDragging] = useState(false);
    const dragOffsetRef = useRef({ x: 0, y: 0 });
    const isDraggingRef = useRef(false);
    const timerRef = useRef<HTMLDivElement>(null);
    
    // 获取容器边界（考虑手机框架）
    const getContainerBounds = () => {
        // 查找手机框架容器（在电脑端）
        // 查找包含特定特征的容器：宽度在300-500px之间，有圆角，且居中显示
        let phoneFrame: Element | null = null;
        
        // 方法1: 查找所有div，检查是否符合手机框架特征
        const divs = document.querySelectorAll('div');
        for (const div of divs) {
            if (div === document.body) continue;
            const rect = div.getBoundingClientRect();
            const style = window.getComputedStyle(div);
            const borderRadius = style.borderRadius;
            const hasBorder = parseFloat(style.borderWidth) > 0;
            
            // 检查是否是手机框架：宽度在300-500px，有圆角或边框，高度接近视口高度
            if (rect.width >= 300 && rect.width <= 500 && 
                rect.height >= 600 &&
                (borderRadius !== '0px' || hasBorder)) {
                phoneFrame = div;
                break;
            }
        }
        
        if (phoneFrame && phoneFrame !== document.body) {
            const rect = phoneFrame.getBoundingClientRect();
            return {
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height
            };
        }
        
        // 如果没有找到框架，使用视口边界
        return {
            left: 0,
            top: 0,
            right: window.innerWidth,
            bottom: window.innerHeight,
            width: window.innerWidth,
            height: window.innerHeight
        };
    };
    
    // 从 localStorage 恢复位置，或设置初始位置
    useEffect(() => {
        const bounds = getContainerBounds();
        const timerWidth = 200; // 计时器最小宽度（已调整）
        const timerHeight = 60; // 计时器高度（已调整）
        const minY = bounds.top + 90; // 导航栏高度约70-80px，留10px余量
        
        const savedPos = localStorage.getItem('stellar_timer_position');
        if (savedPos) {
            try {
                const pos = JSON.parse(savedPos);
                // 确保位置在容器内
                const safeX = Math.max(bounds.left, Math.min(bounds.right - timerWidth, pos.x));
                const safeY = Math.max(minY, Math.min(bounds.bottom - timerHeight, pos.y));
                setPosition({ x: safeX, y: safeY });
            } catch (e) {
                // 忽略解析错误，使用默认位置
            }
        } else {
            // 没有保存的位置，设置为屏幕右侧中间
            const initialX = Math.max(bounds.left + 8, bounds.right - timerWidth - 16);
            const initialY = minY + 16;
            setPosition({ x: initialX, y: initialY });
        }
    }, []);
    
    // 窗口大小改变时，确保位置仍然在可见区域内
    useEffect(() => {
        const handleResize = () => {
            setPosition(prev => {
                const bounds = getContainerBounds();
                const timerWidth = 200; // 已调整
                const timerHeight = 60; // 已调整
                const minY = bounds.top + 90;
                
                const safeX = Math.max(bounds.left, Math.min(bounds.right - timerWidth, prev.x));
                const safeY = Math.max(minY, Math.min(bounds.bottom - timerHeight, prev.y));
                return { x: safeX, y: safeY };
            });
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);
    
    // 保存位置到 localStorage
    const savePosition = (pos: { x: number, y: number }) => {
        localStorage.setItem('stellar_timer_position', JSON.stringify(pos));
    };
    
    // 拖拽开始
    const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
        if (!timerRef.current) return;
        setIsDragging(true);
        isDraggingRef.current = true;
        const rect = timerRef.current.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        dragOffsetRef.current = {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
    };
    
    // 拖拽中
    const handleDrag = (e: MouseEvent | TouchEvent) => {
        if (!isDraggingRef.current || !timerRef.current) return;
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        
        const bounds = getContainerBounds();
        const rect = timerRef.current.getBoundingClientRect();
        const minY = bounds.top + 90; // 导航栏高度约70-80px，留10px余量避免遮挡
        
        // 计算新位置（相对于视口）
        const newX = Math.max(bounds.left, Math.min(bounds.right - rect.width, clientX - dragOffsetRef.current.x));
        const newY = Math.max(minY, Math.min(bounds.bottom - rect.height, clientY - dragOffsetRef.current.y));
        
        setPosition({ x: newX, y: newY });
    };
    
    // 拖拽结束
    const handleDragEnd = () => {
        if (isDraggingRef.current) {
            setIsDragging(false);
            isDraggingRef.current = false;
            setPosition(prev => {
                savePosition(prev);
                return prev;
            });
        }
    };
    
    // 监听拖拽事件
    useEffect(() => {
        if (isDragging) {
            const handleMouseMove = (e: MouseEvent) => handleDrag(e);
            const handleTouchMove = (e: TouchEvent) => {
                e.preventDefault(); // 防止页面滚动
                handleDrag(e);
            };
            const handleMouseUp = () => handleDragEnd();
            const handleTouchEnd = () => handleDragEnd();
            
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('touchmove', handleTouchMove, { passive: false });
            document.addEventListener('mouseup', handleMouseUp);
            document.addEventListener('touchend', handleTouchEnd);
            
            return () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('touchmove', handleTouchMove);
                document.removeEventListener('mouseup', handleMouseUp);
                document.removeEventListener('touchend', handleTouchEnd);
            };
        }
    }, [isDragging]);

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

    // 阻止触摸事件穿透到父组件（防止PullToRefresh干扰）
    const handleTouchEvent = (e: React.TouchEvent) => {
        e.stopPropagation();
    };

    // 最小化模式：显示为可拖拽的浮动窗口
    if (isMinimized) {
        return (
            <div 
                ref={timerRef}
                className="fixed z-50 bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-2xl rounded-xl cursor-move select-none"
                style={{
                    left: `${position.x}px`,
                    top: `${position.y}px`,
                    transform: isDragging ? 'scale(1.05)' : 'scale(1)',
                    transition: isDragging ? 'none' : 'transform 0.2s',
                    touchAction: 'none'
                }}
                onMouseDown={handleDragStart}
                onTouchStart={handleDragStart}
                onClick={(e) => {
                    // 如果点击的不是按钮，则展开
                    if ((e.target as HTMLElement).closest('button') === null) {
                        setIsMinimized(false);
                    }
                }}
            >
                <div className="flex items-center justify-between px-3 py-2.5 gap-2 min-w-[200px] max-w-[calc(100vw-32px)]">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="bg-white/20 p-2 rounded-lg flex-shrink-0">
                            <Clock size={20} className={isActive ? 'animate-spin' : ''} style={{ animationDuration: '2s' }}/>
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-bold truncate">{task.title}</div>
                            <div className={`text-lg font-mono font-bold ${!isActive ? 'text-yellow-300' : ''}`}>
                                {formatTime(displaySeconds)}
                            </div>
                        </div>
                        {!isActive && (
                            <span className="text-xs bg-yellow-500/30 px-2 py-1 rounded-full flex-shrink-0">已暂停</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                togglePause();
                            }}
                            className="p-2 hover:bg-white/20 rounded-lg transition-colors active:bg-white/30"
                            title={isActive ? '暂停' : '继续'}
                        >
                            {isActive ? <Pause size={18} /> : <Play size={18} />}
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsMinimized(false);
                            }}
                            className="p-2 hover:bg-white/20 rounded-lg transition-colors active:bg-white/30"
                            title="展开"
                        >
                            <ChevronUp size={18} />
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // 完整模式：显示为浮动窗口
    return (
        <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
            style={{ touchAction: 'none' }}
        >
            {/* 背景遮罩 - 半透明，可点击关闭 */}
            <div 
                className="absolute inset-0 bg-black/30 backdrop-blur-sm"
                onClick={() => setIsMinimized(true)}
            />
            
            {/* 计时窗口 */}
            <div 
                className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 pointer-events-auto animate-in fade-in slide-in-from-bottom-4 duration-300"
                onTouchStart={handleTouchEvent}
                onTouchMove={handleTouchEvent}
                onTouchEnd={handleTouchEvent}
            >
                {/* 最小化按钮 */}
                <button
                    onClick={() => setIsMinimized(true)}
                    className="absolute top-3 right-3 p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500"
                >
                    <ChevronDown size={18} />
                </button>

                <div className="text-center mb-6">
                    <h2 className="text-xl font-bold text-gray-800 mb-1">{task.title}</h2>
                    <p className="text-sm text-gray-500">建议时长: {task.duration}分钟</p>
                </div>

                {/* Timer Display */}
                <div className={`text-6xl font-mono font-bold mb-4 tracking-wider tabular-nums text-center transition-all ${!isActive ? 'text-yellow-500 animate-pulse' : 'text-blue-600'}`}>
                    {formatTime(displaySeconds)}
                </div>
                
                {!isActive && (
                    <div className="text-yellow-500 text-sm mb-4 flex items-center justify-center gap-2">
                        <Pause size={16} /> 已暂停
                    </div>
                )}
                
                {isActive && (
                    <div className="text-green-500 text-sm mb-4 flex items-center justify-center gap-2">
                        <Play size={16} /> 计时中...
                    </div>
                )}

                {/* Controls */}
                <div className="flex flex-col gap-3">
                    <button 
                        onClick={handleSubmit}
                        className="bg-green-500 hover:bg-green-600 text-white py-3 rounded-xl font-bold text-lg shadow-lg shadow-green-500/30 active:scale-95 transition-all flex items-center justify-center gap-2"
                    >
                        <Check size={20} /> 完成提交
                    </button>

                    <div className="flex gap-3">
                        <button 
                            onClick={togglePause}
                            className={`flex-1 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${
                                isActive 
                                    ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' 
                                    : 'bg-yellow-500 hover:bg-yellow-600 text-white'
                            }`}
                        >
                            {isActive ? <><Pause size={18}/> 暂停</> : <><Play size={18}/> 继续</>}
                        </button>
                        
                        <button 
                            onClick={handleClose}
                            className="flex-1 bg-red-100 hover:bg-red-200 text-red-600 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all"
                        >
                            <X size={18} /> 放弃
                        </button>
                    </div>
                </div>
                
                {/* 提示 */}
                <div className="mt-4 text-xs text-gray-400 text-center">
                    💡 点击背景可最小化，计时器后台继续运行
                </div>
            </div>
        </div>
    );
};

export default function ChildTasks() {
  const context = useOutletContext<any>();
  const refreshParent = context?.refresh; // 刷新父组件数据（顶栏金币等）
  const toast = useToast();
  
  const [tasks, setTasks] = useState<any[]>([]);
  const [weeklyStats, setWeeklyStats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [activeTaskTimer, setActiveTaskTimer] = useState<number>(0); // 用于列表显示的计时
  
  // 日期选择（用于历史回看）
  const [selectedDate, setSelectedDate] = useState<string>(''); // 空字符串表示今天
  const [isToday, setIsToday] = useState(true);
  
  // 分类筛选
  const [filterCategory, setFilterCategory] = useState('全部');
  const TASK_CATEGORIES = ['全部', '劳动', '学习', '兴趣', '运动'];
  const filteredTasks = filterCategory === '全部' 
    ? tasks 
    : tasks.filter(t => t.category === filterCategory);
  
  // 任务详情弹窗状态
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [taskDetail, setTaskDetail] = useState<any>(null);
  const [clickPosition, setClickPosition] = useState<{ x: number, y: number } | null>(null);

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

  const fetchTasks = useCallback(async (date?: string) => {
    try {
      const targetDate = date ?? selectedDate;
      const url = targetDate ? `/child/dashboard?date=${targetDate}` : '/child/dashboard';
      const res = await api.get(url);
      const adaptedTasks = res.data.tasks.map((t: any) => ({
        ...t,
        coins: t.coinReward,
        xp: t.xpReward,
        duration: t.durationMinutes
      }));
      setTasks(adaptedTasks);
      setWeeklyStats(res.data.weeklyStats || []);
      setIsToday(res.data.isToday !== false);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);
  
  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);
  
  // 选择日期（点击柱状图）
  const handleSelectDate = (dateStr: string) => {
    const today = new Date().toISOString().split('T')[0];
    if (dateStr === today) {
      setSelectedDate('');
    } else {
      setSelectedDate(dateStr);
    }
  };

  const handleTaskComplete = async (duration: number) => {
      if (!activeTask) return;
      try {
          await api.post(`/child/tasks/${activeTask.id}/complete`, { duration });
          setActiveTask(null);
          fetchTasks(); // Refresh
          toast.success('任务已提交，等待家长审核');
      } catch (e: any) {
          toast.error(e.response?.data?.message || '提交失败');
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
  
  // 计算柱状图高度基于收入（earned），净值可能为负
  const maxEarned = Math.max(...weeklyStats.map(s => s.earned || s.coins || 0), 10); 
  // 本周总净值（收入 - 消耗）
  const totalWeeklyNet = weeklyStats.reduce((acc, cur) => acc + (cur.coins ?? 0), 0);
  // 本周总收入
  const totalWeeklyEarned = weeklyStats.reduce((acc, cur) => acc + (cur.earned ?? cur.coins ?? 0), 0);
  // 本周总消耗
  const totalWeeklySpent = weeklyStats.reduce((acc, cur) => acc + (cur.spent ?? 0), 0);

  // 下拉刷新处理
  const handleRefresh = async () => {
    await fetchTasks();
    if (refreshParent) await refreshParent(); // 同时刷新顶栏数据
  };

  return (
    <>
      {/* Timer Modal - 放在 PullToRefresh 外部，防止滑动干扰 */}
      {activeTask && (
          <TaskTimerModal 
            task={activeTask} 
            onClose={() => setActiveTask(null)} 
            onComplete={handleTaskComplete}
          />
      )}
      
      <PullToRefresh onRefresh={handleRefresh} className="h-full">
        <div className="p-4 space-y-6">

        {/* Stats Chart */}
      <div className="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl p-5 shadow-lg text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 p-2 opacity-10">
            <Calendar size={100} />
        </div>
        
        <div className="flex justify-between items-start mb-6 relative z-10">
          <div>
              <h2 className="font-bold text-xl tracking-tight">本周收获</h2>
              <p className="text-xs text-indigo-200 mt-1">坚持就是胜利！</p>
              {/* 收支明细 */}
              {totalWeeklySpent > 0 && (
                <div className="text-[10px] text-indigo-200 mt-2 space-y-0.5">
                  <div>📈 收入: +{totalWeeklyEarned}</div>
                  <div>📉 消耗: -{totalWeeklySpent}</div>
                </div>
              )}
          </div>
          <div className="text-right">
              <div className={`text-3xl font-black drop-shadow-sm ${totalWeeklyNet >= 0 ? 'text-yellow-300' : 'text-red-300'}`}>
                  {totalWeeklyNet >= 0 ? '+' : ''}{totalWeeklyNet} <span className="text-sm font-medium text-white/80">金币</span>
              </div>
              <div className="text-[10px] text-indigo-200 bg-indigo-800/30 px-2 py-0.5 rounded-full inline-block mt-1">
                  本周净值
              </div>
          </div>
        </div>
        
        <div className="flex justify-between items-end h-32 gap-2 pt-2 relative z-10">
            {weeklyStats.map((day, index) => {
                const isTodayBar = index === 6;
                const isSelected = selectedDate === day.date || (selectedDate === '' && isTodayBar);
                const dayEarned = day.earned ?? day.coins ?? 0;
                const daySpent = day.spent ?? 0;
                const heightPercent = (dayEarned / maxEarned) * 100;
                const { day: weekDay, date: dateNum } = getFormattedDate(day.date);
                
                return (
                    <div 
                        key={day.date} 
                        className="flex flex-col items-center gap-2 flex-1 group cursor-pointer"
                        onClick={() => handleSelectDate(day.date)}
                    >
                        {/* Bar */}
                        <div className="relative w-full flex justify-center items-end h-full">
                             {/* Tooltip - 显示收支详情 */}
                            <div className="absolute -top-8 bg-white text-indigo-900 font-bold text-[10px] px-2 py-1 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-all whitespace-nowrap z-20 scale-90 group-hover:scale-100 pointer-events-none transform translate-y-2 group-hover:translate-y-0">
                                {daySpent > 0 ? `+${dayEarned} -${daySpent}` : `+${dayEarned}`}
                            </div>
                            
                            <div 
                                style={{ height: `${Math.max(heightPercent, 8)}%` }} 
                                className={`w-2.5 sm:w-3 rounded-t-md transition-all duration-500 ${
                                    isSelected 
                                        ? 'bg-gradient-to-t from-yellow-400 to-yellow-200 shadow-[0_0_15px_rgba(250,204,21,0.5)]' 
                                        : 'bg-white/20 group-hover:bg-white/40'
                                }`}
                            ></div>
                        </div>
                        
                        {/* Date Label */}
                        <div className="flex flex-col items-center gap-0.5">
                            <div className={`text-[10px] font-medium ${isSelected ? 'text-yellow-300' : 'text-indigo-200'}`}>
                                {weekDay}
                            </div>
                            <div className={`text-[9px] scale-90 ${isSelected ? 'text-white font-bold bg-indigo-500/50 px-1 rounded' : 'text-indigo-300'}`}>
                                {dateNum}
                            </div>
                        </div>
                    </div>
                )
            })}
        </div>
        {/* 返回今天按钮 */}
        {!isToday && (
          <button 
            onClick={() => setSelectedDate('')}
            className="mt-3 w-full py-2 bg-white/20 rounded-lg text-xs font-bold text-white hover:bg-white/30 transition-all"
          >
            ← 返回今天
          </button>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="font-bold text-lg text-gray-800 flex items-center gap-2">
              {isToday ? '✅ 今日待办' : `📋 ${selectedDate.slice(5).replace('-', '月')}日`}
            </h2>
            <div className="text-xs font-bold text-gray-500 bg-white px-3 py-1.5 rounded-full border shadow-sm">
                {isToday ? '已完成' : '完成'} <span className="text-blue-600 text-sm mx-1">{completedCount}</span> / {tasks.length}
            </div>
        </div>
        
        {/* 状态颜色图例 */}
        <div className="flex gap-3 mb-2 px-1 text-[10px] text-gray-500">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400"></span>已完成</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400"></span>审核中</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500"></span>待开始</span>
          {!isToday && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400"></span>未完成</span>}
        </div>
        
        {/* 分类筛选标签 */}
        {tasks.length > 0 && (
          <div className="flex gap-2 mb-3 overflow-x-auto pb-1 px-1">
            {TASK_CATEGORIES.map(cat => {
              const count = cat === '全部' 
                ? tasks.length 
                : tasks.filter(t => t.category === cat).length;
              if (cat !== '全部' && count === 0) return null; // 隐藏没有任务的分类
              return (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(cat)}
                  className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                    filterCategory === cat
                      ? 'bg-blue-500 text-white shadow-sm'
                      : 'bg-white text-gray-600 border hover:bg-gray-50'
                  }`}
                >
                  {cat} ({count})
                </button>
              );
            })}
          </div>
        )}
        
        <div className="space-y-3 pb-20">
          {loading && <div className="text-center text-gray-400 py-4">加载中...</div>}
          {!loading && tasks.length === 0 && (
            isToday ? (
              // 今天没有任务 - 提示家长添加
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
            ) : (
              // 历史日期没有记录
              <div className="bg-gradient-to-br from-gray-50 to-slate-50 rounded-2xl p-6 border border-gray-200 text-center">
                <div className="text-5xl mb-4">📭</div>
                <h3 className="font-bold text-lg text-gray-600 mb-2">当日无任务记录</h3>
                <p className="text-gray-500 text-sm">
                  这一天没有完成或提交过任务
                </p>
              </div>
            )
          )}
          
          {filteredTasks.map(task => (
            <Card 
              key={task.id} 
              className={`relative overflow-hidden transition-all border-0 shadow-sm cursor-pointer hover:shadow-md ${task.status === 'approved' ? 'bg-green-50/50' : task.status === 'todo' && !isToday ? 'bg-red-50/30' : 'bg-white'}`}
              onClick={async (e: React.MouseEvent<HTMLDivElement>) => {
                if (task.status === 'approved' && task.entryId) {
                  try {
                    // 记录点击位置（相对于视口）
                    const rect = e.currentTarget.getBoundingClientRect();
                    setClickPosition({
                      x: rect.left + rect.width / 2, // 任务卡片中心X
                      y: rect.top + rect.height / 2  // 任务卡片中心Y
                    });
                    
                    const res = await api.get(`/task-entries/${task.entryId}`);
                    setTaskDetail(res.data);
                    setShowDetailModal(true);
                  } catch (err) {
                    console.error('获取任务详情失败:', err);
                  }
                }
              }}
            >
              {/* Status Stripe */}
              <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${
                  task.status === 'approved' ? 'bg-green-400' : 
                  task.status === 'pending' ? 'bg-orange-400' : 
                  task.status === 'completed' ? 'bg-green-400' : 
                  !isToday ? 'bg-red-400' : 'bg-blue-500'
              }`}></div>

              <div className="flex justify-between items-center pl-3 py-1">
                <div className="flex-1">
                  <h3 className={`font-bold text-base text-gray-800 ${task.status === 'approved' && 'line-through text-gray-400'}`}>{task.title}</h3>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 mt-2">
                    {/* 已审核通过：显示实际结果 */}
                    {task.status === 'approved' && task.earnedCoins !== undefined ? (
                      <>
                        <span className="flex items-center gap-1 bg-green-100 px-2 py-1 rounded-md text-green-600">
                          <Clock size={12}/> {task.actualDurationMinutes || task.duration}分
                        </span>
                        <span className="font-bold text-green-700 bg-green-100 px-2 py-1 rounded-md">+{task.earnedCoins} 💰</span>
                        <span className="font-bold text-purple-700 bg-purple-100 px-2 py-1 rounded-md">+{task.earnedXp || task.xp} ⭐</span>
                        {task.punishmentDeduction > 0 && (
                          <span className="font-bold text-red-600 bg-red-100 px-2 py-1 rounded-md">-{task.punishmentDeduction} 💰</span>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="flex items-center gap-1 bg-gray-100 px-2 py-1 rounded-md text-gray-600"><Clock size={12}/> {task.duration}分</span>
                        <span className="font-bold text-yellow-700 bg-yellow-100 px-2 py-1 rounded-md">+{task.coins} 💰</span>
                        <span className="font-bold text-purple-700 bg-purple-100 px-2 py-1 rounded-md">+{task.xp} ⭐</span>
                      </>
                    )}
                  </div>
                </div>
                
                <div className="ml-4">
                    {/* 历史模式 - 不可操作 */}
                    {!isToday ? (
                      task.status === 'approved' ? (
                        <div className="flex flex-col items-center gap-1 text-green-500">
                          <div className="bg-green-100 p-1.5 rounded-full"><Check size={18}/></div>
                          <span className="text-[10px] font-bold">已完成</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1 text-red-400">
                          <div className="bg-red-100 p-1.5 rounded-full"><X size={18}/></div>
                          <span className="text-[10px] font-bold">未完成</span>
                        </div>
                      )
                    ) : (
                      <>
                        {/* 今日模式 - 可操作 */}
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
                      </>
                    )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
      
      {/* 任务详情弹窗 - 使用 Portal 渲染到 body，确保完全覆盖 */}
      {showDetailModal && taskDetail && createPortal(
        <div 
          className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100vh',
            margin: 0,
            padding: 0
          }}
          onClick={() => {
            setShowDetailModal(false);
            setClickPosition(null);
          }}
        >
          <div 
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col p-0"
            style={{ 
              position: 'fixed',
              maxHeight: '90vh',
              maxWidth: 'calc(100vw - 32px)',
              // 智能定位：如果有点击位置，弹窗出现在点击位置附近；否则居中
              left: '50%',
              top: clickPosition 
                ? (() => {
                    const viewportHeight = window.innerHeight;
                    const clickY = clickPosition.y;
                    const estimatedModalHeight = 400;
                    const padding = 20;
                    
                    // 计算最佳位置：尽量让弹窗出现在点击位置附近，但不超出屏幕
                    let topPosition = clickY - estimatedModalHeight / 2;
                    
                    // 如果弹窗会超出顶部，调整到顶部
                    if (topPosition < padding) {
                      topPosition = padding;
                    }
                    // 如果弹窗会超出底部，调整到底部
                    else if (topPosition + estimatedModalHeight > viewportHeight - padding) {
                      topPosition = viewportHeight - estimatedModalHeight - padding;
                    }
                    
                    return `${Math.max(padding, Math.min(topPosition, viewportHeight - estimatedModalHeight - padding))}px`;
                  })()
                : '50%',
              transform: clickPosition ? 'translateX(-50%)' : 'translate(-50%, -50%)',
              zIndex: 10000
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-shrink-0 flex justify-between items-center p-4 border-b">
              <h3 className="font-bold text-lg">任务详情</h3>
              <button onClick={() => setShowDetailModal(false)} className="p-1 hover:bg-gray-100 rounded-full">
                <X size={20} className="text-gray-500"/>
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
              <div className="bg-gray-50 p-4 rounded-xl">
                <h4 className="font-bold text-lg">{taskDetail.title}</h4>
                <div className="text-xs text-gray-400 mt-2">
                  提交时间：{new Date(taskDetail.submittedAt).toLocaleString('zh-CN')}
                </div>
                {taskDetail.reviewedAt && (
                  <div className="text-xs text-gray-400 mt-1">
                    审核时间：{new Date(taskDetail.reviewedAt).toLocaleString('zh-CN')}
                  </div>
                )}
              </div>
              
              <div className="bg-green-50 p-4 rounded-xl border border-green-200">
                <div className="text-sm font-bold text-gray-700 mb-2">奖励信息</div>
                <div className="flex gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-black text-yellow-600">{taskDetail.earnedCoins || taskDetail.coinReward}</div>
                    <div className="text-xs text-gray-500">金币</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-black text-blue-600">{taskDetail.earnedXp || taskDetail.xpReward}</div>
                    <div className="text-xs text-gray-500">经验</div>
                  </div>
                </div>
                {taskDetail.actualDurationMinutes && (
                  <div className="text-xs text-gray-600 mt-2">
                    实际用时：{taskDetail.actualDurationMinutes} 分钟
                  </div>
                )}
              </div>
              
              {taskDetail.punishment && (
                <div className="bg-red-50 p-4 rounded-xl border border-red-200">
                  <div className="text-sm font-bold text-red-700 mb-2">🚨 惩罚信息</div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-600">惩罚等级：</span>
                      <span className="text-sm font-bold text-red-600">
                        {taskDetail.punishment.level === 'mild' ? '🟡 轻度警告' : 
                         taskDetail.punishment.level === 'moderate' ? '🟠 中度惩罚' : 
                         '🔴 严重惩罚'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-600">扣除金币：</span>
                      <span className="text-lg font-black text-red-600">-{taskDetail.punishment.deductedCoins} 💰</span>
                    </div>
                    <div>
                      <span className="text-xs text-gray-600">惩罚原因：</span>
                      <div className="text-sm text-gray-700 mt-1 bg-white p-2 rounded border">
                        {taskDetail.punishment.reason}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 mt-2">
                      {taskDetail.punishment.parentName} · {new Date(taskDetail.punishment.createdAt).toLocaleString('zh-CN')}
                    </div>
                  </div>
                </div>
              )}
              
              {taskDetail.proof && (
                <div className="bg-blue-50 p-4 rounded-xl border border-blue-200">
                  <div className="text-sm font-bold text-gray-700 mb-2">提交证明</div>
                  <div className="text-sm text-gray-600">{taskDetail.proof}</div>
                </div>
              )}
            </div>
            
            <div className="flex-shrink-0 p-4 border-t">
              <button 
                onClick={() => setShowDetailModal(false)}
                className="w-full py-3 bg-gray-100 font-bold text-gray-600 rounded-xl hover:bg-gray-200"
              >
                关闭
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
        </div>
      </PullToRefresh>
    </>
  );
}
