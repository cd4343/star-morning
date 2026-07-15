import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, CheckSquare, Clock, Coins, Gamepad2, Sparkles, Star, Utensils } from 'lucide-react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { BottomSheet } from '../../components/BottomSheet';
import { t } from '../../i18n';
import { getTaskCategoryInfo } from '../../utils/taskCategories';
import { getTaskCompletionSummary } from '../../utils/taskCompletion';
import type { TodayTask } from '../../utils/todayPriority';
import { BreakfastKitchenContent } from './ChildMorning';

type TodayContext = {
  tasks?: TodayTask[];
  refresh?: () => Promise<void>;
};

type TodayTab = 'tasks' | 'breakfast';
type TodayFilter = 'all' | 'todo' | 'pending' | 'completed';

const getTaskGroup = (task: TodayTask): Exclude<TodayFilter, 'all'> => {
  if (task.status === 'pending') return 'pending';
  if (task.status === 'approved' || task.status === 'completed') return 'completed';
  return 'todo';
};

const getTaskStatus = (task: TodayTask) => {
  if (task.status === 'running') return { label: t('today.statusRunning'), badge: 'bg-blue-100 text-blue-700' };
  if (task.status === 'pending') return { label: t('today.statusPending'), badge: 'bg-amber-100 text-amber-700' };
  if (task.status === 'approved' || task.status === 'completed') return { label: t('today.statusCompleted'), badge: 'bg-emerald-100 text-emerald-700' };
  if (task.status === 'rejected') return { label: t('today.statusRejected'), badge: 'bg-rose-100 text-rose-700' };
  return { label: t('today.statusTodo'), badge: 'bg-slate-100 text-slate-600' };
};

const isTaskActionable = (task: TodayTask) => !['pending', 'approved', 'completed'].includes(String(task.status || ''));

