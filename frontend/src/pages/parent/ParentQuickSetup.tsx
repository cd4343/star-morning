import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Layout } from '../../components/Layout';
import { useToast } from '../../components/Toast';
import { t } from '../../i18n';
import api, { getErrorMessage } from '../../services/api';
import type { ChildAgeBand, FocusArea, ProductSetupResponse, QuickSetupInput } from '../../types/productConfig';
import type { EconomyDraft, EconomySettingsResponse } from '../../types/economy';
import { EconomyModeSelector } from '../../components/EconomySettingsPanel';

const DEFAULT_INPUT: QuickSetupInput = {
  childAgeBand: '9-10',
  focusAreas: ['morning', 'homework'],
  dailyCoreActions: 2,
  weeklyRewardBudgetRmb: 30,
  screenTimeCapMinutes: 45,
};

const AGE_OPTIONS: Array<{ value: ChildAgeBand; labelKey: string }> = [
  { value: '6-8', labelKey: 'quickSetup.age6to8' },
  { value: '9-10', labelKey: 'quickSetup.age9to10' },
  { value: '11-12', labelKey: 'quickSetup.age11to12' },
];

const FOCUS_OPTIONS: Array<{ value: FocusArea; labelKey: string; descriptionKey: string; icon: string }> = [
  { value: 'morning', labelKey: 'quickSetup.focusMorning', descriptionKey: 'quickSetup.focusMorningDesc', icon: '🌤️' },
  { value: 'homework', labelKey: 'quickSetup.focusHomework', descriptionKey: 'quickSetup.focusHomeworkDesc', icon: '📚' },
  { value: 'self_care', labelKey: 'quickSetup.focusSelfCare', descriptionKey: 'quickSetup.focusSelfCareDesc', icon: '🎒' },
  { value: 'housework', labelKey: 'quickSetup.focusHousework', descriptionKey: 'quickSetup.focusHouseworkDesc', icon: '🧹' },
  { value: 'outdoor', labelKey: 'quickSetup.focusOutdoor', descriptionKey: 'quickSetup.focusOutdoorDesc', icon: '🌳' },
];

const STEP_KEYS = [
  'quickSetup.stepAge',
  'quickSetup.stepFocus',
  'quickSetup.stepActions',
  'quickSetup.stepBudget',
  'quickSetup.stepScreenTime',
];

