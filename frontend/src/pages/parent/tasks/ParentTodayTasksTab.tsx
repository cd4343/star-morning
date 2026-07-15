import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CalendarCheck2, ChevronRight, Loader2, Pen } from 'lucide-react';
import api from '../../../services/api';
import { t } from '../../../i18n';
import type { TodayTask, TodayTaskPreviewResponse } from './types';

type ParentTodayTasksTabProps = {
  refreshKey: number;
  onCreateTask: () => void;
  onEditTask: (task: TodayTask) => void;
  onManageAll: () => void;
};

const statusStyle: Record<TodayTask['status'], string> = {
  todo: 'bg-amber-50 text-amber-700',
  running: 'bg-blue-50 text-blue-700',
  pending: 'bg-violet-50 text-violet-700',
  approved: 'bg-emerald-50 text-emerald-700',
  completed: 'bg-emerald-50 text-emerald-700',
};

const statusLabel: Record<TodayTask['status'], string> = {
  todo: 'parentTasks.status.todo',
  running: 'parentTasks.status.running',
  pending: 'parentTasks.status.pending',
  approved: 'parentTasks.status.completed',
  completed: 'parentTasks.status.completed',
};

export function ParentTodayTasksTab({
  refreshKey,
  onCreateTask,
  onEditTask,
  onManageAll,
}: ParentTodayTasksTabProps) {
  const [preview, setPreview] = useState<TodayTaskPreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const response = await api.get<TodayTaskPreviewResponse>('/parent/tasks/today-preview');
      setPreview(response.data);
    } catch (error) {
      console.error('加载今日任务预览失败:', error);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPreview();
  }, [loadPreview, refreshKey]);

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center rounded-3xl border border-slate-100 bg-white">
        <Loader2 className="animate-spin text-blue-600" size={24} aria-label={t('common.loading')} />
      </div>
    );
  }

  if (failed || !preview) {
    return (
      <div className="rounded-3xl border border-rose-100 bg-rose-50 p-5 text-center">
        <AlertCircle className="mx-auto text-rose-500" size={28} />
        <div className="mt-2 font-black text-slate-900">{t('parentTasks.today.loadFailed')}</div>
        <button
          type="button"
          onClick={loadPreview}
          className="mt-4 min-h-11 rounded-xl bg-slate-900 px-5 text-sm font-black text-white"
        >
          {t('common.retry')}
        </button>
      </div>
    );
  }

  const taskCount = preview.schedules.reduce((sum, schedule) => sum + schedule.tasks.length, 0);
  const completedCount = preview.schedules.reduce(
    (sum, schedule) => sum + schedule.tasks.filter(task => ['approved', 'completed'].includes(task.status)).length,
    0,
  );

  return (
    <section className="space-y-3" data-testid="parent-today-tasks">
      <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-blue-950 to-blue-800 p-5 text-white shadow-lg shadow-blue-900/10">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black tracking-[0.2em] text-blue-200">{t('parentTasks.today.eyebrow')}</div>
            <h2 className="mt-2 text-xl font-black">{t('parentTasks.today.title')}</h2>
            <p className="mt-1 text-xs font-bold leading-relaxed text-blue-100/80">{t('parentTasks.today.subtitle')}</p>
          </div>
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
            <CalendarCheck2 size={24} aria-hidden="true" />
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
            <div className="text-2xl font-black">{taskCount}</div>
            <div className="text-xs font-bold text-blue-100/80">{t('parentTasks.today.taskCount')}</div>
          </div>
          <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
            <div className="text-2xl font-black">{completedCount}</div>
            <div className="text-xs font-bold text-blue-100/80">{t('parentTasks.today.completedCount')}</div>
          </div>
        </div>
      </div>

      {preview.schedules.length === 0 ? (
        <EmptyState
          title={t('parentTasks.today.noChildren')}
          description={t('parentTasks.today.noChildrenHint')}
          actionLabel={t('parentTasks.today.manageFamily')}
          onAction={onManageAll}
        />
      ) : taskCount === 0 ? (
        <EmptyState
          title={preview.configuredTaskCount === 0
            ? t('parentTasks.today.noConfigured')
            : t('parentTasks.today.noScheduled')}
          description={preview.configuredTaskCount === 0
            ? t('parentTasks.today.noConfiguredHint')
            : t('parentTasks.today.noScheduledHint')}
          actionLabel={preview.configuredTaskCount === 0
            ? t('parentTasks.today.createTask')
            : t('parentTasks.today.manageAll')}
          onAction={preview.configuredTaskCount === 0 ? onCreateTask : onManageAll}
        />
      ) : (
        preview.schedules.map(schedule => (
          <div key={schedule.childId} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-xs font-black text-blue-600">{t('parentTasks.today.childSchedule')}</div>
                <h3 className="mt-0.5 text-lg font-black text-slate-900">{schedule.childName}</h3>
              </div>
              <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                {t('parentTasks.today.items', { count: schedule.tasks.length })}
              </div>
            </div>
            <div className="space-y-2">
              {schedule.tasks.map(task => (
                <article key={task.id} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-xl shadow-sm">
                    {task.icon || '📋'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-black text-slate-900">{task.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-slate-500">
                      <span>💰 {task.coinReward}</span>
                      <span>⭐ {task.xpReward}</span>
                      <span>⏱ {task.durationMinutes}{t('parentTasks.minutes')}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className={`rounded-full px-2 py-1 text-[10px] font-black ${statusStyle[task.status] || statusStyle.todo}`}>
                      {t(statusLabel[task.status] || statusLabel.todo)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onEditTask(task)}
                      className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-blue-600 active:bg-blue-50"
                      aria-label={t('parentTasks.editTask', { title: task.title })}
                    >
                      <Pen size={17} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ))
      )}

      <button
        type="button"
        onClick={onManageAll}
        className="flex min-h-12 w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 active:bg-slate-50"
      >
        {t('parentTasks.today.manageAll')}
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </section>
  );
}

function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-6 text-center">
      <div className="text-4xl">📋</div>
      <h3 className="mt-3 font-black text-slate-900">{title}</h3>
      <p className="mx-auto mt-1 max-w-xs text-xs font-bold leading-relaxed text-slate-500">{description}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-4 min-h-11 rounded-xl bg-blue-600 px-5 text-sm font-black text-white shadow-sm shadow-blue-600/20"
      >
        {actionLabel}
      </button>
    </div>
  );
}
