import React, { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { Check, Clock, Play, X, Pause, Calendar, ChevronDown, GripHorizontal, Info } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../components/Toast';
import { playSuccessSound, playMagicSound, playErrorSound } from '../../utils/sounds';
import { Confetti } from '../../components/Confetti';
import { useConfirmDialog } from '../../components/ConfirmDialog';
import {
  TASK_CATEGORY_VALUES,
  getTaskCategoryInfo,
  taskMatchesCategory,
} from '../../utils/taskCategories';
import './ChildTasks.css';

interface Task {
  id: string;
  title: string;
  coins: number;
  xp: number;
  duration: number;
  status: 'todo' | 'running' | 'pending' | 'completed' | 'approved' | 'rejected';
  isParallel?: boolean;
  taskType?: string;
  durationMinutes?: number;
  coinReward?: number;
  xpReward?: number;
  icon?: string;
  sessionId?: string;
  sessionStartedAt?: string;
}

// 存储键名
const ACTIVE_TASKS_KEY = 'stellar_active_tasks_v2'; // 并行任务列表
const getTaskDataKey = (id: string) => `stellar_task_data_${id}`;
const TIMER_DRAWER_POSITION_KEY = 'stellar_timer_drawer_position_v2';

type Point = { x: number; y: number };
type Bounds = {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
    screenLeft: number;
    screenTop: number;
};

const rarityLabel: Record<string, { zh: string; en: string; className: string }> = {
  common: { zh: '普通', en: 'Common', className: 'text-emerald-700 bg-emerald-50 border-emerald-100' },
  uncommon: { zh: '优秀', en: 'Uncommon', className: 'text-blue-700 bg-blue-50 border-blue-100' },
  rare: { zh: '稀有', en: 'Rare', className: 'text-purple-700 bg-purple-50 border-purple-100' },
  epic: { zh: '史诗', en: 'Epic', className: 'text-pink-700 bg-pink-50 border-pink-100' },
  legendary: { zh: '传说', en: 'Legendary', className: 'text-amber-700 bg-amber-50 border-amber-100' },
};

const getRarityMeta = (rarity?: string) => rarityLabel[String(rarity || 'common').toLowerCase()] || {
  zh: '普通',
  en: String(rarity || 'Common'),
  className: 'text-slate-600 bg-white border-slate-100',
};

const getGameTicketPreviewText = (preview?: any) => {
  if (!preview || Number(preview.requestedMinutes || 0) <= 0) return '';
  const label = preview.label || '游戏票';
  const granted = Number(preview.grantedMinutes || 0);
  const capped = Number(preview.cappedMinutes || 0);
  if (granted > 0 && capped > 0) {
    return `审核通过后预计获得${label} +${granted} 分钟；今日上限已满的 ${capped} 分钟不会再发放。`;
  }
  if (granted > 0) return `审核通过后预计获得${label} +${granted} 分钟。`;
  if (capped > 0) return `节省时间已记录，但今日游戏时间已到上限，审核通过后不会再增加游戏票。`;
  return '';
};

const withGameTicketPreview = (message: string, preview?: any) => {
  const ticketText = getGameTicketPreviewText(preview);
  return ticketText ? `${message}\n${ticketText}` : message;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const getElementCenter = (element: HTMLElement): Point => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};

const getChildOverlayRoot = () => {
    if (typeof document === 'undefined') return null;
    return document.querySelector('[data-child-overlay-root="true"]') as HTMLElement | null;
};

const getChildViewportBounds = (): Bounds => {
    if (typeof window === 'undefined') {
        return { left: 0, top: 0, right: 390, bottom: 780, width: 390, height: 780, screenLeft: 0, screenTop: 0 };
    }

    const viewport = document.querySelector('[data-child-main-viewport="true"]') as HTMLElement | null;
    const frame = document.querySelector('[data-child-app-frame="true"]') as HTMLElement | null;
    const target = viewport || frame;
    if (target) {
        const rootRect = (getChildOverlayRoot() || frame || target).getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const left = targetRect.left - rootRect.left;
        const top = targetRect.top - rootRect.top;
        return {
            left,
            top,
            right: left + targetRect.width,
            bottom: top + targetRect.height,
            width: targetRect.width,
            height: targetRect.height,
            screenLeft: rootRect.left,
            screenTop: rootRect.top,
        };
    }

    return {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
        width: window.innerWidth,
        height: window.innerHeight,
        screenLeft: 0,
        screenTop: 0,
    };
};

const getOverlayStyle = (bounds = getChildViewportBounds()): React.CSSProperties => ({
    position: 'absolute',
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height,
});

const getAnchoredModalStyle = (
    anchor: Point | null,
    bounds = getChildViewportBounds(),
    preferredWidth = 384,
    preferredHeight = 560
): React.CSSProperties => {
    const estimatedWidth = Math.min(preferredWidth, bounds.width - 32);
    const estimatedHeight = Math.min(preferredHeight, bounds.height - 32);
    const center = anchor
        ? { x: anchor.x - bounds.screenLeft - bounds.left, y: anchor.y - bounds.screenTop - bounds.top }
        : { x: bounds.width / 2, y: bounds.height / 2 };
    const left = clamp(center.x, estimatedWidth / 2 + 12, bounds.width - estimatedWidth / 2 - 12);
    const top = clamp(center.y, estimatedHeight / 2 + 12, bounds.height - estimatedHeight / 2 - 12);

    return {
        position: 'absolute',
        left,
        top,
        transform: 'translate(-50%, -50%)',
        maxWidth: Math.max(240, bounds.width - 32),
        maxHeight: Math.max(260, bounds.height - 32),
    };
};

const getDefaultDrawerPosition = (_taskCount: number): Point => {
    const bounds = getChildViewportBounds();

    const width = Math.min(420, bounds.width - 24);
    return {
        x: Math.max(bounds.left + 12, bounds.left + (bounds.width - width) / 2),
        y: bounds.top + 12,
    };
};

const clampDrawerPosition = (position: Point, width: number, height: number): Point => {
    const bounds = getChildViewportBounds();
    return {
        x: clamp(position.x, bounds.left + 8, Math.max(bounds.left + 8, bounds.right - width - 8)),
        y: clamp(position.y, bounds.top + 8, Math.max(bounds.top + 8, bounds.bottom - height - 8)),
    };
};

const getDrawerWidth = () => Math.min(420, Math.max(280, getChildViewportBounds().width - 16));

// 格式化时间显示 (支持倒计时负数与小时制)
const formatTime = (totalSeconds: number) => {
    const absSeconds = Math.abs(totalSeconds);
    const h = Math.floor(absSeconds / 3600);
    const m = Math.floor((absSeconds % 3600) / 60).toString().padStart(2, '0');
    const s = (absSeconds % 60).toString().padStart(2, '0');

    let timeStr = `${m}:${s}`;
    if (h > 0) timeStr = `${h}:${timeStr}`;
    return totalSeconds < 0 ? `-${timeStr}` : timeStr;
};

// 抽取核心计时器逻辑为 Hook
const useTaskTimer = (task: Task, onComplete?: (duration: number, isOverdue: boolean) => void) => {
    const [startTime, setStartTime] = useState<number>(Date.now());
    const [pausedDuration, setPausedDuration] = useState(0);
    const [pauseStartTime, setPauseStartTime] = useState<number | null>(null);
    const [isActive, setIsActive] = useState(true);
    const [displaySeconds, setDisplaySeconds] = useState(0);

    const dataKey = getTaskDataKey(task.id);

    useEffect(() => {
        const saved = localStorage.getItem(dataKey);
        if (saved) {
            const data = JSON.parse(saved);
            setStartTime(data.startTime);
            setPausedDuration(data.pausedDuration);
            setPauseStartTime(data.pauseStartTime);
            setIsActive(!data.pauseStartTime);
        } else {
            const now = Date.now();
            setStartTime(now);
            const initialData = { startTime: now, pausedDuration: 0, pauseStartTime: null };
            localStorage.setItem(dataKey, JSON.stringify(initialData));
        }
    }, [task.id]);

    useEffect(() => {
        const data = { startTime, pausedDuration, pauseStartTime };
        localStorage.setItem(dataKey, JSON.stringify(data));
    }, [startTime, pausedDuration, pauseStartTime, task.id]);

    const getElapsedSeconds = () => {
        const now = Date.now();
        let elapsed = Math.floor((now - startTime) / 1000) - Math.floor(pausedDuration / 1000);
        if (pauseStartTime) {
            elapsed -= Math.floor((now - pauseStartTime) / 1000);
        }
        return Math.max(0, elapsed);
    };

    useEffect(() => {
        const update = () => setDisplaySeconds((task.duration * 60) - getElapsedSeconds());
        const interval = setInterval(update, 1000);
        update();

        // 页面从后台切回前台时立即校准
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                update();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [startTime, pausedDuration, pauseStartTime, task.duration]);

    const togglePause = () => {
        if (isActive) {
            setPauseStartTime(Date.now());
            setIsActive(false);
        } else {
            if (pauseStartTime) {
                setPausedDuration(prev => prev + (Date.now() - pauseStartTime));
            }
            setPauseStartTime(null);
            setIsActive(true);
        }
    };

    const submit = () => {
        const elapsed = getElapsedSeconds();
        const durationMinutes = Math.max(1, Math.ceil(elapsed / 60));
        const isOverdue = elapsed > (task.duration * 60);
        localStorage.removeItem(dataKey);
        if (onComplete) onComplete(durationMinutes, isOverdue);
    };

    const abandon = () => {
        localStorage.removeItem(dataKey);
    };

    return { displaySeconds, isActive, togglePause, submit, abandon, isOverdue: displaySeconds < 0 };
};

// 任务抽屉项
const TaskTimerItem = ({ task, onComplete, onExpand }: { task: Task, onComplete: (d: number, o: boolean) => void, onExpand: (anchor: Point) => void, onAbandon: () => void }) => {
    const { displaySeconds, isActive, togglePause, submit, isOverdue } = useTaskTimer(task, (d, o) => {
        onComplete(d, o);
    });

    const progress = Math.max(0, Math.min(100, (displaySeconds / (task.duration * 60)) * 100));

    return (
        <div className={`timer-strip ${isOverdue ? 'overdue' : ''}`} onClick={(e) => onExpand({ x: e.clientX, y: e.clientY })}>
            <div className="flex-shrink-0 bg-blue-100 p-2 rounded-lg text-blue-600 w-10 h-10 flex items-center justify-center text-xl">
                {task.icon || <Clock size={20} className={isActive ? 'animate-spin' : ''} style={{ animationDuration: '3s' }} />}
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-sm font-bold truncate flex items-center gap-1">
                    {task.title}
                    {isOverdue && <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded">超时</span>}
                </div>
                <div className="progress-container">
                    <div className="progress-bar" style={{ width: `${isOverdue ? 100 : progress}%` }} />
                </div>
            </div>
            <div className="countdown-text">
                {formatTime(displaySeconds)}
            </div>
            <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                <button onClick={togglePause} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                    {isActive ? <Pause size={18} /> : <Play size={18} />}
                </button>
                <button onClick={submit} className="p-2 hover:bg-green-50 text-green-600 rounded-lg transition-colors">
                    <Check size={18} />
                </button>
            </div>
        </div>
    );
};

// 全屏计时器模态框
const TaskTimerModal = ({ task, anchor, onClose, onComplete, onAbandon }: { task: Task, anchor: Point | null, onClose: () => void, onComplete: (duration: number, isOverdue: boolean) => void, onAbandon: () => void }) => {
    const { displaySeconds, isActive, togglePause, submit, abandon, isOverdue } = useTaskTimer(task, onComplete);
    const wakeLockRef = useRef<any>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);

    const requestWakeLock = async () => {
        if ('wakeLock' in navigator) {
            try { wakeLockRef.current = await (navigator as any).wakeLock.request('screen'); } catch (err) {}
        }
        if (videoRef.current) { try { await videoRef.current.play(); } catch (err) {} }
    };

    const releaseWakeLock = async () => {
        if (wakeLockRef.current !== null) { try { await wakeLockRef.current.release(); wakeLockRef.current = null; } catch (err) {} }
        if (videoRef.current) { try { videoRef.current.pause(); } catch (err) {} }
    };

    useEffect(() => {
        if (isActive) requestWakeLock();
        else releaseWakeLock();
        return () => { releaseWakeLock(); };
    }, [isActive]);

    const bounds = getChildViewportBounds();
    const overlayRoot = getChildOverlayRoot() || document.body;

    return createPortal(
        <div className="z-[10000] p-4 pointer-events-auto" style={getOverlayStyle(bounds)}>
            <div className="absolute inset-0 bg-black/40 backdrop-blur-md" onClick={onClose} />
            <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm p-8 pointer-events-auto animate-in zoom-in-95 duration-300 overflow-y-auto" style={getAnchoredModalStyle(anchor, bounds)}>
                <button onClick={onClose} className="absolute top-4 right-4 p-2 hover:bg-gray-100 rounded-full text-gray-400">
                    <ChevronDown size={24} />
                </button>

                <div className="text-center mb-8">
                    <div className="text-5xl mb-4">{task.icon || '⏱️'}</div>
                    <h2 className="text-2xl font-black text-gray-800 mb-2">{task.title}</h2>
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-gray-100 rounded-full text-xs font-bold text-gray-500">
                        <Calendar size={14} /> 目标时长: {task.duration}分钟
                    </div>
                </div>

                <div className={`text-7xl font-mono font-black mb-8 tracking-tighter tabular-nums text-center transition-all ${isOverdue ? 'text-red-500' : !isActive ? 'text-yellow-500' : 'text-blue-600'}`}>
                    {formatTime(displaySeconds)}
                </div>

                <div className="flex flex-col gap-4">
                    <button onClick={submit} className="bg-green-500 hover:bg-green-600 text-white py-4 rounded-2xl font-black text-xl shadow-xl shadow-green-500/30 active:scale-95 transition-all flex items-center justify-center gap-2">
                        <Check size={24} /> 完成并提交
                    </button>

                    <div className="flex gap-4">
                        <button onClick={togglePause} className={`flex-1 py-4 rounded-2xl font-black flex items-center justify-center gap-2 transition-all ${isActive ? 'bg-gray-100 text-gray-700' : 'bg-yellow-500 text-white'}`}>
                            {isActive ? <><Pause size={20}/> 暂停</> : <><Play size={20}/> 继续</>}
                        </button>
                        <button onClick={() => { abandon(); onAbandon(); }} className="flex-1 bg-red-50 text-red-600 py-4 rounded-2xl font-black flex items-center justify-center gap-2">
                            <X size={20} /> 放弃
                        </button>
                    </div>
                </div>

                {/* 本地静音文件，替代不可达的 GitHub CDN */}
                <video ref={videoRef} style={{ position: 'absolute', width: '1px', height: '1px', opacity: 0 }} loop muted playsInline src="/silence.mp4" />
                <div className="mt-8 text-[10px] text-gray-300 text-center font-bold uppercase tracking-widest">
                    Screen Stay Awake Enabled
                </div>
            </div>
        </div>,
        overlayRoot
    );
};

export default function ChildTasks() {
  const toast = useToast();

  const [tasks, setTasks] = useState<any[]>([]);
  const [weeklyStats, setWeeklyStats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTasks, setActiveTasks] = useState<Task[]>([]);
  const [focusedTask, setFocusedTask] = useState<Task | null>(null);
  const [timerAnchor, setTimerAnchor] = useState<Point | null>(null);
  const [drawerPosition, setDrawerPosition] = useState<Point | null>(null);
  const [isDraggingDrawer, setIsDraggingDrawer] = useState(false);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const dragOffsetRef = useRef<Point | null>(null);
  const [chestReward, setChestReward] = useState<any>(null);
  const [showChestModal, setShowChestModal] = useState(false);
  const [showChestGuide, setShowChestGuide] = useState(false);
  const [chestGuide, setChestGuide] = useState<{ settings?: any; prizes: any[]; note?: string }>({ prizes: [] });
  const [showConfetti, setShowConfetti] = useState(false);

  const [selectedDate, setSelectedDate] = useState<string>('');
  const [isToday, setIsToday] = useState(true);

  const [unreadPunishments, setUnreadPunishments] = useState<any[]>([]);
  const [currentAlert, setCurrentAlert] = useState<any>(null);

  const { Dialog: ConfirmDialog } = useConfirmDialog();

  const [filterCategory, setFilterCategory] = useState('全部');
  const TASK_CATEGORIES = ['全部', '合作', ...TASK_CATEGORY_VALUES];

  const coopTasks = tasks.filter(t => t.taskType === 'family');
  const regularTasks = tasks.filter(t => t.taskType !== 'family');
  const filteredTasks = filterCategory === '全部'
    ? regularTasks
    : filterCategory === '合作'
      ? coopTasks
      : regularTasks.filter(t => taskMatchesCategory(t.category, filterCategory));
  const selectedCategoryInfo = filterCategory === '合作'
    ? { icon: '🏠', label: '合作', childHint: '全家一起完成的大任务。' }
    : getTaskCategoryInfo(filterCategory === '全部' ? undefined : filterCategory);

  const [showDetailModal, setShowDetailModal] = useState(false);
  const [taskDetail, setTaskDetail] = useState<any>(null);

  const focusTask = (task: Task, anchor?: Point | null) => {
    setTimerAnchor(anchor || null);
    setFocusedTask(task);
  };

  const closeFocusedTask = () => {
    setFocusedTask(null);
    setTimerAnchor(null);
  };

  const handleStartTask = async (task: Task, anchor?: Point | null) => {
    if (activeTasks.find(t => t.id === task.id)) {
        focusTask(task, anchor);
        return;
    }
    const nonParallelTask = activeTasks.find(t => !t.isParallel);
    if (!task.isParallel && activeTasks.length > 0) {
        toast.error(`请先完成当前正在进行的任务再开启新任务。`);
        return;
    }
    if (nonParallelTask) {
        toast.error(`当前任务"${nonParallelTask.title}"不支持并行，请先完成它。`);
        return;
    }

    try {
        const res = await api.post(`/child/tasks/${task.id}/start`);
        const session = res.data?.session || {};
        const activeTask = {
            ...task,
            status: 'running' as const,
            sessionId: session.id,
            sessionStartedAt: session.startedAt,
        };
        const newActiveTasks = [...activeTasks.filter(t => t.id !== task.id), activeTask];
        setActiveTasks(newActiveTasks);
        localStorage.setItem(ACTIVE_TASKS_KEY, JSON.stringify(newActiveTasks));
        focusTask(activeTask, anchor);
    } catch (e: any) {
        toast.error(e.response?.data?.message || '开始任务失败');
        fetchTasks();
        return;
    }
  };

  const handleTaskAbandon = async (taskId: string) => {
    try {
        await api.post(`/child/tasks/${taskId}/abandon`);
    } catch (e: any) {
        if (e.response?.status === 409) {
            toast.info(e.response?.data?.message || '任务已自动提交');
            fetchTasks();
        } else {
            console.error(e);
        }
    }
    const newActiveTasks = activeTasks.filter(t => t.id !== taskId);
    setActiveTasks(newActiveTasks);
    localStorage.setItem(ACTIVE_TASKS_KEY, JSON.stringify(newActiveTasks));
    localStorage.removeItem(getTaskDataKey(taskId));
    closeFocusedTask();
  };

  const handleTaskComplete = async (taskId: string, duration: number, isOverdue: boolean) => {
      const task = activeTasks.find(t => t.id === taskId);
      if (!task) return;
      const isFamilyMission = (task as any).taskType === 'family';
      try {
          const res = await api.post(`/child/tasks/${task.id}/complete`, { duration, isOverdue });
          const newActiveTasks = activeTasks.filter(t => t.id !== taskId);
          setActiveTasks(newActiveTasks);
          localStorage.setItem(ACTIVE_TASKS_KEY, JSON.stringify(newActiveTasks));
          closeFocusedTask();
          fetchTasks();
          if (res.data?.chest) {
              playMagicSound(); setChestReward(res.data.chest); setShowChestModal(true);
              if (isFamilyMission) {
                  setShowConfetti(true);
                  toast.success(withGameTicketPreview('全家任务已提交，并获得惊喜宝箱！', res.data?.gameTicketPreview));
                  setTimeout(() => setShowConfetti(false), 3000);
              } else {
                  toast.success(withGameTicketPreview('任务已提交，并打开了惊喜宝箱！', res.data?.gameTicketPreview));
              }
          } else if (isFamilyMission) {
              playMagicSound(); setShowConfetti(true);
              toast.success(withGameTicketPreview('全家任务已提交！等待家长审核发放高额奖励！', res.data?.gameTicketPreview));
              setTimeout(() => setShowConfetti(false), 3000);
          } else {
              playSuccessSound(); toast.success(withGameTicketPreview('任务已提交，等待家长审核', res.data?.gameTicketPreview));
          }
      } catch (e: any) {
          const message = e.response?.data?.message || '提交失败';
          if (e.response?.status === 409) {
              const newActiveTasks = activeTasks.filter(t => t.id !== taskId);
              setActiveTasks(newActiveTasks);
              localStorage.setItem(ACTIVE_TASKS_KEY, JSON.stringify(newActiveTasks));
              localStorage.removeItem(getTaskDataKey(taskId));
              closeFocusedTask();
              fetchTasks();
          }
          playErrorSound(); toast.error(message);
      }
  };

  const renderTaskCard = (task: any) => {
    const activeTask = activeTasks.find(t => t.id === task.id);
    const categoryInfo = getTaskCategoryInfo(task.category);
    return (
      <Card
        key={task.id}
        className={`relative overflow-hidden transition-all border-0 shadow-sm cursor-pointer hover:shadow-md ${task.status === 'approved' ? 'bg-green-50/50' : task.status === 'todo' && !isToday ? 'bg-red-50/30' : 'bg-white'}`}
        onClick={async (_e: React.MouseEvent<HTMLDivElement>) => {
          if (task.status === 'approved' && task.entryId) {
            try {
              const res = await api.get(`/task-entries/${task.entryId}`);
              setTaskDetail(res.data); setShowDetailModal(true);
            } catch (err) { console.error(err); }
          } else {
            setTaskDetail({ ...task, isPreview: true });
            setShowDetailModal(true);
          }
        }}
      >
        <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${
            task.status === 'approved' ? 'bg-green-400' :
            task.status === 'pending' ? 'bg-orange-400' :
            task.status === 'completed' ? 'bg-green-400' :
            !isToday ? 'bg-red-400' : 'bg-blue-500'
        }`}></div>
        <div className="flex justify-between items-center pl-3 py-1">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className={`font-bold text-base text-gray-800 ${task.status === 'approved' && 'line-through text-gray-400'}`}>{task.title}</h3>
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-black whitespace-nowrap">
                {categoryInfo.icon} {categoryInfo.label}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 mt-2">
              {task.status === 'approved' && task.earnedCoins !== undefined ? (
                <>
                  <span className="flex items-center gap-1 bg-green-100 px-2 py-1 rounded-md text-green-600"><Clock size={12}/> {task.actualDurationMinutes || task.duration}分</span>
                  <span className="font-bold text-green-700 bg-green-100 px-2 py-1 rounded-md">+{task.earnedCoins} 💰</span>
                  <span className="font-bold text-purple-700 bg-purple-100 px-2 py-1 rounded-md">+{task.earnedXp || task.xp} ⭐</span>
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
              {!isToday ? (
                task.status === 'approved' ? (
                  <div className="flex flex-col items-center gap-1 text-green-500"><div className="bg-green-100 p-1.5 rounded-full"><Check size={18}/></div><span className="text-[10px] font-bold">已完成</span></div>
                ) : (
                  <div className="flex flex-col items-center gap-1 text-red-400"><div className="bg-red-100 p-1.5 rounded-full"><X size={18}/></div><span className="text-[10px] font-bold">未完成</span></div>
                )
              ) : (
                <>
                  {activeTask && (
                    <button onClick={(e) => { e.stopPropagation(); focusTask(activeTask, getElementCenter(e.currentTarget)); }} className="flex flex-col items-center gap-1 text-blue-600 animate-pulse">
                        <div className="bg-blue-100 p-2 rounded-full"><Clock size={18} className="animate-spin" style={{ animationDuration: '3s'}}/></div>
                        <span className="text-[8px] text-blue-400">进行中</span>
                    </button>
                  )}
                  {task.status === 'todo' && !activeTask && (
                    <button onClick={(e) => { e.stopPropagation(); handleStartTask(task, getElementCenter(e.currentTarget)); }} className="bg-blue-600 active:bg-blue-700 text-white rounded-full p-3 shadow-blue-200 shadow-lg transition-transform hover:scale-105 flex items-center justify-center">
                        <Play size={20} fill="currentColor" className="ml-0.5" />
                    </button>
                  )}
                  {task.status === 'pending' && (
                    <div className="flex flex-col items-center gap-1 text-orange-500"><div className="bg-orange-100 p-1.5 rounded-full"><Clock size={18}/></div><span className="text-[10px] font-bold">审核中</span></div>
                  )}
                  {(task.status === 'approved' || task.status === 'completed') && (
                    <div className="flex flex-col items-center gap-1 text-green-500"><div className="bg-green-100 p-1.5 rounded-full"><Check size={18}/></div><span className="text-[10px] font-bold">已完成</span></div>
                  )}
                </>
              )}
          </div>
        </div>
      </Card>
    );
  };

  useEffect(() => {
    const savedTasks = localStorage.getItem(ACTIVE_TASKS_KEY);
    if (savedTasks) { try { setActiveTasks(JSON.parse(savedTasks)); } catch (e) { localStorage.removeItem(ACTIVE_TASKS_KEY); } }
  }, []);

  useEffect(() => {
    const savedPosition = localStorage.getItem(TIMER_DRAWER_POSITION_KEY);
    if (savedPosition) {
      try {
        setDrawerPosition(JSON.parse(savedPosition));
      } catch (e) {
        localStorage.removeItem(TIMER_DRAWER_POSITION_KEY);
      }
    }
  }, []);

  useEffect(() => {
    if (activeTasks.length > 0 && !drawerPosition) {
      const defaultPosition = getDefaultDrawerPosition(activeTasks.length);
      setDrawerPosition(defaultPosition);
    }
  }, [activeTasks.length, drawerPosition]);

  useEffect(() => {
    const handleResize = () => {
      if (!drawerPosition || !drawerRef.current) return;
      const rect = drawerRef.current.getBoundingClientRect();
      const next = clampDrawerPosition(drawerPosition, rect.width, rect.height);
      setDrawerPosition(next);
      localStorage.setItem(TIMER_DRAWER_POSITION_KEY, JSON.stringify(next));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [drawerPosition]);

  const handleDrawerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawerRef.current) return;
    const rect = drawerRef.current.getBoundingClientRect();
    dragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setIsDraggingDrawer(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleDrawerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingDrawer || !dragOffsetRef.current || !drawerRef.current) return;
    const rect = drawerRef.current.getBoundingClientRect();
    const bounds = getChildViewportBounds();
    const next = clampDrawerPosition(
      { x: e.clientX - bounds.screenLeft - dragOffsetRef.current.x, y: e.clientY - bounds.screenTop - dragOffsetRef.current.y },
      rect.width,
      rect.height
    );
    setDrawerPosition(next);
  };

  const handleDrawerPointerUp = () => {
    if (drawerPosition) {
      localStorage.setItem(TIMER_DRAWER_POSITION_KEY, JSON.stringify(drawerPosition));
    }
    dragOffsetRef.current = null;
    setIsDraggingDrawer(false);
  };

  const fetchTasks = useCallback(async (date?: string) => {
    try {
      const targetDate = date ?? selectedDate;
      const url = targetDate ? `/child/dashboard?date=${targetDate}` : '/child/dashboard';
      const res = await api.get(url);
      const adaptedTasks = res.data.tasks.map((t: any) => ({ ...t, coins: t.coinReward, xp: t.xpReward, duration: t.durationMinutes }));
      setTasks(adaptedTasks); setWeeklyStats(res.data.weeklyStats || []); setIsToday(res.data.isToday !== false);
      const serverActiveTasks = res.data.isToday !== false
        ? adaptedTasks.filter((t: any) => t.status === 'running' && t.sessionId)
        : [];
      const serverActiveIds = new Set(serverActiveTasks.map((t: any) => t.id));
      setActiveTasks(prev => {
        const next = serverActiveTasks;
        localStorage.setItem(ACTIVE_TASKS_KEY, JSON.stringify(next));
        prev.filter(task => !serverActiveIds.has(task.id)).forEach(task => localStorage.removeItem(getTaskDataKey(task.id)));
        return next;
      });
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [selectedDate]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const checkUnreadPunishments = useCallback(async () => {
    try {
      const res = await api.get('/child/punishments/unread');
      if (res.data?.length > 0) {
        setUnreadPunishments(res.data);
        if (!currentAlert) { setCurrentAlert(res.data[0]); playErrorSound(); }
      }
    } catch (err) { console.error(err); }
  }, [currentAlert]);

  useEffect(() => {
    checkUnreadPunishments();
    const timer = setInterval(checkUnreadPunishments, 20000);
    return () => clearInterval(timer);
  }, [checkUnreadPunishments]);

  const handleAcknowledgePunishment = async (id: string) => {
    try {
      await api.post(`/child/punishments/${id}/read`); setCurrentAlert(null);
      const remaining = unreadPunishments.filter(p => p.id !== id); setUnreadPunishments(remaining);
      if (remaining.length > 0) setTimeout(() => setCurrentAlert(remaining[0]), 500);
    } catch (err) { console.error(err); }
  };

  const openChestGuide = async () => {
    try {
      const res = await api.get('/child/chest-prizes');
      setChestGuide({ prizes: res.data?.prizes || [], settings: res.data?.settings, note: res.data?.note });
    } catch (err) {
      setChestGuide({ prizes: [], note: '宝箱说明暂时加载失败，请稍后再试。' });
    } finally {
      setShowChestGuide(true);
    }
  };

  const handleSelectDate = (dateStr: string) => { const today = new Date().toISOString().split('T')[0]; setSelectedDate(dateStr === today ? '' : dateStr); };

  useEffect(() => {
    const handleLayoutRefresh = () => {
      fetchTasks();
    };
    window.addEventListener('starcoin:child-refresh', handleLayoutRefresh);
    return () => window.removeEventListener('starcoin:child-refresh', handleLayoutRefresh);
  }, [fetchTasks]);

  const completedCount = tasks.filter(t => ['approved', 'completed', 'pending'].includes(t.status)).length;
  const getFormattedDate = (dateStr: string) => { const date = new Date(dateStr); const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']; return { day: days[date.getDay()], date: `${date.getMonth() + 1}.${date.getDate()}` }; };
  const maxEarned = Math.max(...weeklyStats.map(s => s.earned || s.coins || 0), 10);
  const totalWeeklyNet = weeklyStats.reduce((acc, cur) => acc + (cur.coins ?? 0), 0);
  const formatSignedNumber = (value: number) => value > 0 ? `+${value}` : String(value || 0);
  const overlayBounds = getChildViewportBounds();
  const drawerWidth = getDrawerWidth();

  const detailIsPreview = Boolean(taskDetail?.isPreview);
  const detailCategory = detailIsPreview ? getTaskCategoryInfo(taskDetail?.category) : null;
  const detailActiveTask = detailIsPreview ? activeTasks.find(t => t.id === taskDetail?.id) : null;

  return (
    <>
      <div className="p-4 space-y-6">
        <div className="bg-gradient-to-br from-indigo-600 to-purple-700 rounded-2xl p-5 shadow-lg text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 p-2 opacity-10"><Calendar size={100} /></div>
          <div className="flex justify-between items-start mb-6 relative z-10">
            <div>
                <h2 className="font-bold text-xl tracking-tight">本周收获</h2>
                <p className="text-xs text-indigo-200 mt-1">坚持就是胜利！</p>
            </div>
            <div className="text-right">
                <div className={`text-3xl font-black drop-shadow-sm ${totalWeeklyNet >= 0 ? 'text-yellow-300' : 'text-red-300'}`}>
                    {formatSignedNumber(totalWeeklyNet)} <span className="text-sm font-medium text-white/80">金币</span>
                </div>
            </div>
          </div>
          <div className="flex justify-between items-end h-32 gap-2 pt-2 relative z-10">
              {weeklyStats.map((day, index) => {
                  const isTodayBar = index === 6;
                  const isSelected = selectedDate === day.date || (selectedDate === '' && isTodayBar);
                  const dayEarned = day.earned ?? day.coins ?? 0;
                  const heightPercent = (dayEarned / maxEarned) * 100;
                  const { day: weekDay, date: dateNum } = getFormattedDate(day.date);
                  return (
                      <div key={day.date} className="flex flex-col items-center gap-2 flex-1 group cursor-pointer" onClick={() => handleSelectDate(day.date)}>
                          <div className="relative w-full flex justify-center items-end h-full">
                              <div style={{ height: `${Math.max(heightPercent, 8)}%` }} className={`w-2.5 sm:w-3 rounded-t-md transition-all duration-500 ${isSelected ? 'bg-gradient-to-t from-yellow-400 to-yellow-200 shadow-lg' : 'bg-white/20'}`}></div>
                          </div>
                          <div className="flex flex-col items-center gap-0.5">
                              <div className={`text-[10px] font-medium ${isSelected ? 'text-yellow-300' : 'text-indigo-200'}`}>{weekDay}</div>
                              <div className={`text-[9px] scale-90 ${isSelected ? 'text-white font-bold bg-indigo-500/50 px-1 rounded' : 'text-indigo-300'}`}>{dateNum}</div>
                          </div>
                      </div>
                  )
              })}
          </div>
          {!isToday && <button onClick={() => setSelectedDate('')} className="mt-3 w-full py-2 bg-white/20 rounded-lg text-xs font-bold text-white">← 返回今天</button>}
        </div>

        <div>
          <div className="flex items-center justify-between mb-3 px-1">
              <h2 className="font-bold text-lg text-gray-800 flex items-center gap-2">{isToday ? '✅ 今日待办' : `📋 ${selectedDate.slice(5).replace('-', '月')}日`}</h2>
              <div className="text-xs font-bold text-gray-500 bg-white px-3 py-1.5 rounded-full border shadow-sm">已完成 <span className="text-blue-600 text-sm mx-1">{completedCount}</span> / {tasks.length}</div>
          </div>

          {/* 状态颜色图例 */}
          <div className="flex gap-3 mb-2 px-1 text-[10px] text-gray-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400"></span>已完成</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400"></span>审核中</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500"></span>待开始</span>
            {!isToday && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400"></span>未完成</span>}
          </div>

          <div className="flex gap-2 mb-3 overflow-x-auto pb-1 px-1">
            {TASK_CATEGORIES.map(cat => {
              const count = cat === '全部'
                ? tasks.length
                : cat === '合作'
                  ? coopTasks.length
                  : tasks.filter(t => taskMatchesCategory(t.category, cat)).length;
              if (cat !== '全部' && count === 0) return null;
              return (
                <button key={cat} onClick={() => setFilterCategory(cat)} className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${filterCategory === cat ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 border'}`}>{cat} ({count})</button>
              );
            })}
            <button onClick={openChestGuide} className="px-3 py-1 rounded-full text-xs font-bold transition-all bg-amber-50 text-amber-600 border border-amber-100 flex items-center gap-1 whitespace-nowrap">
              <Info size={12}/> 宝箱说明
            </button>
          </div>
          {filterCategory !== '全部' && (
            <div className="mb-3 mx-1 rounded-2xl bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-700 font-bold leading-relaxed">
              <span className="mr-1">{selectedCategoryInfo.icon}</span>
              {selectedCategoryInfo.label}：{selectedCategoryInfo.childHint}
            </div>
          )}

          <div className="space-y-3 pb-20">
            {loading && <div className="text-center text-gray-400 py-4">加载中...</div>}
            {!loading && tasks.length === 0 && (
              <div className="bg-gray-50 rounded-2xl p-8 text-center border border-dashed"><div className="text-4xl mb-2">📋</div><div className="text-gray-500 text-sm">暂无任务</div></div>
            )}
            {/* 合作任务展示 */}
            {isToday && filterCategory !== '合作' && coopTasks.length > 0 && (
                <div className="mb-4 space-y-2">
                    {coopTasks.map(task => renderTaskCard(task))}
                </div>
            )}
            {filterCategory === '全部' ? (
              TASK_CATEGORY_VALUES.map(cat => {
                const catTasks = regularTasks.filter(t => taskMatchesCategory(t.category, cat));
                if (catTasks.length === 0) return null;
                const info = getTaskCategoryInfo(cat);
                return (
                  <div key={cat} className="mb-4">
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <span className="text-sm font-black text-gray-400">{info.icon} {info.label}</span>
                      <div className="flex-1 h-px bg-gray-100" />
                    </div>
                    <div className="text-[11px] text-gray-400 font-bold px-1 mb-2">{info.childHint}</div>
                    <div className="space-y-2">{catTasks.map(task => renderTaskCard(task))}</div>
                  </div>
                );
              })
            ) : filteredTasks.map(task => renderTaskCard(task))}
          </div>
        </div>
      </div>

      {showDetailModal && taskDetail && createPortal(
        <div
          className="z-[9999] bg-black/55 backdrop-blur-sm flex items-end justify-center pointer-events-auto"
          style={getOverlayStyle(overlayBounds)}
          onClick={() => setShowDetailModal(false)}
        >
          <div
            className="bg-white rounded-t-3xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300"
            style={{ maxHeight: Math.max(360, overlayBounds.height - 20) }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 bg-gray-300 rounded-full" />
            </div>
            <div className="p-4 pt-0 border-b flex justify-between items-center">
              <div>
                <h3 className="font-black text-gray-900">{detailIsPreview ? '任务说明' : '任务详情'}</h3>
                {detailIsPreview && detailCategory && (
                  <div className="text-xs text-gray-500 mt-1">{detailCategory.icon} {detailCategory.label} · {detailCategory.childHint}</div>
                )}
              </div>
              <button onClick={() => setShowDetailModal(false)} className="p-2 -mr-2 hover:bg-gray-100 rounded-full">
                <X size={20}/>
              </button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto">
              <div className="bg-gray-50 p-4 rounded-2xl">
                <h4 className="font-black text-gray-900">{taskDetail.title}</h4>
                {detailIsPreview ? (
                  <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
                    <span className="bg-white px-2 py-1 rounded-lg text-gray-600"><Clock size={12} className="inline mr-1" />{taskDetail.duration} 分钟</span>
                    {taskDetail.isParallel && <span className="bg-blue-50 px-2 py-1 rounded-lg text-blue-600">可并行</span>}
                    {!isToday && <span className="bg-red-50 px-2 py-1 rounded-lg text-red-500">历史日期</span>}
                  </div>
                ) : (
                  <div className="text-xs text-gray-400 mt-1">提交：{new Date(taskDetail.submittedAt).toLocaleString()}</div>
                )}
              </div>

              <div className="bg-green-50 p-4 rounded-2xl border border-green-100">
                <div className="text-sm font-black text-green-800 mb-3">{detailIsPreview ? '完成后可获得' : '已获得奖励'}</div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center bg-white/80 rounded-2xl p-3">
                    <div className="text-xl font-black text-yellow-600">+{detailIsPreview ? taskDetail.coins : taskDetail.earnedCoins}</div>
                    <div className="text-[10px] font-bold text-gray-500">金币</div>
                  </div>
                  <div className="text-center bg-white/80 rounded-2xl p-3">
                    <div className="text-xl font-black text-blue-600">+{detailIsPreview ? taskDetail.xp : taskDetail.earnedXp}</div>
                    <div className="text-[10px] font-bold text-gray-500">经验</div>
                  </div>
                </div>
              </div>

              {detailIsPreview && (
                <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100 text-xs text-amber-700 font-bold leading-relaxed">
                  完成任务后会立即打开宝箱。任务越难，越容易获得价值更高的惊喜奖励。
                </div>
              )}

              {taskDetail.punishment && (
                <div className="bg-red-50 p-4 rounded-2xl border border-red-100">
                  <div className="text-sm font-black text-red-700 mb-1">复盘提醒</div>
                  <div className="text-xs text-red-600">{taskDetail.punishment.reason} (-{taskDetail.punishment.deductedCoins}💰)</div>
                </div>
              )}
            </div>
            <div className="p-4 border-t bg-white">
              {detailIsPreview && isToday && taskDetail.status === 'todo' && !detailActiveTask ? (
                <Button
                  className="w-full bg-blue-600 border-none"
                  onClick={() => {
                    setShowDetailModal(false);
                    handleStartTask(taskDetail, null);
                  }}
                >
                  开始任务
                </Button>
              ) : detailIsPreview && detailActiveTask ? (
                <Button
                  className="w-full bg-blue-600 border-none"
                  onClick={() => {
                    setShowDetailModal(false);
                    focusTask(detailActiveTask, null);
                  }}
                >
                  打开计时器
                </Button>
              ) : (
                <button onClick={() => setShowDetailModal(false)} className="w-full py-3 bg-gray-100 rounded-2xl font-black text-gray-700">关闭</button>
              )}
            </div>
          </div>
        </div>, getChildOverlayRoot() || document.body
      )}

      {showChestModal && chestReward && createPortal(
        <div className="z-[10000] p-4 bg-black/70 backdrop-blur-sm" style={getOverlayStyle(overlayBounds)} onClick={() => setShowChestModal(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-8 text-center animate-in zoom-in-95" style={getAnchoredModalStyle(null, overlayBounds, 384, 440)} onClick={e => e.stopPropagation()}>
            <div className="text-6xl mb-4 animate-bounce">{chestReward.icon || '🎁'}</div>
            <h3 className="text-2xl font-black text-gray-800 mb-2">惊喜宝箱！</h3>
            <div className="text-4xl font-black text-yellow-500 mb-4">+{chestReward.value} {chestReward.type === 'coins' ? '💰' : '⭐'}</div>
            <button onClick={() => setShowChestModal(false)} className="w-full py-3 bg-gradient-to-r from-yellow-400 to-orange-500 text-white font-bold rounded-xl shadow-lg">太棒了！</button>
          </div>
        </div>,
        getChildOverlayRoot() || document.body
      )}

      {showChestGuide && createPortal(
        <div className="z-[10000] p-4 bg-black/60 backdrop-blur-sm pointer-events-auto" style={getOverlayStyle(overlayBounds)} onClick={() => setShowChestGuide(false)}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-5 animate-in zoom-in-95 overflow-hidden flex flex-col" style={getAnchoredModalStyle(null, overlayBounds, 384, 540)} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-lg font-black text-gray-800">宝箱里可能有什么？</h3>
                <p className="text-xs text-gray-500 mt-1">完成任务就会打开惊喜宝箱</p>
              </div>
              <button onClick={() => setShowChestGuide(false)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-full"><X size={18}/></button>
            </div>
            <div className="p-3 rounded-2xl bg-amber-50 border border-amber-100 text-xs text-amber-700 font-bold mb-3">
              当前规则：完成任务必定打开宝箱；困难任务更容易开到高价值奖品。
            </div>
            <div className="space-y-2 overflow-y-auto pr-1" style={{ maxHeight: 320 }}>
              {chestGuide.prizes.length === 0 ? (
                <div className="text-center py-6 text-sm text-gray-400">家长还没有配置宝箱奖品</div>
              ) : chestGuide.prizes.map(prize => {
                const rarity = getRarityMeta(prize.rarity);
                return (
                  <div key={prize.id} className="flex items-center gap-3 p-3 rounded-2xl bg-gray-50 border border-gray-100">
                    <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-xl shadow-sm">{prize.icon || '🎁'}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-black text-gray-800 truncate">{prize.name}</div>
                      <div className="text-xs text-gray-500 truncate">
                        {prize.type === 'coins' ? `${prize.value} 金币` :
                         prize.type === 'xp' ? `${prize.value} 经验` :
                         prize.type === 'privilegePoints' ? `${prize.value} 特权点` :
                         prize.type === 'lotteryTicket' ? `${prize.value} 张抽奖券` : prize.description || '神秘奖励'}
                      </div>
                    </div>
                    <span className={`text-[10px] px-2 py-1 rounded-full border font-black whitespace-nowrap ${rarity.className}`}>
                      {rarity.zh} / {rarity.en}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>,
        getChildOverlayRoot() || document.body
      )}

      {currentAlert && createPortal(
        <div className="z-[10001] p-6 bg-black/70 backdrop-blur-md" style={getOverlayStyle(overlayBounds)}>
            <div className="bg-white rounded-3xl w-full max-w-xs overflow-hidden shadow-2xl border-4 border-red-500 animate-in zoom-in-95" style={getAnchoredModalStyle(null, overlayBounds, 320, 500)}>
                <div className="bg-red-500 p-6 text-center"><div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 rounded-full mb-3 animate-bounce"><AlertTriangle size={32} className="text-white" /></div><h3 className="text-white font-black text-xl">行为警示</h3></div>
                <div className="p-6 space-y-4">
                    <div className="p-3 bg-red-50 rounded-xl text-red-700 font-bold text-sm border border-red-100">{currentAlert.reason}</div>
                    <div className="flex gap-4"><div className="flex-1"><div className="text-[10px] text-gray-400 uppercase">扣除</div><div className="text-xl font-black text-red-600">-{currentAlert.deductedCoins} 💰</div></div><div className="flex-1"><div className="text-[10px] text-gray-400 uppercase">执行人</div><div className="text-sm font-bold text-gray-700">{currentAlert.parentName}</div></div></div>
                    <button onClick={() => handleAcknowledgePunishment(currentAlert.id)} className="w-full py-4 bg-gradient-to-r from-red-600 to-orange-600 text-white font-black rounded-2xl shadow-lg mt-4">我知道了</button>
                </div>
            </div>
        </div>,
        getChildOverlayRoot() || document.body
      )}

      {activeTasks.length > 0 && createPortal(
          <div
            ref={drawerRef}
            className={`task-drawer ${isDraggingDrawer ? 'dragging' : ''}`}
            style={drawerPosition ? { left: drawerPosition.x, top: drawerPosition.y, bottom: 'auto', transform: 'none', width: drawerWidth } : { width: drawerWidth }}
            onPointerMove={handleDrawerPointerMove}
            onPointerUp={handleDrawerPointerUp}
            onPointerCancel={handleDrawerPointerUp}
          >
              <div className="timer-drawer-handle" onPointerDown={handleDrawerPointerDown}>
                <div className="flex items-center gap-2 min-w-0">
                  <GripHorizontal size={18} />
                  <span className="truncate">进行中 {activeTasks.length} 个任务</span>
                </div>
                <span className="text-[10px] font-bold text-gray-400">拖动调整位置</span>
              </div>
              {activeTasks.map(task => (
                  <TaskTimerItem key={task.id} task={task} onComplete={(d, o) => handleTaskComplete(task.id, d, o)} onExpand={(anchor) => focusTask(task, anchor)} onAbandon={() => handleTaskAbandon(task.id)} />
              ))}
          </div>
        ,
        getChildOverlayRoot() || document.body
      )}

      {focusedTask && (
          <TaskTimerModal task={focusedTask} anchor={timerAnchor} onClose={closeFocusedTask} onComplete={(d, o) => handleTaskComplete(focusedTask.id, d, o)} onAbandon={() => handleTaskAbandon(focusedTask.id)} />
      )}

      <Confetti active={showConfetti} />
      <ConfirmDialog />
    </>
  );
}

const AlertTriangle = ({ size, className }: { size: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>
  </svg>
);
