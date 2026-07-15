import {
  BookOpen,
  Brain,
  ClipboardList,
  Compass,
  Crown,
  Gift,
  HeartPulse,
  Lock,
  Trophy,
  Users,
  Utensils,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { t } from '../../../i18n';

const groups = [
  {
    titleKey: 'parentWorkspace.tools.daily',
    tone: 'bg-blue-50 text-blue-700',
    items: [
      ['/parent/tasks', ClipboardList, 'parentWorkspace.tools.tasks'],
      ['/parent/learning', BookOpen, 'parentWorkspace.tools.learning'],
      ['/parent/morning', Utensils, 'parentWorkspace.tools.morning'],
    ],
  },
  {
    titleKey: 'parentWorkspace.tools.support',
    tone: 'bg-emerald-50 text-emerald-700',
    items: [
      ['/parent/wellbeing', HeartPulse, 'parentWorkspace.tools.wellbeing'],
      ['/parent/rules-insights', Brain, 'parentWorkspace.tools.insights'],
      ['/parent/explore', Compass, 'parentWorkspace.tools.explore'],
    ],
  },
  {
    titleKey: 'parentWorkspace.tools.rewards',
    tone: 'bg-amber-50 text-amber-700',
    items: [
      ['/parent/wishes', Gift, 'parentWorkspace.tools.wishes'],
      ['/parent/privileges', Crown, 'parentWorkspace.tools.privileges'],
      ['/parent/achievements', Trophy, 'parentWorkspace.tools.achievements'],
      ['/parent/punishment', Lock, 'parentWorkspace.tools.punishment'],
    ],
  },
  {
    titleKey: 'parentWorkspace.tools.family',
    tone: 'bg-violet-50 text-violet-700',
    items: [['/parent/family', Users, 'parentWorkspace.tools.familyManagement']],
  },
] as const;

export function ParentToolsTab() {
  const navigate = useNavigate();
  return (
    <div className="space-y-4" data-testid="parent-tools-tab">
      <section className="rounded-3xl bg-[#e8f5ff] p-5 ring-1 ring-blue-100">
        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-blue-700">{t('parentWorkspace.tools.eyebrow')}</div>
        <h2 className="mt-1 text-2xl font-black text-slate-900">{t('parentWorkspace.tools.title')}</h2>
        <p className="mt-1 text-sm font-medium text-slate-600">{t('parentWorkspace.tools.subtitle')}</p>
      </section>
      {groups.map(group => (
        <section key={group.titleKey} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-black text-slate-800">{t(group.titleKey)}</h3>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {group.items.map(([path, Icon, labelKey]) => (
              <button
                key={path}
                type="button"
                onClick={() => navigate(path)}
                data-testid={`parent-tool-${path.split('/').slice(-1)[0]}`}
                className="flex min-h-[72px] items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-3 text-left transition-transform active:scale-[0.98]"
              >
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${group.tone}`}>
                  <Icon size={20} aria-hidden="true" />
                </span>
                <span className="text-sm font-black leading-tight text-slate-700">{t(labelKey)}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
