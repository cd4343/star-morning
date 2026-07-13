import type { Database } from 'sqlite';
import { buildAchievementDisplayFields } from './achievementDisplay';
import { GROWTH_COSMETIC_BY_KEY, GROWTH_COSMETIC_CATALOG, type CosmeticType } from './growthCosmeticCatalog';
import { getLevelIdentityFromXp } from './levelIdentity';

export class GrowthIdentityError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message); }
}

type CustomizationInput = {
  childId?: unknown;
  familyId?: unknown;
  avatarKey?: unknown;
  frameKey?: unknown;
  themeKey?: unknown;
  titleKey?: unknown;
  featuredAchievementIds?: unknown;
};

const beijingTimestamp = (date = new Date()) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(date);

const parseIds = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string');
  if (typeof value !== 'string') return [];
  try { return parseIds(JSON.parse(value)); } catch { return []; }
};

const getChildContext = async (db: Database, childId: string, familyId: string, syncUnlocks: boolean) => {
  const child = await db.get('SELECT id, familyId, name, avatar, xp FROM users WHERE id = ? AND familyId = ? AND role = ?', childId, familyId, 'child');
  if (!child) throw new GrowthIdentityError(403, 'growth_identity_forbidden', '不能访问其他孩子或家庭的成长身份');

  const levelIdentity = getLevelIdentityFromXp(child.xp);
  const achievements = await db.all(`
    SELECT ad.*, ua.unlockedAt
      FROM user_achievements ua
      JOIN achievement_defs ad ON ad.id = ua.achievementId
     WHERE ua.childId = ? AND ad.familyId = ?
     ORDER BY ua.unlockedAt DESC, ad.id
  `, childId, familyId);
  const achievementSystemKeys = new Set(achievements.map(item => String(item.system_key || '')).filter(Boolean));
  const storedUnlocks = new Set((await db.all(
    'SELECT cosmetic_key FROM user_cosmetic_unlocks WHERE child_id = ?', childId,
  )).map(item => String(item.cosmetic_key)));

  const derivedKeys = new Set(GROWTH_COSMETIC_CATALOG.filter(item => (
    item.sourceType === 'default' ||
    (item.sourceType === 'level' && levelIdentity.level >= Number(item.requiredLevel || 1)) ||
    (item.sourceType === 'achievement' && achievementSystemKeys.has(String(item.sourceKey || '')))
  )).map(item => item.key));
  const availableKeys = new Set([...derivedKeys, ...storedUnlocks].filter(key => GROWTH_COSMETIC_BY_KEY.has(key)));

  if (syncUnlocks) {
    const timestamp = beijingTimestamp();
    for (const key of derivedKeys) {
      const item = GROWTH_COSMETIC_BY_KEY.get(key)!;
      if (item.sourceType === 'default') continue;
      await db.run(
        `INSERT OR IGNORE INTO user_cosmetic_unlocks (child_id, cosmetic_key, source_type, source_key, unlocked_at)
         VALUES (?, ?, ?, ?, ?)`,
        childId, item.key, item.sourceType, item.sourceKey || null, timestamp,
      );
    }
  }

  return { child, levelIdentity, achievements, availableKeys };
};

const resolveKey = (
  value: unknown,
  type: CosmeticType,
  availableKeys: Set<string>,
  fallback: string | null,
) => {
  if (value === null || value === undefined || value === '') return fallback;
  const key = String(value);
  const definition = GROWTH_COSMETIC_BY_KEY.get(key);
  if (!definition || definition.type !== type) {
    throw new GrowthIdentityError(400, 'invalid_cosmetic_key', '装扮不存在或类型不正确');
  }
  if (!availableKeys.has(key)) {
    throw new GrowthIdentityError(409, 'cosmetic_not_unlocked', '这个装扮还没有解锁');
  }
  return key;
};