export default function ParentQuickSetup() {
  const navigate = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [input, setInput] = useState<QuickSetupInput>(DEFAULT_INPUT);
  const [economy, setEconomy] = useState<EconomyDraft>({ coinPerRmb: 10, dailyCoinTarget: 30 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      api.get<ProductSetupResponse>('/parent/product-setup'),
      api.get<EconomySettingsResponse>('/parent/economy-settings'),
    ])
      .then(([productResult, economyResult]) => {
        if (!active) return;
        if (productResult.status === 'fulfilled') {
          setInput(productResult.value.data.settings || productResult.value.data.defaults || DEFAULT_INPUT);
        } else {
          toast.error(getErrorMessage(productResult.reason) || t('quickSetup.loadError'));
        }
        if (economyResult.status === 'fulfilled') {
          setEconomy(economyResult.value.data.settings || { coinPerRmb: 10, dailyCoinTarget: 30 });
        } else {
          toast.error(getErrorMessage(economyResult.reason) || t('quickSetup.loadError'));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [toast]);

  const selectedFocusLabels = useMemo(
    () => FOCUS_OPTIONS.filter(option => input.focusAreas.includes(option.value)).map(option => t(option.labelKey)),
    [input.focusAreas]
  );

  const toggleFocus = (value: FocusArea) => {
    setInput(current => {
      const selected = current.focusAreas.includes(value);
      if (selected) {
        if (current.focusAreas.length === 1) return current;
        return { ...current, focusAreas: current.focusAreas.filter(item => item !== value) };
      }
      if (current.focusAreas.length >= 2) return current;
      return { ...current, focusAreas: [...current.focusAreas, value] };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // 先保存每日金币目标，再按同一目标生成新家庭任务，避免两个并发请求产生不同口径。
      await api.put('/parent/economy-settings', economy);
      await api.post('/parent/product-setup/quick', input);
      toast.success(t('quickSetup.saveSuccess'));
      navigate('/parent/dashboard', { replace: true });
    } catch (error) {
      toast.error(getErrorMessage(error) || t('quickSetup.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const renderStep = () => {
    if (step === 0) {
      return (
        <OptionGrid title={t('quickSetup.ageTitle')} description={t('quickSetup.ageDescription')}>
          {AGE_OPTIONS.map(option => (
            <ChoiceButton
              key={option.value}
              selected={input.childAgeBand === option.value}
              onClick={() => setInput(current => ({ ...current, childAgeBand: option.value }))}
              label={t(option.labelKey)}
            />
          ))}
        </OptionGrid>
      );
    }

    if (step === 1) {
      return (
        <OptionGrid title={t('quickSetup.focusTitle')} description={t('quickSetup.focusDescription')}>
          {FOCUS_OPTIONS.map(option => (
            <ChoiceButton
              key={option.value}
              selected={input.focusAreas.includes(option.value)}
              onClick={() => toggleFocus(option.value)}
              label={`${option.icon} ${t(option.labelKey)}`}
              description={t(option.descriptionKey)}
            />
          ))}
        </OptionGrid>
      );
    }

    if (step === 2) {
      return (
        <OptionGrid title={t('quickSetup.actionsTitle')} description={t('quickSetup.actionsDescription')}>
          {([1, 2, 3] as const).map(value => (
            <ChoiceButton
              key={value}
              selected={input.dailyCoreActions === value}
              onClick={() => setInput(current => ({ ...current, dailyCoreActions: value }))}
              label={t('quickSetup.actionsCount', { count: value })}
            />
          ))}
        </OptionGrid>
      );
    }

    if (step === 3) {
      return (
        <div className="space-y-6">
          <OptionGrid title={t('quickSetup.budgetTitle')} description={t('quickSetup.budgetDescription')}>
            {[0, 20, 30, 50].map(value => (
              <ChoiceButton
                key={value}
                selected={input.weeklyRewardBudgetRmb === value}
                onClick={() => setInput(current => ({ ...current, weeklyRewardBudgetRmb: value }))}
                label={value === 0 ? t('quickSetup.budgetVirtual') : t('quickSetup.budgetAmount', { amount: value })}
              />
            ))}
          </OptionGrid>
          <div className="rounded-3xl border border-blue-100 bg-blue-50 p-4">
            <EconomyModeSelector value={economy} onChange={setEconomy} compact />
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-5">
        <OptionGrid title={t('quickSetup.screenTitle')} description={t('quickSetup.screenDescription')}>
          {[0, 30, 45, 60, 90].map(value => (
            <ChoiceButton
              key={value}
              selected={input.screenTimeCapMinutes === value}
              onClick={() => setInput(current => ({ ...current, screenTimeCapMinutes: value }))}
              label={value === 0 ? t('quickSetup.screenOff') : t('quickSetup.screenMinutes', { minutes: value })}
            />
          ))}
        </OptionGrid>
        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4" data-testid="quick-setup-summary">
          <div className="mb-3 flex items-center gap-2 font-black text-blue-900">
            <Sparkles size={18} /> {t('quickSetup.summaryTitle')}
          </div>
          <ul className="space-y-2 text-sm text-blue-800">
            <li>{t('quickSetup.summaryFocus', { focus: selectedFocusLabels.join('、') })}</li>
            <li>{t('quickSetup.summaryTasks', { count: Math.min(input.dailyCoreActions, input.focusAreas.length) })}</li>
            <li>{t('quickSetup.summaryRewards')}</li>
            <li>{t('quickSetup.summaryEditable')}</li>
          </ul>
        </div>
      </div>
    );
  };

  if (loading) {
    return <Layout><div className="flex flex-1 items-center justify-center text-sm text-gray-500">{t('common.loading')}</div></Layout>;
  }

  return (
    <Layout enableSwipeBack={false}>
      <div className="flex min-h-0 flex-1 flex-col bg-white" data-testid="parent-quick-setup">
        <header className="border-b border-gray-100 px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => step > 0 ? setStep(value => value - 1) : navigate('/parent/dashboard')}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-gray-600 active:bg-gray-100"
              aria-label={t('common.back')}
            >
              <ChevronLeft size={24} />
            </button>
            <span className="text-sm font-bold text-gray-500">{t('quickSetup.progress', { current: step + 1, total: STEP_KEYS.length })}</span>
            <div className="h-11 w-11" />
          </div>
          <div className="grid grid-cols-5 gap-1" role="progressbar" aria-valuemin={1} aria-valuemax={STEP_KEYS.length} aria-valuenow={step + 1}>
            {STEP_KEYS.map((key, index) => (
              <span key={key} className={`h-2 rounded-full ${index <= step ? 'bg-blue-500' : 'bg-gray-100'}`} />
            ))}
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
          <p className="mb-2 text-xs font-black uppercase tracking-wider text-blue-500">{t(STEP_KEYS[step])}</p>
          {renderStep()}
        </main>

        <footer className="border-t border-gray-100 bg-white px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          {step < STEP_KEYS.length - 1 ? (
            <Button fullWidth size="lg" onClick={() => setStep(value => value + 1)} data-testid="quick-setup-next">
              {t('quickSetup.next')} <ChevronRight size={20} className="ml-2" />
            </Button>
          ) : (
            <Button fullWidth size="lg" loading={saving} onClick={handleSave} data-testid="quick-setup-submit">
              <Check size={20} className="mr-2" /> {t('quickSetup.finish')}
            </Button>
          )}
        </footer>
      </div>
    </Layout>
  );
}

function OptionGrid({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section>
      <h1 className="text-2xl font-black text-gray-900">{title}</h1>
      <p className="mb-5 mt-2 text-sm leading-6 text-gray-500">{description}</p>
      <div className="grid grid-cols-1 gap-3">{children}</div>
    </section>
  );
}

function ChoiceButton({ selected, onClick, label, description }: { selected: boolean; onClick: () => void; label: string; description?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex min-h-14 w-full items-center justify-between rounded-2xl border-2 px-4 py-3 text-left transition-colors ${selected ? 'border-blue-500 bg-blue-50 text-blue-900' : 'border-gray-100 bg-gray-50 text-gray-700'}`}
    >
      <span>
        <span className="block font-black">{label}</span>
        {description && <span className="mt-1 block text-xs font-medium text-gray-500">{description}</span>}
      </span>
      {selected && <Check size={20} className="shrink-0 text-blue-600" />}
    </button>
  );
}
