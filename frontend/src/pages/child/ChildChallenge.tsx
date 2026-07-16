import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen, CheckCircle2, ChevronDown, Clock, Gift, HelpCircle, Pause, Play, Send, Sparkles, Star, Users, X, Zap } from 'lucide-react';
import api, { isAuthError } from '../../services/api';
import { t } from '../../i18n';
import { useToast } from '../../components/Toast';
import { useConfirmDialog } from '../../components/ConfirmDialog';
import { BottomSheet } from '../../components/BottomSheet';
import { TASK_CATEGORY_FILTERS, getTaskCategoryInfo, normalizeTaskCategory, taskMatchesCategory } from '../../utils/taskCategories';
import { getTaskCompletionSummary } from '../../utils/taskCompletion';
import { playSuccessSound, playMagicSound } from '../../utils/sounds';
import { Confetti } from '../../components/Confetti';

type TabKey = 'today' | 'learning' | 'family';

type Task = {
  id: string;
  title: string;
  category?: string;
  icon?: string;
  status?: string;
  taskType?: string;
  coinReward?: number;
  xpReward?: number;
  durationMinutes?: number;
  coins?: number;
  xp?: number;
  duration?: number;
  isParallel?: number;
  sessionId?: string;
  sessionStartedAt?: string;
  completionMode?: string;
  targetValue?: number | string | null;
  targetUnit?: string | null;
  reviewFocus?: string | null;
  // 后端预告：审核通过后约可得的游戏票分钟数（基础档，0=不发）
  gameTicketPreviewMinutes?: number;
  // 后端标记：学习类省时换游戏票资格（提前完成可得，不预告具体分钟）
  gameTicketEarnBySpeed?: boolean;
};

type Quest = {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  subject?: string;
  feeling?: string;
  resistanceLevel?: string;
  sessionStatus?: string;
  sessionId?: string;
  currentStepIndex?: number;
  stuckReason?: string;
  totalCoins?: number;
  totalXp?: number;
  estimatedMinutes?: number;
  steps?: LearningStep[];
};

type LearningStep = {
  id: string;
  title: string;
  minutes: number;
  coins?: number;
  xp?: number;
  prompt?: string;
};

type Bounds = { left: number; top: number; right: number; bottom: number; width: number; height: number };

const tabs: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
  { key: 'today', label: '普通', icon: <Zap size={16} /> },
  { key: 'learning', label: '学习', icon: <BookOpen size={16} /> },
  { key: 'family', label: '全家', icon: <Users size={16} /> },
];

const isDone = (status?: string) => ['approved', 'completed', 'pending'].includes(String(status || ''));

// 与家长端审批维度命名保持一致（孩子看到的 = 家长评的）；家长自定义的 reviewFocus 优先生效
const REVIEW_FOCUS_BY_CATEGORY: Record<string, string> = {
  学习: '专注投入、认真程度、自主与求助（求助加分）',
  生活: '及时完成、仔细程度、不用提醒',
  运动: '坚持时长、投入程度、愿意开始',
  情绪调节: '及时使用、方法完成度、主动觉察',
};

const getAlignedReviewFocus = (
  task: { reviewFocus?: string | null; taskType?: string; category?: string },
  fallback: string
): string => {
  const custom = String(task.reviewFocus || '').trim();
  if (custom) return custom;
  if (String(task.taskType || '') === 'family') return '准时参与、配合度、带动气氛';
  return REVIEW_FOCUS_BY_CATEGORY[normalizeTaskCategory(task.category)] || fallback;
};
const ACTIVE_TASKS_KEY = 'stellar_active_tasks_v2';
const CHILD_CHALLENGE_CACHE_KEY = 'stellar_child_challenge_cache_v1';
const getTaskDataKey = (id: string) => `stellar_task_data_${id}`;

const STUCK_OPTIONS = [
  { label: '不会做', hint: '先圈出题目关键词，再问一个具体问题。' },
  { label: '太多了', hint: '只看当前这一小关，先完成 3 分钟。' },
  { label: '太烦了', hint: '喝口水，回来只做第一步。' },
  { label: '怕做错', hint: '今天先奖励尝试，错了也可以改。' },
];

const feelingLabel: Record<string, string> = {
  like: '轻松关',
  normal: '普通关',
  bored: '无聊关',
  afraid: '勇气关',
};

const levelStyle: Record<string, string> = {
  hard: 'from-rose-500 to-orange-500',
  medium: 'from-indigo-500 to-sky-500',
  easy: 'from-emerald-500 to-teal-500',
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

const formatSignedNumber = (value: number) => {
  const normalized = Number(value || 0);
  if (normalized > 0) return `+${normalized}`;
  if (normalized < 0) return String(normalized);
  return '0';
};

const getBeijingDateKeyFromMs = (timestamp: number) => {
  const date = new Date(timestamp + 8 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
};

const getTodayBeijingDateKey = () => getBeijingDateKeyFromMs(Date.now());

const readChildChallengeCache = () => {
  if (typeof window === 'undefined') return null;
  try {
    const cached = JSON.parse(sessionStorage.getItem(CHILD_CHALLENGE_CACHE_KEY) || 'null');
    if (!cached?.cachedAt || Date.now() - Number(cached.cachedAt) > 5 * 60 * 1000) return null;
    return cached;
  } catch {
    return null;
  }
};

const writeChildChallengeCache = (data: any) => {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(CHILD_CHALLENGE_CACHE_KEY, JSON.stringify({ ...data, cachedAt: Date.now() }));
  } catch {
    // session cache is best-effort only
  }
};

const normalizeTimerTask = (task: Task) => ({
  ...task,
  coins: Number(task.coinReward ?? task.coins ?? 0),
  xp: Number(task.xpReward ?? task.xp ?? 0),
  duration: Number(task.durationMinutes ?? task.duration ?? 1),
});

const persistActiveTask = (task: Task, startedAt?: string | number, resetTimer = true) => {
  const nextTask = normalizeTimerTask(task);
  const saved = localStorage.getItem(ACTIVE_TASKS_KEY);
  let activeTasks: any[] = [];
  if (saved) {
    try {
      activeTasks = JSON.parse(saved);
    } catch {
      activeTasks = [];
    }
  }
  const next = [...activeTasks.filter(item => item.id !== task.id), nextTask];
  localStorage.setItem(ACTIVE_TASKS_KEY, JSON.stringify(next));
  const currentTimer = getStoredTaskTimer(task.id);
  if (resetTimer || !currentTimer?.startTime) {
    const parsedStart = typeof startedAt === 'string' ? new Date(startedAt).getTime() : Number(startedAt || Date.now());
    const safeStart = Number.isFinite(parsedStart) ? parsedStart : Date.now();
    localStorage.setItem(getTaskDataKey(task.id), JSON.stringify({
      startTime: safeStart,
      startedDate: getBeijingDateKeyFromMs(safeStart),
      pausedDuration: 0,
      pauseStartTime: null,
    }));
  }
};

const removeActiveTask = (taskId: string) => {
  const saved = localStorage.getItem(ACTIVE_TASKS_KEY);
  if (saved) {
    try {
      const activeTasks = JSON.parse(saved).filter((item: any) => item.id !== taskId);
      localStorage.setItem(ACTIVE_TASKS_KEY, JSON.stringify(activeTasks));
    } catch {
      localStorage.removeItem(ACTIVE_TASKS_KEY);
    }
  }
  localStorage.removeItem(getTaskDataKey(taskId));
};

const getStoredActiveTasks = (): Task[] => {
  try {
    const todayKey = getTodayBeijingDateKey();
    const parsed = JSON.parse(localStorage.getItem(ACTIVE_TASKS_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    const validTasks = parsed.filter((task: any) => {
      const timer = task?.id ? getStoredTaskTimer(task.id) : null;
      const startTime = Number(timer?.startTime || (task?.sessionStartedAt ? new Date(task.sessionStartedAt).getTime() : 0));
      const taskDate = timer?.startedDate || (Number.isFinite(startTime) && startTime > 0 ? getBeijingDateKeyFromMs(startTime) : todayKey);
      const isToday = taskDate === todayKey;
      if (!isToday && task?.id) localStorage.removeItem(getTaskDataKey(task.id));
      return isToday;
    });
    if (validTasks.length !== parsed.length) {
      localStorage.setItem(ACTIVE_TASKS_KEY, JSON.stringify(validTasks));
    }
    return validTasks;
  } catch {
    localStorage.removeItem(ACTIVE_TASKS_KEY);
    return [];
  }
};

const getStoredTaskTimer = (taskId: string) => {
  try {
    return JSON.parse(localStorage.getItem(getTaskDataKey(taskId)) || 'null');
  } catch {
    return null;
  }
};

const getTaskElapsedSeconds = (taskId: string) => {
  const data = getStoredTaskTimer(taskId);
  if (!data?.startTime) return 0;
  const now = Date.now();
  let elapsed = Math.floor((now - Number(data.startTime)) / 1000) - Math.floor(Number(data.pausedDuration || 0) / 1000);
  if (data.pauseStartTime) elapsed -= Math.floor((now - Number(data.pauseStartTime)) / 1000);
  return Math.max(0, elapsed);
};

const getTaskIsTimerActive = (taskId: string) => !getStoredTaskTimer(taskId)?.pauseStartTime;

const setTaskTimerPaused = (taskId: string, shouldPause: boolean) => {
  const data = getStoredTaskTimer(taskId) || { startTime: Date.now(), pausedDuration: 0, pauseStartTime: null };
  if (shouldPause && !data.pauseStartTime) {
    localStorage.setItem(getTaskDataKey(taskId), JSON.stringify({ ...data, pauseStartTime: Date.now() }));
    return;
  }
  if (!shouldPause && data.pauseStartTime) {
    const pausedDuration = Number(data.pausedDuration || 0) + (Date.now() - Number(data.pauseStartTime));
    localStorage.setItem(getTaskDataKey(taskId), JSON.stringify({ ...data, pausedDuration, pauseStartTime: null }));
  }
};

const statusText = (status?: string) => {
  if (status === 'running') return '进行中';
  if (status === 'approved' || status === 'completed') return '已完成';
  if (status === 'pending') return '等确认';
  if (status === 'rejected') return '可重做';
  return '可挑战';
};

const getInitialTab = (search: string): TabKey => {
  const value = new URLSearchParams(search).get('tab');
  return tabs.some(tab => tab.key === value) ? (value as TabKey) : 'today';
};

const getChildMainBounds = (): Bounds => {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return { left: 0, top: 0, right: 390, bottom: 720, width: 390, height: 720 };
  }
  const viewport = document.querySelector('[data-child-main-viewport="true"]') as HTMLElement | null;
  const frame = document.querySelector('[data-child-app-frame="true"]') as HTMLElement | null;
  const rect = (viewport || frame)?.getBoundingClientRect();
  if (rect) {
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }
  return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight };
};

const getChildFrameBounds = (): Bounds => {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return { left: 0, top: 0, right: 390, bottom: 720, width: 390, height: 720 };
  }
  const frame = document.querySelector('[data-child-app-frame="true"]') as HTMLElement | null;
  const rect = frame?.getBoundingClientRect();
  if (rect) {
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }
  return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight };
};