export const getGrowthIdentity = async (db: Database, childId: string, familyId: string) => {
  const context = await getChildContext(db, childId, familyId, true);
  const profile = await db.get('SELECT * FROM user_profile_customization WHERE child_id = ?', childId);
  const unlockedAchievementIds = new Set(context.achievements.map(item => String(item.id)));
  const featuredAchievementIds = [...new Set(parseIds(profile?.featured_achievement_ids))]
    .filter(id => unlockedAchievementIds.has(id)).slice(0, 3);
  const stage = context.levelIdentity.stage;

  const safeSelection = (key: unknown, type: CosmeticType, fallback: string | null) => {
    const value = typeof key === 'string' ? key : '';
    const definition = GROWTH_COSMETIC_BY_KEY.get(value);
    return definition?.type === type && context.availableKeys.has(value) ? value : fallback;
  };

  return {
    child: { id: context.child.id, name: context.child.name, familyAvatar: context.child.avatar || null },
    levelIdentity: context.levelIdentity,
    selected: {
      avatarKey: safeSelection(profile?.avatar_key, 'avatar', 'avatar.current'),
      frameKey: safeSelection(profile?.frame_key, 'frame', stage.defaultFrameKey),
      themeKey: safeSelection(profile?.theme_key, 'theme', null),
      titleKey: safeSelection(profile?.title_key, 'title', `title.stage.${stage.key}`),
      featuredAchievementIds,
    },
    cosmetics: GROWTH_COSMETIC_CATALOG.map(item => ({ ...item, unlocked: context.availableKeys.has(item.key) })),
    unlockedAchievements: context.achievements.map(item => ({ id: item.id, ...buildAchievementDisplayFields(item) })),
  };
};

export const updateProfileCustomization = async (
  db: Database,
  childId: string,
  familyId: string,
  input: CustomizationInput,
) => {
  if (input.childId !== undefined && String(input.childId) !== childId) {
    throw new GrowthIdentityError(403, 'cosmetic_child_forbidden', '不能修改其他孩子的装扮');
  }
  if (input.familyId !== undefined && String(input.familyId) !== familyId) {
    throw new GrowthIdentityError(403, 'cosmetic_family_forbidden', '不能修改其他家庭的装扮');
  }

  const current = await getGrowthIdentity(db, childId, familyId);
  const availableKeys = new Set(current.cosmetics.filter(item => item.unlocked).map(item => item.key));
  const selected = {
    avatarKey: resolveKey(input.avatarKey ?? current.selected.avatarKey, 'avatar', availableKeys, 'avatar.current'),
    frameKey: resolveKey(input.frameKey ?? current.selected.frameKey, 'frame', availableKeys, current.levelIdentity.stage.defaultFrameKey),
    themeKey: resolveKey(input.themeKey ?? current.selected.themeKey, 'theme', availableKeys, null),
    titleKey: resolveKey(input.titleKey ?? current.selected.titleKey, 'title', availableKeys, `title.stage.${current.levelIdentity.stage.key}`),
  };
  const featured = input.featuredAchievementIds === undefined
    ? current.selected.featuredAchievementIds
    : parseIds(input.featuredAchievementIds);
  if (input.featuredAchievementIds !== undefined && (
    !Array.isArray(input.featuredAchievementIds) ||
    input.featuredAchievementIds.some(item => typeof item !== 'string')
  )) {
    throw new GrowthIdentityError(400, 'invalid_featured_achievements', '精选成就必须是数组');
  }
  if (featured.length > 3 || new Set(featured).size !== featured.length) {
    throw new GrowthIdentityError(400, 'invalid_featured_achievements', '精选成就最多 3 个且不能重复');
  }
  const ownedIds = new Set(current.unlockedAchievements.map(item => String(item.id)));
  if (featured.some(id => !ownedIds.has(id))) {
    throw new GrowthIdentityError(403, 'achievement_not_owned', '只能展示自己已解锁的成就');
  }

  await db.run('BEGIN');
  try {
    await db.run(`
      INSERT INTO user_profile_customization
        (child_id, avatar_key, frame_key, theme_key, title_key, featured_achievement_ids, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(child_id) DO UPDATE SET
        avatar_key = excluded.avatar_key,
        frame_key = excluded.frame_key,
        theme_key = excluded.theme_key,
        title_key = excluded.title_key,
        featured_achievement_ids = excluded.featured_achievement_ids,
        updated_at = excluded.updated_at
    `, childId, selected.avatarKey, selected.frameKey, selected.themeKey, selected.titleKey, JSON.stringify(featured), beijingTimestamp());
    await db.run('COMMIT');
  } catch (error) {
    try { await db.run('ROLLBACK'); } catch { /* Preserve the write error. */ }
    throw error;
  }
  return getGrowthIdentity(db, childId, familyId);
};
