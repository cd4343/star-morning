import { getSystemAchievementByKey } from './growthIdentityCatalog';

export type AchievementDisplayFields = {
  systemKey: string | null;
  isSystem: boolean;
  displayTitleKey: string | null;
  displayDescriptionKey: string | null;
  displayTitle: string;
  displayDescription: string;
  iconKey: string | null;
  displayIcon: string;
  category: string;
};

export const buildAchievementDisplayFields = (achievement: any): AchievementDisplayFields => {
  const systemKey = String(achievement?.system_key || achievement?.systemKey || '').trim();
  const isSystem = Boolean(systemKey) && Number(achievement?.is_system ?? achievement?.isSystem ?? 0) === 1;
  const catalogItem = isSystem ? getSystemAchievementByKey(systemKey) : undefined;

  if (catalogItem) {
    return {
      systemKey: catalogItem.systemKey,
      isSystem: true,
      displayTitleKey: catalogItem.displayTitleKey,
      displayDescriptionKey: catalogItem.displayDescriptionKey,
      displayTitle: catalogItem.title,
      displayDescription: catalogItem.description,
      iconKey: catalogItem.iconKey,
      displayIcon: String(achievement?.icon || '🎖️'),
      category: catalogItem.category,
    };
  }

  return {
    systemKey: systemKey || null,
    isSystem,
    displayTitleKey: null,
    displayDescriptionKey: null,
    displayTitle: String(achievement?.title || ''),
    displayDescription: String(achievement?.description || ''),
    iconKey: null,
    displayIcon: String(achievement?.icon || '🎖️'),
    category: String(achievement?.category || '其他'),
  };
};

export const hasSystemAchievementIdentityChanged = (stored: any, incoming: any) => {
  const sameText = (field: string) => (
    incoming?.[field] === undefined || String(incoming[field] ?? '') === String(stored?.[field] ?? '')
  );
  return !sameText('title') ||
    !sameText('description') ||
    !sameText('icon') ||
    !sameText('conditionType') ||
    (incoming?.conditionValue !== undefined && Number(incoming.conditionValue) !== Number(stored?.conditionValue || 0)) ||
    !sameText('conditionCategory') ||
    !sameText('category');
};
