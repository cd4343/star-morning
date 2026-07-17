import { useEffect, useRef, useState } from 'react';
import type { ExploreDiscoveryResult, ExplorePlannerRequest, ParentExploreIntentSettings } from '../../types/explore';
import { useExploreDiscovery } from '../../hooks/useExploreDiscovery';
import ExplorePlannerForm from './ExplorePlannerForm';
import ExplorePlannerResults from './ExplorePlannerResults';

type Props = {
  settings: ParentExploreIntentSettings | null;
  initialCity: string;
  onAdd: (item: ExploreDiscoveryResult) => Promise<void>;
  onRecommend: (item: ExploreDiscoveryResult) => Promise<void>;
};

export default function ParentExploreDiscovery({ settings, initialCity, onAdd, onRecommend }: Props) {
  const discovery = useExploreDiscovery();
  const [searched, setSearched] = useState(false);
  const [pendingAction, setPendingAction] = useState('');
  const [completedActions, setCompletedActions] = useState<Set<string>>(new Set());
  const actionLocks = useRef(new Set<string>());

  useEffect(() => {
    discovery.setDraft(current => ({
      ...current,
      city: current.city || initialCity,
      childId: current.childId || settings?.children[0]?.id,
      experienceKeys: current.childId ? current.experienceKeys : (settings?.children[0]?.selections?.length ? settings.children[0].selections.slice(0, 2) : current.experienceKeys),
    }));
  }, [initialCity, settings]);

  const change = (patch: Partial<ExplorePlannerRequest>) => discovery.setDraft(current => ({ ...current, ...patch }));
  const search = async () => { await discovery.search(); setSearched(true); };
  const runAction = async (item: ExploreDiscoveryResult, kind: 'add' | 'recommend') => {
    const key = `${item.id}:${kind}`;
    if (actionLocks.current.has(key) || completedActions.has(key)) return;
    actionLocks.current.add(key);
    setPendingAction(key);
    try {
      await (kind === 'add' ? onAdd(item) : onRecommend(item));
      setCompletedActions(current => new Set(current).add(key));
    } finally {
      actionLocks.current.delete(key);
      setPendingAction('');
    }
  };
  const adjust = async (code: string) => {
    const next = { ...discovery.draft };
    if (code === 'remove_budget') next.budgetMax = undefined;
    if (code === 'expand_district') next.districtScope = [];
    if (code === 'remove_indoor') next.indoorPreference = 'any';
    if (code === 'change_experience') next.experienceKeys = ['any'];
    discovery.setDraft(next);
    await discovery.search(next);
    setSearched(true);
  };

  return <div className="space-y-4">
    <ExplorePlannerForm
      draft={discovery.draft}
      children={settings?.children || []}
      groups={settings?.groups || []}
      parsed={discovery.parsed}
      loading={discovery.loading}
      onChange={change}
      onPreview={discovery.preview}
      onSearch={search}
    />
    <ExplorePlannerResults
      results={discovery.results}
      searched={searched}
      partial={discovery.partial}
      error={discovery.error}
      adjustments={discovery.adjustments}
      pendingAction={pendingAction}
      completedActions={completedActions}
      onAdd={item => runAction(item, 'add')}
      onRecommend={item => runAction(item, 'recommend')}
      onAdjust={adjust}
    />
  </div>;
}
