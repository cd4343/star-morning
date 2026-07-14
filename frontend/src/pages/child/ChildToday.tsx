import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, Clock, Coins, Gamepad2, Sparkles, Star, Utensils } from 'lucide-react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { BottomSheet } from '../../components/BottomSheet';
import { t } from '../../i18n';
import api from '../../services/api';
import { getTaskCategoryInfo } from '../../utils/taskCategories';
import { getTaskCompletionSummary } from '../../utils/taskCompletion';
import { selectPrimaryTodayTask, sortTodayTasks, type TodayTask } from '../../utils/todayPriority';

type TodayContext = {
  tasks?: TodayTask[];
  refresh?: () => Promise<void>;
};

export default function ChildToday() {
  const navigate = useNavigate();
  const { tasks = [], refresh } = useOutletContext<TodayContext>();
  const [breakfastOrdered, setBreakfastOrdered] = useState<boolean | null>(null);
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

  useEffect(() => {
    let active = true;
    api.get('/child/morning')
      .then(response => { if (active) setBreakfastOrdered(Boolean(response.data?.order)); })
      .catch(() => { if (active) setBreakfastOrdered(null); });
    return () => { active = false; };
  }, []);

  const sortedTasks = useMemo(() => sortTodayTasks(tasks), [tasks]);
  const primary = useMemo(() => selectPrimaryTodayTask(tasks), [tasks]);
  const laterTasks = primary ? sortedTasks.filter(task => task.id !== primary.id).slice(0, 2) : [];

  const openPrimary = () => {
    if (primary) setSelectedTask(primary);
    else if (breakfastOrdered === false) navigate('/child/morning');
  };

  const openChallenge = (task: TodayTask) => {
    const params = new URLSearchParams();
    params.set('tab', task.taskType === 'family' ? 'family' : 'today');
    params.set('taskId', task.id);
    params.set('from', 'today');
    navigate(`/child/challenge?${params.toString()}`, { state: { fromToday: true } });
  };

  const hasPrimaryAction = Boolean(primary || breakfastOrdered === false);

  return (
    <div className="min-h-full space-y-4 bg-gradient-to-b from-blue-50 via-white to-amber-50 p-4 pb-28" data-testid="child-today">
      <section className="rounded-3xl bg-gradient-to-br from-blue-600 to-indigo-600 p-5 text-white shadow-lg shadow-blue-100">
        <p className="text-sm font-bold text-blue-100">{t('today.eyebrow')}</p>
        <h1 className="mt-1 text-2xl font-black">{t('today.title')}</h1>
        <p className="mt-2 text-sm font-medium leading-6 text-blue-100">{t('today.description')}</p>
      </section>

      {hasPrimaryAction ? (
        <section className="rounded-3xl border border-blue-100 bg-white p-5 shadow-sm" data-testid="today-primary-action">
          <p className="text-xs font-black uppercase tracking-wider text-blue-500">
            {primary?.status === 'running' ? t('today.continueNow') : t('today.startNow')}
          </p>
          <div className="mt-3 flex items-start gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-3xl">
              {primary?.icon || (breakfastOrdered === false ? '🍽️' : '✨')}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-black text-gray-900">
                {primary?.title || t('today.chooseBreakfast')}
              </h2>
              {primary && (
                <div className="mt-2 flex flex-wrap gap-3 text-xs font-bold text-gray-500">
                  <span className="flex items-center gap-1"><Clock size={14} /> {t('today.minutes', { minutes: primary.durationMinutes || 1 })}</span>
                  <span className="flex items-center gap-1"><Coins size={14} /> {t('today.coins', { coins: primary.coinReward || 0 })}</span>
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={openPrimary}
            className="mt-5 flex min-h-12 w-full items-center justify-center rounded-2xl bg-gray-900 px-4 font-black text-white active:scale-[0.99]"
          >
            {primary ? t('today.detailsAction') : t('today.beginAction')}
            <ArrowRight size={18} className="ml-2" />
          </button>
        </section>
      ) : (
        <section className="rounded-3xl border border-emerald-100 bg-emerald-50 p-6 text-center" data-testid="today-empty">
          <CheckCircle2 size={42} className="mx-auto text-emerald-500" />
          <h2 className="mt-3 text-xl font-black text-emerald-900">{t('today.doneTitle')}</h2>
          <p className="mt-2 text-sm text-emerald-700">{t('today.doneDescription')}</p>
        </section>
      )}

      <button
        type="button"
        onClick={() => navigate('/child/morning')}
        className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-amber-100 bg-white px-4 text-left shadow-sm"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><Utensils size={22} /></span>
        <span className="min-w-0 flex-1">
          <span className="block font-black text-gray-900">{t('today.breakfastTitle')}</span>
          <span className="block text-xs font-medium text-gray-500">
            {breakfastOrdered ? t('today.breakfastReady') : t('today.breakfastPending')}
          </span>
        </span>
        <ArrowRight size={18} className="text-gray-400" />
      </button>

      {laterTasks.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-black text-gray-700">{t('today.laterTitle')}</h2>
          <div className="space-y-2">
            {laterTasks.map(task => (
              <button
                type="button"
                key={task.id}
                onClick={() => setSelectedTask(task)}
                className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-gray-100 bg-white px-4 text-left"
              >
                <span className="text-2xl">{task.icon || '📋'}</span>
                <span className="min-w-0 flex-1 line-clamp-2 font-bold text-gray-800">{task.title}</span>
                <ArrowRight size={17} className="text-gray-300" />
              </button>
            ))}
          </div>
        </section>
      )}

      <BottomSheet
        isOpen={Boolean(selectedTask)}
        onClose={() => setSelectedTask(null)}
        title={selectedTask ? `${selectedTask.icon || '✅'} ${selectedTask.title}` : t('today.detailTitle')}
        footer={selectedTask ? (
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
