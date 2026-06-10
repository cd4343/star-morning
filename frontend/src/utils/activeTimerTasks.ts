// 「挑战进行中」浮窗的共享工具：跨页面读取计时任务与浮窗定位。
// ⚠️ 存储键与 pages/child/ChildChallenge.tsx 内的本地实现保持一致（该页后续整合时合并为单一来源）。

export const ACTIVE_TASKS_KEY = 'stellar_active_tasks_v2';
export const getTaskDataKey = (id: string) => `stellar_task_data_${id}`;

export type StoredTimerTask = {
  id: string;
  title?: string;
  icon?: string;
  duration?: number;
  durationMinutes?: number;
  sessionStartedAt?: string;
};

export type Bounds = { left: number; top: number; right: number; bottom: number; width: number; height: number };

const getBeijingDateKeyFromMs = (timestamp: number) => {
  const date = new Date(timestamp + 8 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
};

const getTodayBeijingDateKey = () => getBeijingDateKeyFromMs(Date.now());

export const getStoredTaskTimer = (taskId: string) => {
  try {
    return JSON.parse(localStorage.getItem(getTaskDataKey(taskId)) || 'null');
  } catch {
    return null;
  }
};

export const getStoredActiveTasks = (): StoredTimerTask[] => {
  try {
    const todayKey = getTodayBeijingDateKey();
    const parsed = JSON.parse(localStorage.getItem(ACTIVE_TASKS_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((task: any) => {
      const timer = task?.id ? getStoredTaskTimer(task.id) : null;
      const startTime = Number(timer?.startTime || (task?.sessionStartedAt ? new Date(task.sessionStartedAt).getTime() : 0));
      const taskDate = timer?.startedDate || (Number.isFinite(startTime) && startTime > 0 ? getBeijingDateKeyFromMs(startTime) : todayKey);
      return taskDate === todayKey;
    });
  } catch {
    return [];
  }
};

export const getTaskElapsedSeconds = (taskId: string) => {
  const data = getStoredTaskTimer(taskId);
  if (!data?.startTime) return 0;
  const now = Date.now();
  let elapsed = Math.floor((now - Number(data.startTime)) / 1000) - Math.floor(Number(data.pausedDuration || 0) / 1000);
  if (data.pauseStartTime) elapsed -= Math.floor((now - Number(data.pauseStartTime)) / 1000);
  return Math.max(0, elapsed);
};

export const getTaskRemainingSeconds = (task: StoredTimerTask) => {
  const durationSeconds = Math.max(1, Number(task.durationMinutes ?? task.duration ?? 1) * 60);
  return durationSeconds - getTaskElapsedSeconds(task.id);
};

export const formatRemainingTimer = (task: StoredTimerTask) => {
  const remaining = getTaskRemainingSeconds(task);
  const value = Math.abs(remaining);
  const minutes = Math.floor(value / 60).toString().padStart(2, '0');
  const rest = (value % 60).toString().padStart(2, '0');
  return remaining < 0 ? `-${minutes}:${rest}` : `${minutes}:${rest}`;
};

export const getChildMainBounds = (): Bounds => {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return { left: 0, top: 0, right: 390, bottom: 720, width: 390, height: 720 };
  }
  const viewport = document.querySelector('[data-child-main-viewport="true"]') as HTMLElement | null;
  const frame = document.querySelector('[data-child-app-frame="true"]') as HTMLElement | null;
  const rect = (viewport || frame)?.getBoundingClientRect();
  if (rect) {
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  }
  return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight };
};

export const getChildFrameBounds = (): Bounds => {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return { left: 0, top: 0, right: 390, bottom: 720, width: 390, height: 720 };
  }
  const frame = document.querySelector('[data-child-app-frame="true"]') as HTMLElement | null;
  const rect = frame?.getBoundingClientRect();
  if (rect) {
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  }
  return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight };
};

export const getChildOverlayRoot = () => (
  typeof document === 'undefined'
    ? null
    : document.querySelector('[data-child-overlay-root="true"]') as HTMLElement | null
);

export const getTimerBarWidth = () => Math.min(260, Math.max(190, getChildMainBounds().width * 0.55));

export const getDefaultTimerBarPosition = () => {
  const bounds = getChildMainBounds();
  const frame = getChildFrameBounds();
  return { x: bounds.left - frame.left + 12, y: bounds.top - frame.top + 8 };
};

export const clampTimerBarPosition = (x: number, y: number) => {
  const main = getChildMainBounds();
  const frame = getChildFrameBounds();
  const width = getTimerBarWidth();
  const minX = Math.max(8, main.left - frame.left + 8);
  const maxX = Math.max(minX, frame.width - width - 8);
  const minY = Math.max(8, main.top - frame.top + 6);
  const maxY = Math.max(minY, frame.height - 84);
  return { x: Math.min(maxX, Math.max(minX, x)), y: Math.min(maxY, Math.max(minY, y)) };
};