export default function ChildToday() {
  const navigate = useNavigate();
  const { tasks = [], refresh } = useOutletContext<TodayContext>();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: TodayTab = searchParams.get('tab') === 'breakfast' ? 'breakfast' : 'tasks';
  const [filter, setFilter] = useState<TodayFilter>('all');
  const [selectedTask, setSelectedTask] = useState<TodayTask | null>(null);

  useEffect(() => {
    const refreshToday = () => { void refresh?.().catch(() => undefined); };
    refreshToday();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refreshToday();
    };
    window.addEventListener('focus', refreshToday);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', refreshToday);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refresh]);

  const sortedTasks = useMemo(() => tasks
    .map((task, index) => ({ task, index }))
    .sort((left, right) => {
      const groupRank = { todo: 0, pending: 1, completed: 2 };
      const groupDiff = groupRank[getTaskGroup(left.task)] - groupRank[getTaskGroup(right.task)];
      if (groupDiff !== 0) return groupDiff;
      if (left.task.status === 'running' && right.task.status !== 'running') return -1;
      if (right.task.status === 'running' && left.task.status !== 'running') return 1;
      return left.index - right.index;
    })
    .map(item => item.task), [tasks]);

  const counts = useMemo(() => ({
    all: sortedTasks.length,
    todo: sortedTasks.filter(task => getTaskGroup(task) === 'todo').length,
    pending: sortedTasks.filter(task => getTaskGroup(task) === 'pending').length,
    completed: sortedTasks.filter(task => getTaskGroup(task) === 'completed').length,
  }), [sortedTasks]);

  const visibleTasks = useMemo(
    () => filter === 'all' ? sortedTasks : sortedTasks.filter(task => getTaskGroup(task) === filter),
    [filter, sortedTasks],
  );

  const switchTab = (nextTab: TodayTab) => {
    setSelectedTask(null);
    if (nextTab === 'tasks') setFilter('all');
    setSearchParams(nextTab === 'breakfast' ? { tab: 'breakfast' } : {}, { replace: true });
  };

  const openChallenge = (task: TodayTask) => {
    const params = new URLSearchParams();
    params.set('tab', task.taskType === 'family' ? 'family' : 'today');
    params.set('taskId', task.id);
    params.set('from', 'today');
    navigate(`/child/challenge?${params.toString()}`, { state: { fromToday: true } });
  };

  return (
    <div className="min-h-full space-y-4 bg-gradient-to-b from-blue-50 via-white to-amber-50 p-4 pb-28" data-testid="child-today">
      <section className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-100 bg-white p-1.5 shadow-sm" aria-label={t('today.sectionTabs')}>
        <button
          type="button"
          data-testid="today-tab-tasks"
          aria-pressed={activeTab === 'tasks'}
          onClick={() => switchTab('tasks')}
          className={`flex min-h-12 items-center justify-center gap-2 rounded-xl text-sm font-black ${activeTab === 'tasks' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500'}`}
        >
          <CheckSquare size={18} /> {t('today.tasksTab')}
        </button>
        <button
          type="button"
          data-testid="today-tab-breakfast"
          aria-pressed={activeTab === 'breakfast'}
          onClick={() => switchTab('breakfast')}
          className={`flex min-h-12 items-center justify-center gap-2 rounded-xl text-sm font-black ${activeTab === 'breakfast' ? 'bg-orange-500 text-white shadow-sm' : 'text-slate-500'}`}
        >
          <Utensils size={18} /> {t('today.breakfastTab')}
        </button>
      </section>

      {activeTab === 'tasks' ? (
        <>
          <section className="grid grid-cols-4 gap-2" aria-label={t('today.statusFilters')}>
            {(['all', 'todo', 'pending', 'completed'] as TodayFilter[]).map(key => (
              <button
                type="button"
                key={key}
                data-testid={`today-filter-${key}`}
                aria-pressed={filter === key}
                onClick={() => { setFilter(key); setSelectedTask(null); }}
                className={`min-h-12 rounded-2xl px-1 text-xs font-black ${filter === key ? 'bg-slate-900 text-white shadow-sm' : 'border border-slate-100 bg-white text-slate-600'}`}
              >
                <span className="block">{t(`today.filter.${key}`)}</span>
                <span className={`mt-0.5 block text-[10px] ${filter === key ? 'text-white/70' : 'text-slate-400'}`}>{counts[key]}</span>
              </button>
            ))}
          </section>

          {visibleTasks.length > 0 ? (
            <section className="space-y-3" data-testid="today-task-list">
              {visibleTasks.map(task => {
                const category = getTaskCategoryInfo(task.category);
                const status = getTaskStatus(task);
                return (
                  <button
                    type="button"
                    key={task.id}
                    data-testid={`today-task-${task.id}`}
                    onClick={() => setSelectedTask(task)}
                    className="flex min-h-[92px] w-full items-center gap-3 rounded-3xl border border-slate-100 bg-white p-4 text-left shadow-sm active:scale-[0.99]"
                  >
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-3xl">{task.icon || '📋'}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="line-clamp-2 font-black leading-5 text-slate-900">{task.title}</span>
                        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${status.badge}`}>{status.label}</span>
                      </span>
                      <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold text-slate-500">
                        <span>{category.icon} {category.label}</span>
                        <span><Clock size={12} className="mr-1 inline" />{t('today.minutes', { minutes: task.durationMinutes || 1 })}</span>
                        <span className="text-amber-600"><Coins size={12} className="mr-1 inline" />+{task.coinReward || 0}</span>
                      </span>
                    </span>
                    <ArrowRight size={18} className="shrink-0 text-slate-300" />
                  </button>
                );
              })}
            </section>
          ) : (
            <section className="rounded-3xl border border-slate-100 bg-white p-7 text-center" data-testid="today-empty">
              <CheckCircle2 size={38} className="mx-auto text-emerald-500" />
              <h2 className="mt-3 font-black text-slate-800">{t('today.emptyFilterTitle')}</h2>
              <p className="mt-1 text-sm font-medium text-slate-500">{t('today.emptyFilterDescription')}</p>
            </section>
          )}
        </>
      ) : (
        <BreakfastKitchenContent embedded />
      )}

      <BottomSheet
        isOpen={Boolean(selectedTask)}
        onClose={() => setSelectedTask(null)}
        title={selectedTask ? `${selectedTask.icon || '✅'} ${selectedTask.title}` : t('today.detailTitle')}
        footer={selectedTask && isTaskActionable(selectedTask) ? (
          <button
            type="button"
            onClick={() => openChallenge(selectedTask)}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 font-black text-white active:scale-[0.99]"
          >
            <ArrowRight size={18} />
            {selectedTask.status === 'running' ? t('today.continueTimer') : t('today.startChallenge')}
          </button>
        ) : undefined}
      >
        {selectedTask && (() => {
          const completion = getTaskCompletionSummary(selectedTask);
          const category = getTaskCategoryInfo(selectedTask.category);
          return (
            <div className="space-y-4" data-testid="today-task-details">
              <div className="rounded-3xl border border-slate-100 bg-slate-50 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white text-3xl shadow-sm">
                    {selectedTask.icon || '✅'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-lg font-black text-slate-900">{selectedTask.title}</div>
                    <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs font-black text-slate-500">
                      {category.icon} {category.label}
                    </div>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-2xl border border-slate-100 bg-white p-3 text-center">
                  <Clock size={17} className="mx-auto text-slate-400" />
                  <div className="mt-1 font-black text-slate-800">{completion.targetText}</div>
                  <div className="text-[10px] font-bold text-slate-400">{completion.label}</div>
                </div>
                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3 text-center">
                  <Coins size={17} className="mx-auto text-amber-500" />
                  <div className="mt-1 font-black text-amber-700">+{selectedTask.coinReward || 0}</div>
                  <div className="text-[10px] font-bold text-amber-500">{t('today.coinLabel')}</div>
                </div>
                <div className="rounded-2xl border border-violet-100 bg-violet-50 p-3 text-center">
                  <Star size={17} className="mx-auto fill-violet-500 text-violet-500" />
                  <div className="mt-1 font-black text-violet-700">+{selectedTask.xpReward || 0}</div>
                  <div className="text-[10px] font-bold text-violet-500">{t('today.growthLabel')}</div>
                </div>
              </div>
              {Number(selectedTask.gameTicketPreviewMinutes || 0) > 0 && (
                <div className="flex items-start gap-2 rounded-2xl border border-sky-100 bg-sky-50 p-3 text-sm font-bold text-sky-700">
                  <Gamepad2 size={18} className="mt-0.5 shrink-0" />
                  {t('today.gameTicket', { minutes: Number(selectedTask.gameTicketPreviewMinutes) })}
                </div>
              )}
              {Boolean(selectedTask.gameTicketEarnBySpeed) && (
                <div className="flex items-start gap-2 rounded-2xl border border-sky-100 bg-sky-50 p-3 text-sm font-bold text-sky-700">
                  <Gamepad2 size={18} className="mt-0.5 shrink-0" />
                  {t('today.gameTicketSpeed')}
                </div>
              )}
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-sm font-bold leading-relaxed text-blue-700">
                <Sparkles size={17} className="mr-1 inline" />
                {completion.childHint}
              </div>
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-sm font-bold leading-relaxed text-emerald-700">
                {t('today.reviewFocus', { focus: String(selectedTask.reviewFocus || completion.reviewFocus) })}
              </div>
            </div>
          );
        })()}
      </BottomSheet>
    </div>
  );
}