const getChildOverlayRoot = () => (
  typeof document === 'undefined'
    ? null
    : document.querySelector('[data-child-overlay-root="true"]') as HTMLElement | null
);

const getTimerBarWidth = () => Math.min(260, Math.max(190, getChildMainBounds().width * 0.55));

const getDefaultTimerBarPosition = () => {
  const bounds = getChildMainBounds();
  const frame = getChildFrameBounds();
  return {
    x: bounds.left - frame.left + 12,
    y: bounds.top - frame.top + 8,
  };
};

const clampTimerBarPosition = (x: number, y: number) => {
  const main = getChildMainBounds();
  const frame = getChildFrameBounds();
  const width = getTimerBarWidth();
  const minX = Math.max(8, main.left - frame.left + 8);
  const maxX = Math.max(minX, frame.width - width - 8);
  const minY = Math.max(8, main.top - frame.top + 6);
  const maxY = Math.max(minY, frame.height - 84);
  return {
    x: Math.min(maxX, Math.max(minX, x)),
    y: Math.min(maxY, Math.max(minY, y)),
  };
};

const escapeDataAttribute = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const scrollTaskElementIntoChildViewport = (taskId: string) => {
  if (typeof document === 'undefined') return false;
  const element = document.querySelector(`[data-challenge-task-id="${escapeDataAttribute(taskId)}"]`) as HTMLElement | null;
  if (!element) return false;

  const viewport = document.querySelector('[data-child-main-viewport="true"]') as HTMLElement | null;
  if (viewport) {
    const itemRect = element.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const nextTop = viewport.scrollTop + itemRect.top - viewportRect.top - Math.max(16, (viewportRect.height - itemRect.height) / 2);
    viewport.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
  } else {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  return true;
};

export default function ChildChallenge() {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm, Dialog: ConfirmDialog } = useConfirmDialog();
  const [activeTab, setActiveTab] = useState<TabKey>(() => getInitialTab(location.search));
  const cachedChallenge = useMemo(() => readChildChallengeCache(), []);
  const [dashboard, setDashboard] = useState<any>(cachedChallenge?.dashboard || null);
  const [quests, setQuests] = useState<Quest[]>(cachedChallenge?.quests || []);
  const [screenSummary, setScreenSummary] = useState<any>(cachedChallenge?.screenSummary || null);
  const [loading, setLoading] = useState(!cachedChallenge?.dashboard);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [runningTask, setRunningTask] = useState<Task | null>(null);
  const [activeTimerTasks, setActiveTimerTasks] = useState<Task[]>([]);
  const [timerMinimized, setTimerMinimized] = useState(false);
  const [timerBarPosition, setTimerBarPosition] = useState(getDefaultTimerBarPosition);
  const [timerNow, setTimerNow] = useState(Date.now());
  const [timerRunning, setTimerRunning] = useState(false);
  const [submittingTask, setSubmittingTask] = useState(false);
  const [highlightTaskId, setHighlightTaskId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ taskId: string; tab: TabKey; nonce: number } | null>(null);
  const [chestReward, setChestReward] = useState<any>(null);
  const [showChestModal, setShowChestModal] = useState(false);
  const [chestStage, setChestStage] = useState<'opening' | 'revealed'>('revealed');
  const [showChestGuide, setShowChestGuide] = useState(false);
  const [chestGuide, setChestGuide] = useState<{ settings?: any; prizes: any[]; note?: string; puzzleProgress?: { pieces: number; required: number } }>({ prizes: [] });
  const [activeQuest, setActiveQuest] = useState<Quest | null>(null);
  const [learningSessionId, setLearningSessionId] = useState('');
  const [learningStepIndex, setLearningStepIndex] = useState(0);
  const [learningSecondsLeft, setLearningSecondsLeft] = useState(0);
  const [learningRunning, setLearningRunning] = useState(false);
  const [learningProof, setLearningProof] = useState('');
  const [stuckReason, setStuckReason] = useState('');
  const [stuckHint, setStuckHint] = useState('');
  const [learningSubmitting, setLearningSubmitting] = useState(false);
  const [selectedWeeklyDate, setSelectedWeeklyDate] = useState('');
  const [selectedTaskCategory, setSelectedTaskCategory] = useState('全部');
  const [taskListExpanded, setTaskListExpanded] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [weeklyReport, setWeeklyReport] = useState<{ weekStart: string; childStory: string } | null>(null);
  const [weeklyExpanded, setWeeklyExpanded] = useState(false);
  const [freshDashboardReady, setFreshDashboardReady] = useState(false);
  const timerDragRef = useRef({ dragging: false, moved: false, offsetX: 0, offsetY: 0, startX: 0, startY: 0, lastPos: null as { x: number; y: number } | null });
  const focusRequestNonceRef = useRef(0);
  const handledTargetRef = useRef('');
  const wakeLockRef = useRef<any>(null);
  const wakeVideoRef = useRef<HTMLVideoElement | null>(null);

  // M25: 计时面板打开时保持屏幕常亮，wakeLock 不可用时用静音视频兜底
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try { wakeLockRef.current = await (navigator as any).wakeLock.request('screen'); } catch { /* 忽略：走 video 兜底 */ }
    }
    if (!wakeLockRef.current && wakeVideoRef.current) {
      try { await wakeVideoRef.current.play(); } catch { /* 忽略：浏览器拒绝自动播放 */ }
    }
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current !== null) {
      try { await wakeLockRef.current.release(); wakeLockRef.current = null; } catch { wakeLockRef.current = null; }
    }
    if (wakeVideoRef.current) {
      try { wakeVideoRef.current.pause(); } catch { /* 忽略：video 已卸载 */ }
    }
  };

  const refreshActiveTimerTasks = () => {
    const storedTasks = getStoredActiveTasks().map(normalizeTimerTask);
    setActiveTimerTasks(storedTasks);
    return storedTasks;
  };

  const fetchData = async () => {
    if (!dashboard) setLoading(true);
    const [dashboardRes, questRes, screenRes] = await Promise.allSettled([
      api.get('/child/dashboard'),
      api.get('/child/learning-quests'),
      api.get('/child/screen-time'),
    ]);

    const nextDashboard = dashboardRes.status === 'fulfilled' ? dashboardRes.value.data : dashboard;
    const nextQuests = questRes.status === 'fulfilled' ? (questRes.value.data || []) : quests;
    const nextScreenSummary = screenRes.status === 'fulfilled' ? (screenRes.value.data || null) : screenSummary;

    if (nextDashboard) {
      const nextTasks: Task[] = nextDashboard?.tasks || [];
      const runningTasks = nextTasks.filter(task => task.status === 'running');
      runningTasks.forEach(task => persistActiveTask(task, task.sessionStartedAt, false));
      getStoredActiveTasks().forEach(task => {
        const latest = nextTasks.find(item => item.id === task.id);
        if (!latest || isDone(latest.status)) removeActiveTask(task.id);
      });
      refreshActiveTimerTasks();
      setDashboard(nextDashboard);
    }
    setQuests(nextQuests);
    setScreenSummary(nextScreenSummary);

    if (nextDashboard) {
      writeChildChallengeCache({
        dashboard: nextDashboard,
        quests: nextQuests,
        screenSummary: nextScreenSummary,
      });
    }

    if (dashboardRes.status === 'rejected' && !isAuthError(dashboardRes.reason)) {
      toast.error('挑战中心加载失败，请稍后重试');
    }
    setFreshDashboardReady(true);
    setLoading(false);
  };

  useEffect(() => {
    const timerSheetOpen = Boolean(runningTask) && !timerMinimized;
    if (timerSheetOpen) requestWakeLock();
    else releaseWakeLock();
    return () => { releaseWakeLock(); };
  }, [runningTask, timerMinimized]);

  useEffect(() => {
    setActiveTab(getInitialTab(location.search));
  }, [location.search]);

  useEffect(() => {
    setSelectedTaskCategory('全部');
    setTaskListExpanded(false);
  }, [activeTab]);

  useEffect(() => {
    fetchData();
  }, []);

  // R4 周报横幅：仅周一/周二（北京时间）展示，本周点过「知道啦」后不再出现
  useEffect(() => {
    const beijingNow = new Date(Date.now() + (new Date().getTimezoneOffset() + 8 * 60) * 60000);
    const day = beijingNow.getDay();
    if (day !== 1 && day !== 2) return;
    api.get('/child/weekly-report/latest').then(res => {
      const report = res.data;
      if (!report?.weekStart || !report?.childStory) return;
      if (localStorage.getItem(`starcoin:weeklySeen:${report.weekStart}`)) return;
      setWeeklyReport(report);
    }).catch(() => { /* 周报拿不到就不展示，不打扰孩子 */ });
  }, []);

  const dismissWeeklyReport = () => {
    if (weeklyReport) localStorage.setItem(`starcoin:weeklySeen:${weeklyReport.weekStart}`, '1');
    setWeeklyReport(null);
  };

  // 低电量模式（ADHD 特化 #2）：今天只留一件最小的事，不扣任何东西，明天自动恢复
  const lowEnergyToday = Boolean(dashboard?.lowEnergyToday);

  const toggleLowEnergy = async (enable: boolean) => {
    if (enable) {
      const ok = await confirm({
        title: t('lowEnergy.confirmTitle'),
        message: t('lowEnergy.confirmMessage'),
        type: 'info',
        confirmText: t('lowEnergy.confirmAction'),
      });
      if (!ok) return;
    }
    try {
      const res = await api.post('/child/low-energy/toggle');
      setDashboard((prev: any) => (prev ? { ...prev, lowEnergyToday: Boolean(res.data?.active) } : prev));
      fetchData();
    } catch {
      toast.error(t('lowEnergy.toggleFailed'));
    }
  };

  useEffect(() => {
    const storedTasks = refreshActiveTimerTasks();
    if (storedTasks.length > 0) setTimerMinimized(true);
  }, []);

  useEffect(() => {
    if (!runningTask && activeTimerTasks.length === 0) return undefined;
    const update = () => {
      setTimerNow(Date.now());
      if (runningTask) setTimerRunning(getTaskIsTimerActive(runningTask.id));
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [runningTask?.id, activeTimerTasks.length]);

  const currentLearningStep = activeQuest?.steps?.[learningStepIndex];

  useEffect(() => {
    if (!currentLearningStep) return;
    setLearningSecondsLeft(Math.max(60, Number(currentLearningStep.minutes || 1) * 60));
    setLearningRunning(false);
    setStuckHint('');
  }, [currentLearningStep?.id]);

  useEffect(() => {
    if (!learningRunning) return;
    const timer = window.setInterval(() => {
      setLearningSecondsLeft(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [learningRunning]);

  useEffect(() => {
    if (activeTimerTasks.length === 0) return;
    setTimerBarPosition(position => clampTimerBarPosition(position.x, position.y));

    const handleResize = () => {
      setTimerBarPosition(position => clampTimerBarPosition(position.x, position.y));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [activeTimerTasks.length]);

  const formatTimer = (seconds: number) => {
    const safeSeconds = Math.max(0, Math.abs(seconds));
    const minutes = Math.floor(safeSeconds / 60).toString().padStart(2, '0');
    const rest = (safeSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${rest}`;
  };

  const formatLearningTimer = (seconds: number) => {
    const value = Math.max(0, seconds);
    const minutes = Math.floor(value / 60).toString().padStart(2, '0');
    const rest = (value % 60).toString().padStart(2, '0');
    return `${minutes}:${rest}`;
  };

  const getDurationSeconds = (task: Task) => Math.max(1, Number(task.durationMinutes ?? task.duration ?? 1) * 60);
  const getElapsedSeconds = (task: Task) => {
    if (timerNow < 0) return 0;
    return getTaskElapsedSeconds(task.id);
  };
  const getRemainingSeconds = (task: Task) => getDurationSeconds(task) - getElapsedSeconds(task);
  const formatRemainingTimer = (task: Task) => {
    const remaining = getRemainingSeconds(task);
    return remaining < 0 ? `-${formatTimer(remaining)}` : formatTimer(remaining);
  };

  const openRunningTimer = (task: Task) => {
    const storedTask = getStoredActiveTasks().find(item => item.id === task.id) || task;
    setSelectedTask(null);
    setRunningTask(normalizeTimerTask(storedTask));
    setTimerRunning(getTaskIsTimerActive(task.id));
    setTimerMinimized(false);
  };

  const startTaskInChallenge = async (task: Task) => {
    if (isDone(task.status)) return;
    const storedTask = getStoredActiveTasks().find(item => item.id === task.id);
    if (storedTask) {
      openRunningTimer(storedTask);
      return;
    }
    setSubmittingTask(true);
    try {
      const res = await api.post(`/child/tasks/${task.id}/start`);
      persistActiveTask({ ...task, sessionId: res.data?.session?.id, sessionStartedAt: res.data?.session?.startedAt });
      refreshActiveTimerTasks();
      setSelectedTask(null);
      setRunningTask(normalizeTimerTask(task));
      setTimerMinimized(false);
      setTimerRunning(true);
      fetchData();
    } catch (e: any) {
      toast.error(e.response?.data?.message || '开始任务失败');
      setSelectedTask(task);
      fetchData();
    } finally {
      setSubmittingTask(false);
    }
  };

  const submitRunningTask = async () => {
    if (!runningTask) return;
    setSubmittingTask(true);
    try {
      const elapsed = getElapsedSeconds(runningTask);
      const duration = Math.max(1, Math.ceil(elapsed / 60));
      const expectedSeconds = getDurationSeconds(runningTask);
      const res = await api.post(`/child/tasks/${runningTask.id}/complete`, {
        duration,
        isOverdue: elapsed > expectedSeconds,
      });
      if (res.data?.chest) {
        playMagicSound();
        setChestReward(res.data.chest);
        if (res.data.chest.puzzleProgress) {
          setChestGuide(current => ({ ...current, puzzleProgress: res.data.chest.puzzleProgress }));
        }
        setChestStage('opening');
        setShowChestModal(true);
        window.setTimeout(() => setChestStage('revealed'), 950);
        toast.success(t('reward.taskSubmittedChestOpened'));
      } else {
        playSuccessSound();
        toast.success(t('reward.taskSubmittedPending'));
      }
      setShowConfetti(true);
      window.setTimeout(() => setShowConfetti(false), 3000);
      removeActiveTask(runningTask.id);
      refreshActiveTimerTasks();
      setRunningTask(null);
      setTimerMinimized(false);
      setTimerRunning(false);
      fetchData();
    } catch (e: any) {
      if (e.response?.data?.chestRetryRequired && e.response?.data?.entryId) {
        try {
          const retry = await api.post(`/child/task-entries/${e.response.data.entryId}/chest/retry`);
          if (retry.data?.chest) {
            playMagicSound();
            setChestReward(retry.data.chest);
            if (retry.data.chest.puzzleProgress) {
              setChestGuide(current => ({ ...current, puzzleProgress: retry.data.chest.puzzleProgress }));
            }
            setChestStage('revealed');
            setShowChestModal(true);
          }
          toast.success(t('reward.chestRetrySuccess'));
          if (runningTask) removeActiveTask(runningTask.id);
          refreshActiveTimerTasks();
          setRunningTask(null);
          setTimerMinimized(false);
          setTimerRunning(false);
          fetchData();
          return;
        } catch (retryError: any) {
          toast.error(retryError.response?.data?.message || t('reward.chestRetryFailed'));
          return;
        }
      }
      if (e.response?.status === 409) {
        if (runningTask) removeActiveTask(runningTask.id);
        refreshActiveTimerTasks();
        setRunningTask(null);
        setTimerMinimized(false);
        setTimerRunning(false);
        fetchData();
      }
      toast.error(e.response?.data?.message || '任务提交失败');
    } finally {
      setSubmittingTask(false);
    }
  };

  const refreshChestGuide = useCallback(async () => {
    try {
      const res = await api.get('/child/chest-prizes');
      setChestGuide({ prizes: res.data?.prizes || [], settings: res.data?.settings, note: res.data?.note, puzzleProgress: res.data?.puzzleProgress });
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    void refreshChestGuide();
  }, [refreshChestGuide]);

  const openChestGuide = async () => {
    const loaded = await refreshChestGuide();
    if (!loaded) {
      setChestGuide(current => ({ ...current, note: t('reward.chestGuideLoadFailed') }));
    }
    setShowChestGuide(true);
  };

  const abandonRunningTask = async () => {
    if (!runningTask) return;
    const elapsedMinutes = Math.max(1, Math.round(getElapsedSeconds(runningTask) / 60));
    const ok = await confirm({
      title: '放弃任务',
      message: `已经坚持了 ${elapsedMinutes} 分钟，真的要放弃吗？也可以先休息一下再继续`,
      type: 'warning',
      confirmText: '先放弃这次',
    });
    if (!ok) return;
    const taskId = runningTask.id;
    setRunningTask(null);
    setTimerMinimized(false);
    setTimerRunning(false);
    removeActiveTask(taskId);
    refreshActiveTimerTasks();
    try {
      await api.post(`/child/tasks/${taskId}/abandon`);
    } catch (e: any) {
      if (e.response?.status === 409) {
        toast.info(e.response?.data?.message || '任务已自动提交');
        fetchData();
      }
    }
  };

  const toggleRunningTimer = () => {
    if (!runningTask) return;
    setTaskTimerPaused(runningTask.id, timerRunning);
    setTimerRunning(!timerRunning);
    setTimerNow(Date.now());
  };

  const tasks: Task[] = dashboard?.tasks || [];
  const activeTaskIds = useMemo(() => new Set(activeTimerTasks.map(task => task.id)), [activeTimerTasks]);
  const isTaskRunning = (task: Task) => task.status === 'running' || activeTaskIds.has(task.id);
  const familyTasks = tasks.filter(task => task.taskType === 'family');
  const regularTasks = tasks.filter(task => task.taskType !== 'family');
  const openRegularTasks = regularTasks.filter(task => !isDone(task.status));
  const openFamilyTasks = familyTasks.filter(task => !isDone(task.status));
  const doneRegularTasks = regularTasks.length - openRegularTasks.length;
  const doneQuests = quests.filter(quest => quest.sessionStatus === 'approved').length;
  const openQuests = quests.filter(quest => quest.sessionStatus !== 'approved');
  const challengeTotal = regularTasks.length + quests.length + familyTasks.length;
  const challengeDone = doneRegularTasks + doneQuests + (familyTasks.length - openFamilyTasks.length);

  const getTaskTab = (task: Task): TabKey => {
    if (task.taskType === 'family') return 'family';
    return 'today';
  };

  const focusRunningTaskCard = (task: Task, openTimer = true) => {
    if (timerDragRef.current.moved) return;
    const tab = getTaskTab(task);
    const nonce = focusRequestNonceRef.current + 1;
    focusRequestNonceRef.current = nonce;
    setActiveTab(tab);
    setSelectedTask(null);
    if (!openTimer) {
      setRunningTask(null);
      setTimerMinimized(true);
    }
    setHighlightTaskId(task.id);
    setFocusRequest({ taskId: task.id, tab, nonce });
    if (openTimer) {
      window.setTimeout(() => openRunningTimer(task), 120);
    }

    window.setTimeout(() => {
      setHighlightTaskId(current => (current === task.id ? null : current));
    }, 2200);
  };

  const focusTaskCard = (task: Task, tab = getTaskTab(task), announce = true) => {
    const nonce = focusRequestNonceRef.current + 1;
    focusRequestNonceRef.current = nonce;
    setActiveTab(tab);
    setSelectedTask(null);
    setTaskListExpanded(true);
    setSelectedTaskCategory('全部');
    setHighlightTaskId(task.id);
    setFocusRequest({ taskId: task.id, tab, nonce });
    if (announce) toast.info('已帮你定位到推荐任务，准备好后再点任务卡开始');

    window.setTimeout(() => {
      setHighlightTaskId(current => (current === task.id ? null : current));
    }, 2600);
  };

  useEffect(() => {
    if (!focusRequest || activeTab !== focusRequest.tab) return;
    let cancelled = false;
    const delays = [0, 80, 180, 360];
    const timers = delays.map(delay => window.setTimeout(() => {
      if (cancelled) return;
      if (scrollTaskElementIntoChildViewport(focusRequest.taskId)) {
        setHighlightTaskId(focusRequest.taskId);
      }
    }, delay));
    return () => {
      cancelled = true;
      timers.forEach(timer => window.clearTimeout(timer));
    };
  }, [focusRequest, activeTab, tasks.length]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const targetTaskId = String(params.get('taskId') || '').trim();
    if (!freshDashboardReady || !targetTaskId) return;
    const intentKey = `${location.key}:${targetTaskId}`;
    if (handledTargetRef.current === intentKey) return;
    handledTargetRef.current = intentKey;

    const targetTask = tasks.find(task => task.id === targetTaskId);
    if (!targetTask || isDone(targetTask.status)) {
      toast.error(t('challenge.targetUnavailable'));
      params.delete('taskId');
      navigate({ pathname: location.pathname, search: params.toString() }, { replace: true, state: location.state });
      return;
    }

    if (isTaskRunning(targetTask)) {
      focusRunningTaskCard(targetTask, true);
      return;
    }
    if (Boolean((location.state as { startTask?: boolean } | null)?.startTask)) {
      void startTaskInChallenge(targetTask);
      return;
    }
    focusTaskCard(targetTask, getTaskTab(targetTask), false);
    setSelectedTask(targetTask);
  }, [freshDashboardReady, location.key, location.pathname, location.search, location.state, tasks]);

  useEffect(() => {
    if (!runningTask || tasks.length === 0) return;
    const latest = tasks.find(task => task.id === runningTask.id);
    if (latest && isDone(latest.status)) {
      removeActiveTask(runningTask.id);
      refreshActiveTimerTasks();
      setRunningTask(null);
      setTimerMinimized(false);
      setTimerRunning(false);
    }
  }, [tasks, runningTask]);

  const recommended = useMemo(() => {
    if (!dashboard) {
      return { title: '正在同步今天的下一步', tab: 'today' as TabKey, action: 'tab' as const };
    }
    // B3-6: 早晨时段（6-9点）推荐早晨流程
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 9 && openRegularTasks.length > 0) {
      const morningTask = openRegularTasks.find((t: Task) =>
        t.category === 'morning' || t.category === '早餐' || t.title?.includes('早晨') || t.title?.includes('早餐')
      );
      if (morningTask) {
        return { title: morningTask.title, tab: 'today' as TabKey, action: 'task' as const, task: morningTask };
      }
    }
    if (openRegularTasks[0]) {
      return { title: openRegularTasks[0].title, tab: 'today' as TabKey, action: 'task' as const, task: openRegularTasks[0] };
    }
    if (openQuests[0]) {
      return { title: '做一个学习小关卡', tab: 'learning' as TabKey, action: 'learning' as const };
    }
    if (openFamilyTasks[0]) {
      return { title: openFamilyTasks[0].title, tab: 'family' as TabKey, action: 'task' as const, task: openFamilyTasks[0] };
    }
    return { title: '去奖励页看看今天的收获', tab: 'today' as TabKey, action: 'tab' as const };
  }, [loading, dashboard, openRegularTasks, openQuests, openFamilyTasks]);

  const handleRecommendedClick = () => {
    if (recommended.action === 'task' && recommended.task) {
      focusTaskCard(recommended.task, recommended.tab);
      return;
    }
    if (recommended.action === 'learning') {
      setActiveTab('learning');
      return;
    }
    setActiveTab(recommended.tab);
  };

  const startLearningQuest = async (quest: Quest) => {
    if (quest.sessionStatus === 'pending') return toast.info('这个学习关卡已经提交，等待家长确认');
    if (quest.sessionStatus === 'approved') return toast.info('今天已经完成这个学习关卡啦');
    try {
      const res = await api.post(`/child/learning-quests/${quest.id}/start`);
      setActiveQuest(quest);
      setLearningSessionId(res.data.id);
      setLearningStepIndex(Math.min(Number(res.data.currentStepIndex || 0), Math.max(0, (quest.steps?.length || 1) - 1)));
      setStuckReason(res.data.stuckReason || '');
      setLearningProof('');
      setActiveTab('learning');
    } catch (e: any) {
      toast.error(e.response?.data?.message || '启动失败');
    }
  };

  const updateLearningProgress = async (nextIndex: number, reason?: string) => {
    if (!learningSessionId) return;
    await api.post(`/child/learning-sessions/${learningSessionId}/progress`, {
      currentStepIndex: nextIndex,
      stuckReason: reason || stuckReason || undefined,
    });
  };

  const completeLearningStep = async () => {
    if (!activeQuest || !currentLearningStep) return;
    const nextIndex = learningStepIndex + 1;
    if (nextIndex < (activeQuest.steps?.length || 0)) {
      setLearningStepIndex(nextIndex);
      setLearningRunning(false);
      await updateLearningProgress(nextIndex);
      toast.success('小关卡完成，继续下一关');
      return;
    }
    setLearningRunning(false);
    toast.success('所有小关卡完成，可以提交啦');
  };

  const chooseStuck = async (option: typeof STUCK_OPTIONS[0]) => {
    setStuckReason(option.label);
    setStuckHint(option.hint);
    try {
      await updateLearningProgress(learningStepIndex, option.label);
    } catch {
      toast.showToast('网络不太好，选择没保存上，可以再点一次', 'warning', 4000);
    }
  };

  const submitLearningQuest = async () => {
    if (!learningSessionId || !activeQuest) return;
    setLearningSubmitting(true);
    try {
      await api.post(`/child/learning-sessions/${learningSessionId}/submit`, { proof: learningProof, stuckReason });
      playSuccessSound();
      setShowConfetti(true);
      window.setTimeout(() => setShowConfetti(false), 3000);
      toast.success('学习关卡已提交，等待家长确认');
      setActiveQuest(null);
      setLearningSessionId('');
      setLearningProof('');
      setStuckReason('');
      setStuckHint('');
      await fetchData();
    } catch (e: any) {
      toast.error(e.response?.data?.message || '提交失败');
    } finally {
      setLearningSubmitting(false);
    }
  };

  const closeLearningRunner = () => {
    setActiveQuest(null);
    setLearningSessionId('');
    setLearningRunning(false);
    setLearningProof('');
    setStuckHint('');
  };

  const weeklyStats = dashboard?.weeklyStats || [];
  const totalWeeklyNet = weeklyStats.reduce((acc: number, cur: any) => acc + Number(cur.coins ?? 0), 0);
  const totalWeeklyEarned = weeklyStats.reduce((acc: number, cur: any) => acc + Number(cur.earned ?? cur.coins ?? 0), 0);
  const totalWeeklySpent = weeklyStats.reduce((acc: number, cur: any) => acc + Number(cur.spent ?? 0), 0);
  const maxWeeklyEarned = Math.max(...weeklyStats.map((day: any) => Number(day.earned ?? day.coins ?? 0)), 10);
  const selectedWeeklyEntry = weeklyStats.find((day: any) => day.date === selectedWeeklyDate) || weeklyStats[weeklyStats.length - 1] || null;

  const getFormattedDate = (dateStr?: string) => {
    if (!dateStr) return { day: '今天', date: '' };
    const date = new Date(`${dateStr}T00:00:00`);
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return { day: days[date.getDay()], date: `${date.getMonth() + 1}.${date.getDate()}` };
  };

  const handleTimerBarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    timerDragRef.current = {
      dragging: true,
      moved: false,
      offsetX: e.clientX - timerBarPosition.x,
      offsetY: e.clientY - timerBarPosition.y,
      startX: e.clientX,
      startY: e.clientY,
      lastPos: null,
    };
  };

  const handleTimerBarPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!timerDragRef.current.dragging) return;
    const distance = Math.abs(e.clientX - timerDragRef.current.startX) + Math.abs(e.clientY - timerDragRef.current.startY);
    if (distance > 8) {
      timerDragRef.current.moved = true;
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    }
    if (!timerDragRef.current.moved) return;
    // 拖动期间直接写 style，避免每次 move 触发整页重渲染导致卡顿；松手时再提交 state
    const pos = clampTimerBarPosition(
      e.clientX - timerDragRef.current.offsetX,
      e.clientY - timerDragRef.current.offsetY
    );
    timerDragRef.current.lastPos = pos;
    const el = e.currentTarget as HTMLElement;
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
  };

  const handleTimerBarPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    timerDragRef.current.dragging = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (timerDragRef.current.lastPos) setTimerBarPosition(timerDragRef.current.lastPos);
    window.setTimeout(() => {
      timerDragRef.current.moved = false;
    }, 0);
  };

  const minimizedTimerBar = activeTimerTasks.length > 0 && (!runningTask || timerMinimized) ? (
    <div
      className="pointer-events-auto absolute z-[80]"
      style={{
        left: timerBarPosition.x,
        top: timerBarPosition.y,
        width: getTimerBarWidth(),
        touchAction: 'none',
      }}
      onPointerDown={handleTimerBarPointerDown}
      onPointerMove={handleTimerBarPointerMove}
      onPointerUp={handleTimerBarPointerUp}
      onPointerCancel={handleTimerBarPointerUp}
    >
      <div className="rounded-2xl bg-slate-950 text-white shadow-2xl shadow-slate-900/30 cursor-grab active:cursor-grabbing overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-2 pt-1 text-[10px] font-black text-white/50">
          <span>{activeTimerTasks.length > 1 ? `${activeTimerTasks.length} 个挑战进行中` : '挑战进行中'}</span>
          {new URLSearchParams(location.search).get('from') === 'today' ? (
            <button
              type="button"
              data-testid="challenge-back-today-floating"
              onPointerDown={event => event.stopPropagation()}
              onClick={event => {
                event.stopPropagation();
                navigate('/child/today', { state: { refreshChildData: true } });
              }}
              className="min-h-11 rounded-xl px-2 text-xs font-black text-sky-200"
            >
              {t('challenge.backToToday')}
            </button>
          ) : (
            <span>点按定位 · 可拖动</span>
          )}
        </div>
        <div className="space-y-1 p-1.5 pt-0">
          {activeTimerTasks.map(task => (
            <button
              key={task.id}
              type="button"
              data-running-task-id={task.id}
              aria-label={`展开${task.title}计时器`}
              onClick={() => {
                focusRunningTaskCard(task, true);
              }}
              className="w-full rounded-xl bg-white/5 px-2 py-2 active:bg-white/10"
            >
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center text-lg flex-shrink-0">
                  {task.icon || '✅'}
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <div className="text-[10px] font-bold text-white/55 leading-tight">进行中</div>
                  <div className="text-sm font-black truncate leading-tight">{task.title}</div>
                </div>
                <div className={`font-mono text-sm font-black tabular-nums flex-shrink-0 ${getRemainingSeconds(task) < 0 ? 'text-rose-300' : 'text-white'}`}>
                  {formatRemainingTimer(task)}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  ) : null;

  const renderTaskList = (items: Task[], emptyText: string, options: { filterable?: boolean; collapsible?: boolean } = {}) => {
    const filterable = options.filterable ?? true;
    const collapsible = options.collapsible ?? true;
    const availableFilters = filterable
      ? TASK_CATEGORY_FILTERS.filter(filter => filter === '全部' || items.some(task => taskMatchesCategory(task.category, filter)))
      : [];
    const activeFilter = availableFilters.includes(selectedTaskCategory as any) ? selectedTaskCategory : '全部';
    const filteredItems = filterable ? items.filter(task => taskMatchesCategory(task.category, activeFilter)) : items;
    const visibleItems = collapsible && !taskListExpanded ? filteredItems.slice(0, 4) : filteredItems;
    const hiddenCount = Math.max(0, filteredItems.length - visibleItems.length);

    return (
    <div className="space-y-3">
      {filterable && items.length > 0 && (
        <div className="rounded-[1.5rem] bg-white border border-slate-100 p-2 shadow-sm">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {availableFilters.map(filter => {
              const count = filter === '全部'
                ? items.length
                : items.filter(task => taskMatchesCategory(task.category, filter)).length;
              const categoryInfo = filter === '全部' ? null : getTaskCategoryInfo(filter);
              const active = activeFilter === filter;
              return (
                <button
                  key={filter}
                  type="button"
                  onClick={() => {
                    setSelectedTaskCategory(filter);
                    setTaskListExpanded(false);
                  }}
                  className={`flex-shrink-0 rounded-full px-3 py-2 text-xs font-black border transition-colors ${
                    active
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-slate-50 text-slate-600 border-slate-100'
                  }`}
                >
                  {categoryInfo?.icon || '✨'} {filter}({count})
                </button>
              );
            })}
          </div>
        </div>
      )}

      {filteredItems.length === 0 ? (
        <div className="rounded-[1.75rem] bg-white border border-dashed border-slate-200 p-6 text-center text-slate-400 font-bold">
          {items.length === 0 ? emptyText : '这个分类下暂无任务。'}
        </div>
      ) : visibleItems.map(task => {
        const categoryInfo = getTaskCategoryInfo(task.category);
        const completionSummary = getTaskCompletionSummary(task);
        const displayStatus = isTaskRunning(task) ? 'running' : task.status;
        return (
        <button
          key={task.id}
          type="button"
          onClick={() => setSelectedTask(task)}
          data-challenge-task-id={task.id}
          className={`w-full rounded-[1.75rem] bg-white border p-4 shadow-sm active:scale-[0.99] text-left transition-all ${
            highlightTaskId === task.id
              ? 'border-blue-300 ring-4 ring-blue-100 bg-blue-50'
              : 'border-slate-100'
          }`}
        >
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center text-2xl">
              {task.icon || (task.taskType === 'family' ? '🏠' : '✅')}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="font-black text-slate-800 truncate">{task.title}</div>
                {task.isParallel ? <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 text-[10px] font-black">并行</span> : null}
              </div>
              <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-black text-slate-500">
                <span>{categoryInfo.icon}</span> {categoryInfo.label}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
                <span className="inline-flex items-center gap-1"><Clock size={13} />{task.durationMinutes || 0} 分钟</span>
                <span>+{task.coinReward || 0} 金币</span>
                <span>{t('growth.shortReward', { value: task.xpReward || 0 })}</span>
                {Number(task.gameTicketPreviewMinutes || 0) > 0 && (
                  <span>{t('challenge.gameTicketBadge', { minutes: Number(task.gameTicketPreviewMinutes) })}</span>
                )}
                {Boolean(task.gameTicketEarnBySpeed) && (
                  <span>{t('challenge.gameTicketSpeedBadge')}</span>
                )}
              </div>
              <div className="mt-1 text-[10px] font-black text-emerald-600">
                {completionSummary.label}：{completionSummary.targetText}
              </div>
            </div>
            <span className={`px-2.5 py-1 rounded-full text-[11px] font-black ${
              displayStatus === 'running'
                ? 'bg-blue-50 text-blue-600'
                : isDone(displayStatus)
                  ? 'bg-emerald-50 text-emerald-600'
                  : 'bg-amber-50 text-amber-600'
            }`}>
              {statusText(displayStatus)}
            </span>
          </div>
        </button>
        );
      })}

      {collapsible && filteredItems.length > 4 && (
        <button
          type="button"
          onClick={() => setTaskListExpanded(value => !value)}
          className="w-full rounded-2xl bg-white border border-slate-100 py-3 text-sm font-black text-slate-600 shadow-sm flex items-center justify-center gap-1"
        >
          <ChevronDown size={16} className={taskListExpanded ? 'rotate-180 transition-transform' : 'transition-transform'} />
          {taskListExpanded ? '收起任务' : `展开剩余 ${hiddenCount} 个任务`}
        </button>
      )}
    </div>
  );
  };

  const renderLearning = () => (
    <div className="space-y-3">
      {activeQuest ? (
        <div className="rounded-[1.75rem] bg-white border border-indigo-100 p-4 shadow-sm space-y-4">
          <button onClick={closeLearningRunner} className="text-xs font-black text-indigo-600">
            返回关卡列表
          </button>
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center text-3xl">{activeQuest.icon || '📚'}</div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-black text-indigo-500">{activeQuest.subject || '学习'} · {feelingLabel[activeQuest.feeling || 'normal'] || '学习关'}</div>
              <div className="font-black text-slate-900 truncate">{activeQuest.title}</div>
              <div className="text-xs font-bold text-slate-500 mt-0.5">{activeQuest.description || '先完成当前这一小步。'}</div>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs font-bold text-slate-500 mb-1">
              <span>进度 {learningStepIndex + 1}/{activeQuest.steps?.length || 1}</span>
              <span>{Math.round((learningStepIndex / Math.max(1, activeQuest.steps?.length || 1)) * 100)}%</span>
            </div>
            <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-sky-500 transition-all"
                style={{ width: `${Math.min(100, (learningStepIndex / Math.max(1, activeQuest.steps?.length || 1)) * 100)}%` }}
              />
            </div>
          </div>

          {currentLearningStep && (
            <div className="rounded-3xl bg-gradient-to-br from-indigo-600 to-sky-500 text-white p-4 text-center shadow-lg shadow-indigo-100">
              <div className="text-xs font-bold opacity-80">当前小关卡</div>
              <div className="mt-1 text-xl font-black">{currentLearningStep.title}</div>
              <div className="mt-2 text-5xl font-mono font-black tabular-nums">{formatLearningTimer(learningSecondsLeft)}</div>
              <div className="mt-2 text-xs opacity-90">{currentLearningStep.prompt || '只做当前这一小步，完成就很棒。'}</div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setLearningRunning(!learningRunning)}
              className="rounded-2xl bg-indigo-500 text-white py-3 font-black flex items-center justify-center gap-2"
            >
              {learningRunning ? <Clock size={18} /> : <Play size={18} />} {learningRunning ? '暂停' : '开始'}
            </button>
            <button
              type="button"
              onClick={completeLearningStep}
              className="rounded-2xl bg-emerald-500 text-white py-3 font-black flex items-center justify-center gap-2"
            >
              <CheckCircle2 size={18} /> {(learningStepIndex >= (activeQuest.steps?.length || 1) - 1) ? '完成最后一关' : '完成本关'}
            </button>
          </div>

          <div className="rounded-2xl bg-amber-50 border border-amber-100 p-3">
            <div className="flex items-center gap-2 text-sm font-black text-amber-700 mb-2"><HelpCircle size={16}/> 我卡住了</div>
            <div className="grid grid-cols-2 gap-2">
              {STUCK_OPTIONS.map(option => (
                <button
                  key={option.label}
                  onClick={() => chooseStuck(option)}
                  className={`py-2 rounded-xl text-xs font-bold border ${stuckReason === option.label ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-amber-700 border-amber-100'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {stuckHint && <div className="mt-2 text-xs text-amber-700 bg-white rounded-xl p-2">{stuckHint}</div>}
          </div>

          {learningStepIndex >= (activeQuest.steps?.length || 1) - 1 && (
            <div className="space-y-2">
              <textarea
                value={learningProof}
                onChange={e => setLearningProof(e.target.value)}
                className="w-full p-3 rounded-2xl border bg-slate-50 text-sm outline-none min-h-[76px]"
                placeholder="例如：完成第1-6题；背给妈妈听了；阅读到第20页。"
              />
              <button
                type="button"
                onClick={submitLearningQuest}
                disabled={learningSubmitting}
                className="w-full rounded-2xl bg-gradient-to-r from-yellow-400 to-orange-500 text-white py-3 font-black flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <Send size={18}/> {learningSubmitting ? '提交中...' : t('challenge.submitQuestReward', { coins: activeQuest.totalCoins || 0, growth: activeQuest.totalXp || 0 })}
              </button>
            </div>
          )}
        </div>
      ) : quests.length === 0 ? (
        <div className="rounded-[1.75rem] bg-white border border-dashed border-slate-200 p-6 text-center text-slate-400 font-bold">
          还没有学习关卡，家长可以先添加一个很小的关卡。
        </div>
      ) : quests.map((quest, index) => {
        const status = quest.sessionStatus;
        const done = status === 'approved';
        const pending = status === 'pending';
        const gradient = levelStyle[quest.resistanceLevel || 'medium'] || levelStyle.medium;
        return (
          <button
            key={quest.id}
            type="button"
            onClick={() => startLearningQuest(quest)}
            disabled={pending || done}
            className="w-full rounded-[1.75rem] bg-white border border-indigo-100 p-4 shadow-sm active:scale-[0.99] text-left disabled:opacity-75 relative overflow-hidden"
          >
            <div className={`absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b ${gradient}`} />
            <div className="flex items-start gap-3 pl-1">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-2xl">{quest.icon || '📚'}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 mb-1">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-black">第 {index + 1} 站</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 font-black">{feelingLabel[quest.feeling || 'normal'] || '学习关'}</span>
                </div>
                <div className="font-black text-slate-800 truncate">{quest.title}</div>
                <div className="mt-1 text-xs font-bold text-slate-500 truncate">
                  {quest.subject || '综合'} · {quest.steps?.length || 0}关 · 约 {quest.estimatedMinutes || 10} 分钟 · +{quest.totalCoins || 0} 金币
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-[11px] font-black ${done ? 'bg-emerald-50 text-emerald-600' : pending ? 'bg-orange-50 text-orange-600' : 'bg-indigo-50 text-indigo-600'}`}>
                {done ? '已完成' : pending ? '待确认' : status === 'in_progress' ? '继续' : '开始'}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );

  const getTaskGameTicketHint = (task: Task) => {
    const category = normalizeTaskCategory(task.category);
    if (category === '学习' && Number(task.durationMinutes || task.duration || 0) > 0 && Number(screenSummary?.rules?.studySavedTimeEnabled ?? 1) === 1) {
      return '高质量完成并节省的学习时间，会按家长设置兑换成今天的游戏票。';
    }
    return '';
  };

  const renderWeeklyCard = () => {
    if (!weeklyStats.length) return null;
    const selectedDateText = getFormattedDate(selectedWeeklyEntry?.date);
    const selectedEarned = Number(selectedWeeklyEntry?.earned ?? selectedWeeklyEntry?.coins ?? 0);
    const selectedSpent = Number(selectedWeeklyEntry?.spent ?? 0);
    const selectedNet = Number(selectedWeeklyEntry?.coins ?? selectedEarned - selectedSpent);
    return (
      <div className="mt-2 rounded-[1.35rem] bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white p-3 shadow-lg shadow-violet-100 overflow-hidden">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-black">本周收获</div>
            <div className="mt-1 text-xs font-bold text-white/75">收入 +{totalWeeklyEarned} · 消耗 -{totalWeeklySpent}</div>
          </div>
          <div className="text-right">
            <div className="text-xl font-black text-yellow-200">{formatSignedNumber(totalWeeklyNet)}</div>
            <div className="text-xs font-bold text-white/70">金币净值</div>
          </div>
        </div>
        <div className="mt-2 rounded-2xl bg-white/12 border border-white/15 px-3 py-1.5 flex items-center justify-between">
          <div className="text-xs font-black text-white/80">
            {selectedDateText.day} {selectedDateText.date}
          </div>
          <div className="text-sm font-black text-yellow-200">
            获得 {formatSignedNumber(selectedEarned)} <span className="text-white/70">· 净值 {formatSignedNumber(selectedNet)}</span>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-7 gap-1.5 items-end">
          {weeklyStats.map((day: any, index: number) => {
            const earned = Number(day.earned ?? day.coins ?? 0);
            const height = Math.max(10, Math.round((earned / maxWeeklyEarned) * 42));
            const { day: weekDay, date } = getFormattedDate(day.date);
            const isSelected = selectedWeeklyDate ? selectedWeeklyDate === day.date : index === weeklyStats.length - 1;
            return (
              <button
                key={`${day.date || day.label}`}
                type="button"
                onClick={() => setSelectedWeeklyDate(day.date)}
                className="text-center min-w-0 active:scale-95 transition-transform"
              >
                <div className="h-9 flex items-end justify-center">
                  <div
                    className={`w-3 rounded-t-md transition-all ${isSelected ? 'bg-yellow-200 shadow-lg shadow-yellow-200/25' : 'bg-white/30'}`}
                    style={{ height }}
                  />
                </div>
                <div className={`mt-1 text-[9px] font-black truncate ${isSelected ? 'text-yellow-200' : 'text-white/70'}`}>{weekDay}</div>
                <div className={`text-[9px] font-bold truncate ${isSelected ? 'text-white' : 'text-white/45'}`}>{date}</div>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // 低电量日视图：一条温和横幅 + 唯一推荐任务卡 + 冷静站入口，其余区块全部收起
  const renderLowEnergyDay = () => {
    const onlyTask = recommended.action === 'task' ? recommended.task : undefined;
    const onlyTaskStatus = onlyTask ? (isTaskRunning(onlyTask) ? 'running' : onlyTask.status) : undefined;
    return (
      <div className="space-y-3">
        <div className="rounded-[1.5rem] bg-sky-50 border border-sky-100 p-4">
          <div className="text-sm font-black text-sky-700 leading-relaxed">{t('lowEnergy.bannerText')}</div>
          <button
            type="button"
            onClick={() => toggleLowEnergy(false)}
            className="mt-1 min-h-[44px] px-2 -ml-2 text-xs font-black text-sky-500 flex items-center active:scale-95"
          >
            {t('lowEnergy.restore')}
          </button>
        </div>

        {onlyTask ? (
          <div className="rounded-[1.75rem] bg-white border border-slate-100 p-4 shadow-sm">
            <div className="text-[11px] font-black text-slate-400 mb-2">{t('lowEnergy.onlyTaskLabel')}</div>
            <button
              type="button"
              onClick={() => setSelectedTask(onlyTask)}
              data-challenge-task-id={onlyTask.id}
              className="w-full text-left active:scale-[0.99] transition-all"
            >
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center text-2xl">
                  {onlyTask.icon || '✅'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-black text-slate-800 truncate">{onlyTask.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <Clock size={13} />{onlyTask.durationMinutes || 0} {t('common.minutes')}
                    </span>
                    <span>+{onlyTask.coinReward || 0} {t('common.coins')}</span>
                  </div>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-[11px] font-black ${
                  onlyTaskStatus === 'running' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'
                }`}>
                  {statusText(onlyTaskStatus)}
                </span>
              </div>
            </button>
          </div>
        ) : (
          <div className="rounded-[1.75rem] bg-white border border-dashed border-slate-200 p-6 text-center text-slate-400 font-bold">
            {t('lowEnergy.noTask')}
          </div>
        )}

        <button
          type="button"
          onClick={() => navigate('/child/calm')}
          className="w-full min-h-[44px] rounded-2xl bg-white border border-indigo-100 py-3 text-sm font-black text-indigo-600 shadow-sm active:scale-[0.99]"
        >
          🧘 {t('lowEnergy.calmEntry')}
        </button>
      </div>
    );
  };

  return (
    <div className="min-h-full pb-24 bg-gradient-to-b from-violet-50 via-white to-cyan-50">
      <div className="p-4">
        {new URLSearchParams(location.search).get('from') === 'today' && (
          <button
            type="button"
            data-testid="challenge-back-today"
            onClick={() => navigate('/child/today', { state: { refreshChildData: true } })}
            className="relative z-[70] mb-3 flex min-h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 shadow-sm active:scale-[0.99]"
          >
            <ArrowLeft size={18} /> {t('challenge.backToToday')}
          </button>
        )}
        {lowEnergyToday ? renderLowEnergyDay() : (<>
        {weeklyReport && (
          <div className="mb-3 rounded-[1.35rem] bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200 p-3.5 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-black text-amber-700">
              <Star size={14} className="fill-amber-400 text-amber-400" /> {t('weekly.childBannerTitle')}
            </div>
            <p className={`mt-1.5 text-sm font-bold text-slate-700 leading-relaxed ${weeklyExpanded ? '' : 'line-clamp-2'}`}>
              {weeklyReport.childStory}
            </p>
            {weeklyExpanded ? (
              <button
                type="button"
                onClick={dismissWeeklyReport}
                className="mt-2.5 w-full min-h-[44px] rounded-2xl bg-amber-400 text-white py-2.5 font-black active:scale-[0.99]"
              >
                {t('weekly.gotIt')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setWeeklyExpanded(true)}
                className="mt-1 min-h-[44px] px-2 -ml-2 text-xs font-black text-amber-600 flex items-center"
              >
                {t('weekly.expand')}
              </button>
            )}
          </div>
        )}
        <div className="rounded-[1.5rem] bg-gradient-to-br from-violet-500 via-indigo-500 to-cyan-500 text-white p-3.5 shadow-lg shadow-indigo-100">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-black text-white/80">
              <Sparkles size={16} /> 挑战中心
            </div>
            <div className="rounded-full bg-white/18 px-3 py-1 text-xs font-black text-white">
              游戏票 {screenSummary?.balance ?? 0}/{screenSummary?.dailyMaxMinutes ?? 0}分
            </div>
          </div>
          <div className="mt-1 text-xl font-black">把今天拆成小关卡</div>
          <div className="mt-2 grid grid-cols-3 gap-1.5 text-[10px] font-black text-white/85">
            <div className="rounded-xl bg-white/14 px-2 py-1.5 text-center">基础 {screenSummary?.dailyBaseMinutes ?? 0}</div>
            <div className="rounded-xl bg-white/14 px-2 py-1.5 text-center">赚到 {screenSummary?.earnedMinutes ?? 0}</div>
            <div className="rounded-xl bg-white/14 px-2 py-1.5 text-center">已用 {screenSummary?.todayUsed ?? 0}</div>
          </div>
          <button
            type="button"
            onClick={() => toggleLowEnergy(true)}
            className="mt-1 ml-auto flex items-center min-h-[44px] px-2 -mr-2 -mb-2 text-[11px] font-black text-white/75 active:scale-95"
          >
            {t('lowEnergy.entryButton')}
          </button>
          <button
            type="button"
            onClick={handleRecommendedClick}
            className="mt-3 w-full rounded-2xl bg-white text-slate-900 px-4 py-3 flex items-center justify-between active:scale-[0.99]"
          >
            <span className="text-left min-w-0">
              <span className="block text-xs font-bold text-slate-400">推荐先做</span>
              <span className="block text-sm font-black truncate">{recommended.title}</span>
            </span>
            <Star size={18} className="text-amber-400 fill-amber-400 flex-shrink-0" />
          </button>
        </div>

        {renderWeeklyCard()}

        <div className="mt-2 rounded-[1.35rem] bg-white border border-slate-100 p-2.5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-black text-slate-800">
              <CheckCircle2 size={18} className="text-emerald-500" /> 今日待办
            </div>
            <div className="rounded-full bg-slate-50 px-3 py-1 text-xs font-black text-slate-500">
              已完成 <span className="text-blue-600">{challengeDone}</span> / {challengeTotal}
            </div>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {tabs.map(tab => {
              const tabStat = tab.key === 'today'
                ? { value: `${doneRegularTasks}/${regularTasks.length}`, tone: 'text-emerald-600 bg-emerald-50 border-emerald-100' }
                : tab.key === 'learning'
                  ? { value: `${doneQuests}/${quests.length}`, tone: 'text-indigo-600 bg-indigo-50 border-indigo-100' }
                  : { value: `${familyTasks.length - openFamilyTasks.length}/${familyTasks.length}`, tone: 'text-sky-600 bg-sky-50 border-sky-100' };
              const active = activeTab === tab.key;
              return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`min-h-[56px] rounded-2xl border flex flex-col items-center justify-center gap-0.5 text-[11px] font-black transition-all ${
                active ? 'bg-slate-900 text-white border-slate-900 shadow-sm' : tabStat.tone
              }`}
            >
              {tab.icon}
              {tab.label}
              <span className={`text-sm leading-tight ${active ? 'text-white' : 'text-slate-900'}`}>{tabStat.value}</span>
            </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={openChestGuide}
            className="mt-2 min-h-11 w-full rounded-2xl bg-amber-50 border border-amber-100 px-3 py-2 text-left text-xs font-black text-amber-800 flex items-center justify-between gap-2 active:scale-[0.99]"
          >
            <span className="flex items-center gap-2"><span className="text-lg" aria-hidden="true">🧩</span>{t('reward.puzzleProgressShort', { pieces: chestGuide.puzzleProgress?.pieces ?? '—', required: chestGuide.puzzleProgress?.required || 2 })}</span>
            <span className="text-[10px] text-amber-600">{t('reward.puzzleRule')}</span>
          </button>
        </div>

        <div className="mt-4">
          {loading ? (
            <div className="p-6 text-center text-slate-400 font-bold">挑战加载中...</div>
          ) : activeTab === 'today' ? (
            renderTaskList(regularTasks, '今天没有普通任务，可以去学习或奖励页看看。')
          ) : activeTab === 'learning' ? (
            renderLearning()
          ) : (
            renderTaskList(familyTasks, '今天没有全家任务。')
          )}
        </div>
        </>)}

      </div>

      <BottomSheet
        isOpen={Boolean(selectedTask)}
        onClose={() => setSelectedTask(null)}
        title={selectedTask ? `${selectedTask.icon || '✅'} ${selectedTask.title}` : '任务详情'}
        footer={
          selectedTask && !isDone(selectedTask.status) ? (
            <button
              type="button"
              onClick={() => isTaskRunning(selectedTask) ? openRunningTimer(selectedTask) : startTaskInChallenge(selectedTask)}
              disabled={submittingTask}
              className="w-full rounded-2xl bg-slate-900 text-white py-3 font-black flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-60"
            >
              <Play size={18} fill="currentColor" /> {isTaskRunning(selectedTask) ? '查看计时' : '开始挑战'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSelectedTask(null)}
              className="w-full rounded-2xl bg-slate-100 text-slate-600 py-3 font-black"
            >
              知道了
            </button>
          )
        }
      >
        {selectedTask && (() => {
          const categoryInfo = getTaskCategoryInfo(selectedTask.category);
          const completionSummary = getTaskCompletionSummary(selectedTask);
          const gameTicketHint = getTaskGameTicketHint(selectedTask);
          return (
            <div className="space-y-4">
              <div className="rounded-3xl bg-slate-50 border border-slate-100 p-4">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-white flex items-center justify-center text-3xl shadow-sm">
                    {selectedTask.icon || '✅'}
                  </div>
                  <div className="min-w-0">
                    <div className="font-black text-slate-800">{selectedTask.title}</div>
                    <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[11px] font-black text-slate-500">
                      {categoryInfo.icon} {categoryInfo.label}
                    </div>
                  </div>
                </div>
                <div className="mt-3 text-xs font-bold text-slate-500 leading-relaxed">{categoryInfo.childHint}</div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-2xl bg-white border border-slate-100 p-3 text-center">
                  <Clock size={16} className="mx-auto text-slate-400" />
                  <div className="mt-1 text-lg font-black text-slate-800">{completionSummary.targetText}</div>
                  <div className="text-[10px] font-bold text-slate-400">{completionSummary.label}</div>
                </div>
                <div className="rounded-2xl bg-amber-50 border border-amber-100 p-3 text-center">
                  <div className="text-lg">🪙</div>
                  <div className="text-lg font-black text-amber-600">+{selectedTask.coinReward || 0}</div>
                  <div className="text-[10px] font-bold text-amber-500">金币</div>
                </div>
                <div className="rounded-2xl bg-violet-50 border border-violet-100 p-3 text-center">
                  <Star size={16} className="mx-auto text-violet-500 fill-violet-500" />
                  <div className="mt-1 text-lg font-black text-violet-600">+{selectedTask.xpReward || 0}</div>
                  <div className="text-[10px] font-bold text-violet-500">{t('growth.shortLabel')}</div>
                </div>
              </div>
              {Number(selectedTask.gameTicketPreviewMinutes || 0) > 0 && (
                <div className="rounded-2xl bg-sky-50 border border-sky-100 p-3 text-xs text-sky-700 font-bold leading-relaxed">
                  {t('challenge.gameTicketDetail', { minutes: Number(selectedTask.gameTicketPreviewMinutes) })}
                </div>
              )}
              {Boolean(selectedTask.gameTicketEarnBySpeed) && (
                <div className="rounded-2xl bg-sky-50 border border-sky-100 p-3 text-xs text-sky-700 font-bold leading-relaxed">
                  {t('challenge.gameTicketSpeedDetail')}
                </div>
              )}
              <div className="rounded-2xl bg-blue-50 border border-blue-100 p-3 text-xs text-blue-700 font-bold leading-relaxed">
                {completionSummary.childHint} 完成后会提交给家长确认；任务完成时会立刻打开宝箱。
              </div>
              {gameTicketHint && (
                <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-3 text-xs text-emerald-700 font-bold leading-relaxed">
                  {gameTicketHint}
                </div>
              )}
              <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-3 text-xs text-emerald-700 font-bold leading-relaxed">
                家长会主要看：{getAlignedReviewFocus(selectedTask, completionSummary.reviewFocus)}
              </div>
            </div>
          );
        })()}
      </BottomSheet>

      <BottomSheet
        isOpen={Boolean(runningTask) && !timerMinimized}
        onClose={() => setTimerMinimized(true)}
        title={runningTask ? `正在挑战：${runningTask.title}` : '正在挑战'}
        footer={
          <div className="grid grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => setTimerMinimized(true)}
              className="rounded-2xl bg-slate-100 text-slate-700 py-3 font-black flex items-center justify-center gap-2"
            >
              <ChevronDown size={18} /> 最小化
            </button>
            <button
              type="button"
              onClick={toggleRunningTimer}
              className="rounded-2xl bg-slate-100 text-slate-700 py-3 font-black flex items-center justify-center gap-2"
            >
              {timerRunning ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
              {timerRunning ? '暂停' : '继续'}
            </button>
            <button
              type="button"
              onClick={submitRunningTask}
              disabled={submittingTask}
              className="rounded-2xl bg-emerald-500 text-white py-3 font-black flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <CheckCircle2 size={18} /> 完成提交
            </button>
          </div>
        }
      >
        {runningTask && (
          <div className="space-y-4 text-center">
            <div className="text-6xl">{runningTask.icon || '✅'}</div>
            <div className={`text-5xl font-mono font-black tabular-nums ${getRemainingSeconds(runningTask) < 0 ? 'text-rose-500' : 'text-slate-900'}`}>
              {formatRemainingTimer(runningTask)}
            </div>
            <div className="text-xs font-bold text-slate-500">
              {getTaskCompletionSummary(runningTask).mode === 'timer'
                ? `目标 ${getTaskCompletionSummary(runningTask).targetText}，做完就点“完成提交”。`
                : `${getTaskCompletionSummary(runningTask).label} ${getTaskCompletionSummary(runningTask).targetText}，时间只作记录。`}
              点空白或最小化不会取消任务。
            </div>
            <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-400 to-blue-500 transition-all"
                style={{ width: `${Math.min(100, (getElapsedSeconds(runningTask) / getDurationSeconds(runningTask)) * 100)}%` }}
              />
            </div>
            <button
              type="button"
              onClick={abandonRunningTask}
              className="mx-auto text-xs font-black text-rose-500 bg-rose-50 border border-rose-100 rounded-full px-3 py-1.5"
            >
              放弃这个任务
            </button>
            {/* M25: 本地静音视频，wakeLock 不可用时保持屏幕常亮 */}
            <video ref={wakeVideoRef} style={{ position: 'absolute', width: '1px', height: '1px', opacity: 0 }} loop muted playsInline src="/silence.mp4" />
          </div>
        )}
      </BottomSheet>

      {showChestModal && chestReward && createPortal(
        <div
          className="absolute inset-0 z-[100] bg-slate-950/65 backdrop-blur-sm pointer-events-auto flex items-center justify-center p-5"
          onClick={() => setShowChestModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-[2rem] bg-white p-6 text-center shadow-2xl animate-in zoom-in-95"
            onClick={event => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowChestModal(false)}
              className="ml-auto -mt-1 -mr-1 w-9 h-9 rounded-full bg-slate-50 text-slate-400 flex items-center justify-center"
              aria-label="关闭宝箱"
            >
              <X size={18} />
            </button>
            {chestStage === 'opening' ? (
              <div className="py-4">
                <div className="relative mx-auto w-28 h-28">
                  <div className="absolute inset-0 rounded-[2rem] bg-amber-300/30 animate-ping" />
                  <div className="relative w-28 h-28 rounded-[2rem] bg-gradient-to-br from-amber-100 via-yellow-100 to-orange-100 flex items-center justify-center text-6xl shadow-inner animate-bounce">
                    🎁
                  </div>
                  <div className="absolute -top-2 -right-1 text-2xl animate-pulse">✨</div>
                  <div className="absolute -bottom-1 -left-1 text-xl animate-pulse">⭐</div>
                </div>
                <div className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-amber-50 text-amber-600 px-3 py-1 text-xs font-black">
                  <Gift size={14} /> 即时宝箱
                </div>
                <h3 className="mt-3 text-2xl font-black text-slate-900">宝箱开启中...</h3>
                <p className="mt-2 text-sm font-bold text-slate-500">先摇一摇，看看今天的小惊喜是什么。</p>
                <div className="mt-5 h-2 rounded-full bg-amber-50 overflow-hidden">
                  <div className="h-full w-2/3 rounded-full bg-gradient-to-r from-amber-300 to-orange-500 animate-pulse" />
                </div>
              </div>
            ) : (
              <>
                <div className="mx-auto mt-1 w-20 h-20 rounded-[1.75rem] bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center text-5xl shadow-inner">
                  {chestReward.icon || '🎁'}
                </div>
                <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-amber-50 text-amber-600 px-3 py-1 text-xs font-black">
                  <Gift size={14} /> 即时宝箱
                </div>
                <h3 className="mt-3 text-2xl font-black text-slate-900">开出 {chestReward.name || '惊喜奖励'}</h3>
                <div className="mt-2 text-4xl font-black text-orange-500">
                  +{chestReward.value || 0}
                  <span className="ml-1 text-xl">
                    {chestReward.type === 'coins' ? '金币' :
                     chestReward.type === 'privilegePoints' ? t('growth.rightsPointUnit') :
                     chestReward.type === 'lotteryPuzzle' ? t('reward.puzzlePieceUnit') : '奖励'}
                  </span>
                </div>
                <p className="mt-3 text-sm font-bold text-slate-500 leading-relaxed">
                  {chestReward.type === 'lotteryPuzzle'
                    ? chestReward.lotteryTicketsCreated > 0
                      ? t('reward.puzzleCollected')
                      : t('reward.puzzleNeedMoreDetailed', { pieces: chestReward.puzzleProgress?.pieces || 0 })
                    : t('reward.chestCredited')}
                </p>
                <div className="mt-5 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={openChestGuide}
                    className="rounded-2xl bg-amber-50 border border-amber-100 py-3 text-amber-700 font-black active:scale-[0.99]"
                  >
                    看看宝箱里有啥
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowChestModal(false)}
                    className="rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 py-3 text-white font-black shadow-lg shadow-orange-100 active:scale-[0.99]"
                  >
                    收下奖励
                  </button>
                </div>
              </>
            )}
          </div>
        </div>,
        getChildOverlayRoot() || document.body
      )}

      {showChestGuide && createPortal(
        <div
          className="absolute inset-0 z-[110] bg-slate-950/55 backdrop-blur-sm pointer-events-auto flex items-center justify-center p-5"
          onClick={() => setShowChestGuide(false)}
        >
          <div
            className="w-full max-w-sm rounded-[2rem] bg-white p-5 shadow-2xl animate-in zoom-in-95 max-h-[78%] flex flex-col"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-black text-slate-900">宝箱里可能有什么？</h3>
                <p className="mt-1 text-xs font-bold text-slate-500">{t('reward.chestImmediateFeedback')}</p>
              </div>
              <button onClick={() => setShowChestGuide(false)} className="w-9 h-9 rounded-full bg-slate-50 text-slate-400 flex items-center justify-center">
                <X size={18} />
              </button>
            </div>
            <div className="mt-3 rounded-2xl bg-amber-50 border border-amber-100 p-3 text-xs font-bold text-amber-700">
              {chestGuide.note || '这里展示奖池内容，不展示概率，保留一点开奖惊喜。'}
              <div className="mt-2 rounded-xl bg-white/70 px-3 py-2 text-amber-800">
                {t('reward.puzzleProgressGuide', { pieces: chestGuide.puzzleProgress?.pieces || 0, required: chestGuide.puzzleProgress?.required || 2 })}
              </div>
            </div>
            <div className="mt-3 space-y-2 overflow-y-auto pr-1">
              {chestGuide.prizes.length === 0 ? (
                <div className="text-center py-8 text-sm font-bold text-slate-400">家长还没有配置宝箱奖品</div>
              ) : chestGuide.prizes.map(prize => {
                const rarity = getRarityMeta(prize.rarity);
                return (
                  <div key={prize.id} className="flex items-center gap-3 rounded-2xl bg-slate-50 border border-slate-100 p-3">
                    <div className="w-11 h-11 rounded-2xl bg-white flex items-center justify-center text-2xl shadow-sm">{prize.icon || '🎁'}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-black text-slate-800 truncate">{prize.name}</div>
                      <div className="text-xs font-bold text-slate-500 truncate">
                        {prize.type === 'coins' ? `${prize.value} 金币` :
                         prize.type === 'privilegePoints' ? `${prize.value} ${t('growth.rightsPointUnit')}` :
                         prize.type === 'lotteryTicket' ? t('reward.puzzlePrizeValue', { value: prize.value }) : prize.description || '神秘奖励'}
                      </div>
                    </div>
                    <span className={`rounded-full border px-2 py-1 text-[10px] font-black whitespace-nowrap ${rarity.className}`}>
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

      {minimizedTimerBar && (getChildOverlayRoot() ? createPortal(minimizedTimerBar, getChildOverlayRoot()!) : minimizedTimerBar)}
      <Confetti active={showConfetti} />
      <ConfirmDialog />
    </div>
  );
}
