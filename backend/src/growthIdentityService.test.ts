import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { describe, expect, it } from 'vitest';
import { ensureGrowthCosmeticSchema } from './growthCosmeticSchema';
import { getGrowthIdentity, updateProfileCustomization } from './growthIdentityService';

const createDb = async () => {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.run('PRAGMA foreign_keys = ON');
  await db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, familyId TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, avatar TEXT, coins INTEGER DEFAULT 0, xp INTEGER DEFAULT 0, rewardXpTotal INTEGER DEFAULT 0, privilegePoints INTEGER DEFAULT 0);
    CREATE TABLE achievement_defs (id TEXT PRIMARY KEY, familyId TEXT NOT NULL, title TEXT, description TEXT, icon TEXT, category TEXT, system_key TEXT, is_system INTEGER DEFAULT 0);
    CREATE TABLE user_achievements (id TEXT PRIMARY KEY, childId TEXT NOT NULL, achievementId TEXT NOT NULL, unlockedAt TEXT);
    INSERT INTO users (id, familyId, name, role, avatar, coins, xp, rewardXpTotal, privilegePoints) VALUES
      ('child-1', 'family-1', '孩子一', 'child', '👦', 80, 700, 165, 2),
      ('child-2', 'family-1', '孩子二', 'child', '👧', 20, 100, 20, 0),
      ('child-3', 'family-2', '其他家庭孩子', 'child', '⭐', 10, 2600, 10, 0);
    INSERT INTO achievement_defs VALUES
      ('ach-life', 'family-1', '生活小管家', '完成100个生活任务', '🏠', '生活', 'life.count.100', 1),
      ('ach-other', 'family-1', '家庭纪念', '另一个孩子的成就', '🏅', '家庭', NULL, 0),
      ('ach-private', 'family-2', '其他家庭成就', '不可访问', '🔒', '其他', NULL, 0);
    INSERT INTO user_achievements VALUES
      ('unlock-1', 'child-1', 'ach-life', '2026-07-13 20:00:00'),
      ('unlock-2', 'child-2', 'ach-other', '2026-07-13 20:00:00'),
      ('unlock-3', 'child-3', 'ach-private', '2026-07-13 20:00:00');
  `);
  await ensureGrowthCosmeticSchema(db);
  return db;
};

describe('Phase 4 成长身份装扮规则', () => {
  it('按等级和已解锁成就确定装扮，并幂等记录来源', async () => {
    const db = await createDb();
    const first = await getGrowthIdentity(db, 'child-1', 'family-1');
    const firstCount = (await db.get('SELECT COUNT(*) AS count FROM user_cosmetic_unlocks WHERE child_id = ?', 'child-1')).count;
    const second = await getGrowthIdentity(db, 'child-1', 'family-1');
    const secondCount = (await db.get('SELECT COUNT(*) AS count FROM user_cosmetic_unlocks WHERE child_id = ?', 'child-1')).count;
    expect(first.levelIdentity).toMatchObject({ level: 8, stage: { title: '自主探索者' } });
    expect(first.cosmetics.find(item => item.key === 'frame.compass')?.unlocked).toBe(true);
    expect(first.cosmetics.find(item => item.key === 'frame.blocks')?.unlocked).toBe(false);
    expect(first.cosmetics.find(item => item.key === 'theme.life')?.unlocked).toBe(true);
    expect(secondCount).toBe(firstCount);
    expect((await db.get("SELECT COUNT(*) AS count FROM user_cosmetic_unlocks WHERE source_type = 'default'")).count).toBe(0);
    expect(second.selected).toEqual(first.selected);
    await db.close();
  });

  it('保存已获得装扮和最多三枚本人徽章时不修改任何经济账本', async () => {
    const db = await createDb();
    const before = await db.get('SELECT coins, xp, rewardXpTotal, privilegePoints FROM users WHERE id = ?', 'child-1');
    const result = await updateProfileCustomization(db, 'child-1', 'family-1', {
      frameKey: 'frame.compass', themeKey: 'theme.life',
      titleKey: 'title.achievement.life.count.100', featuredAchievementIds: ['ach-life'],
    });
    expect(result.selected).toMatchObject({ frameKey: 'frame.compass', themeKey: 'theme.life', featuredAchievementIds: ['ach-life'] });
    expect(await db.get('SELECT coins, xp, rewardXpTotal, privilegePoints FROM users WHERE id = ?', 'child-1')).toEqual(before);
    await db.close();
  });

  it('拒绝不存在、未解锁和跨孩子装扮请求', async () => {
    const db = await createDb();
    await expect(updateProfileCustomization(db, 'child-1', 'family-1', { frameKey: 'frame.unknown' }))
      .rejects.toMatchObject({ statusCode: 400, code: 'invalid_cosmetic_key' });
    await expect(updateProfileCustomization(db, 'child-1', 'family-1', { frameKey: 'frame.galaxy' }))
      .rejects.toMatchObject({ statusCode: 409, code: 'cosmetic_not_unlocked' });
    await expect(updateProfileCustomization(db, 'child-1', 'family-1', { childId: 'child-2' }))
      .rejects.toMatchObject({ statusCode: 403, code: 'cosmetic_child_forbidden' });
    await expect(getGrowthIdentity(db, 'child-3', 'family-1'))
      .rejects.toMatchObject({ statusCode: 403, code: 'growth_identity_forbidden' });
    await db.close();
  });

  it('拒绝重复、超量或不属于本人的精选成就', async () => {
    const db = await createDb();
    await expect(updateProfileCustomization(db, 'child-1', 'family-1', { featuredAchievementIds: ['ach-life', 'ach-life'] }))
      .rejects.toMatchObject({ statusCode: 400, code: 'invalid_featured_achievements' });
    await expect(updateProfileCustomization(db, 'child-1', 'family-1', { featuredAchievementIds: ['ach-other'] }))
      .rejects.toMatchObject({ statusCode: 403, code: 'achievement_not_owned' });
    await expect(updateProfileCustomization(db, 'child-1', 'family-1', { featuredAchievementIds: ['a', 'b', 'c', 'd'] }))
      .rejects.toMatchObject({ statusCode: 400, code: 'invalid_featured_achievements' });
    await db.close();
  });

  it('已下架或损坏的选择安全回退但不删除历史记录', async () => {
    const db = await createDb();
    await db.run(`INSERT INTO user_profile_customization
      (child_id, avatar_key, frame_key, theme_key, title_key, featured_achievement_ids, updated_at)
      VALUES ('child-1', 'retired.avatar', 'retired.frame', 'retired.theme', 'retired.title', '["missing","ach-life"]', '2026-07-13 20:00:00')`);
    const result = await getGrowthIdentity(db, 'child-1', 'family-1');
    expect(result.selected).toMatchObject({ avatarKey: 'avatar.current', frameKey: 'frame.compass', themeKey: null, titleKey: 'title.stage.explorer', featuredAchievementIds: ['ach-life'] });
    expect((await db.get('SELECT frame_key FROM user_profile_customization WHERE child_id = ?', 'child-1')).frame_key).toBe('retired.frame');
    await db.close();
  });
});
