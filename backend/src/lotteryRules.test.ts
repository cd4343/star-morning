import { describe, expect, it } from 'vitest';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { drawPrizeCoreV2 } from './rewardSystem';
import {
  assertPaidLotteryDrawAllowed,
  ensureLotterySafetyTables,
  getLotterySafetySettings,
  isLotteryInventoryVisible,
  LOTTERY_DAILY_PAID_LIMIT,
  LOTTERY_EMPTY_REWARD_COINS,
  normalizeLotteryOutcome,
  normalizeLotteryPrize,
  normalizeLotteryPrizeInput,
  resolveLotteryRewardAmount,
  setLotteryEnabled,
  validateLotteryActivationIds,
} from './lotteryRules';

describe('孩子抽奖安全上限', () => {
  it('默认只允许每天两次付费抽取，第三次必须在扣币前失败', () => {
    expect(LOTTERY_DAILY_PAID_LIMIT).toBe(2);
    expect(() => assertPaidLotteryDrawAllowed(0, { enabled: true, dailyPaidLimit: 2 })).not.toThrow();
    expect(() => assertPaidLotteryDrawAllowed(1, { enabled: true, dailyPaidLimit: 2 })).not.toThrow();
    expect(() => assertPaidLotteryDrawAllowed(2, { enabled: true, dailyPaidLimit: 2 })).toThrow(/最多付费抽 2 次/);
  });

  it('家长可以关闭抽奖，但配置不能把上限提高到两次以上', () => {
    expect(() => assertPaidLotteryDrawAllowed(0, { enabled: false, dailyPaidLimit: 0 })).toThrow(/家长已关闭/);
    expect(() => assertPaidLotteryDrawAllowed(0, { enabled: true, dailyPaidLimit: 3 })).toThrow(/配置无效/);
  });

  it('旧家庭默认启用两次上限，迁移可重复执行且家长只能关闭或恢复默认', async () => {
    const db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await db.exec('PRAGMA foreign_keys = ON; CREATE TABLE families (id TEXT PRIMARY KEY); INSERT INTO families VALUES (\'family-1\');');
    await ensureLotterySafetyTables(db);
    await ensureLotterySafetyTables(db);

    expect(await getLotterySafetySettings(db, 'family-1')).toEqual({ enabled: true, dailyPaidLimit: 2 });
    expect(await setLotteryEnabled(db, 'family-1', false)).toEqual({ enabled: false, dailyPaidLimit: 0 });
    expect(await getLotterySafetySettings(db, 'family-1')).toEqual({ enabled: false, dailyPaidLimit: 0 });
    expect(await setLotteryEnabled(db, 'family-1', true)).toEqual({ enabled: true, dailyPaidLimit: 2 });
    await db.close();
  });
});

describe('抽奖没有空结果', () => {
  it('家长不能新建或重新上架 none、谢谢参与和数值为零的奖品', () => {
    for (const prize of [
      { title: '谢谢参与', cost: 0, effectType: null },
      { title: '谢谢参与，下次再来', cost: 10, effectType: 'bonus_coins' },
      { title: '下次再来', cost: 0, effectType: 'none' },
      { title: '0金币', cost: 0, effectType: 'bonus_coins' },
      { title: '0经验', cost: 0, effectType: 'bonus_xp' },
      { title: '0特权点', cost: 0, effectType: 'bonus_privilege' },
    ]) {
      expect(() => normalizeLotteryPrizeInput(prize)).toThrow(/空奖|正整数/);
    }
  });

  it('谢谢参与和 none 效果都转换为显示值等于到账值的固定 5 金币', () => {
    for (const prize of [
      { id: 'none-1', title: '谢谢参与', cost: 0, effectType: null },
      { id: 'none-2', title: '下次再来', cost: 0, effectType: 'none' },
    ]) {
      const normalized = normalizeLotteryOutcome(prize);
      expect(normalized).toMatchObject({
        id: prize.id,
        title: `${LOTTERY_EMPTY_REWARD_COINS}金币`,
        cost: LOTTERY_EMPTY_REWARD_COINS,
        effectType: 'bonus_coins',
      });
      expect(resolveLotteryRewardAmount(normalized)).toBe(LOTTERY_EMPTY_REWARD_COINS);
    }
  });

  it('空奖实际结算 5 金币并将显示标题同步为 5 金币', async () => {
    const db = await open({ filename: ':memory:', driver: sqlite3.Database });
    await db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, coins INTEGER, xp INTEGER, privilegePoints INTEGER);
      CREATE TABLE wishes (
        id TEXT PRIMARY KEY, familyId TEXT, type TEXT, isActive INTEGER, stock INTEGER,
        rarity TEXT, weight INTEGER, effectType TEXT, title TEXT, icon TEXT, cost INTEGER
      );
      CREATE TABLE lottery_stats (
        childId TEXT PRIMARY KEY, totalDraws INTEGER DEFAULT 0, rareStreak INTEGER DEFAULT 0,
        epicStreak INTEGER DEFAULT 0, legendaryStreak INTEGER DEFAULT 0, updatedAt TEXT
      );
      CREATE TABLE user_inventory (
        id TEXT PRIMARY KEY, childId TEXT, wishId TEXT, title TEXT, icon TEXT, cost INTEGER,
        costType TEXT, source TEXT, status TEXT, redeemedAt TEXT, acquiredAt TEXT DEFAULT CURRENT_TIMESTAMP,
        rewardCoins INTEGER DEFAULT 0, rewardXp INTEGER DEFAULT 0, rewardPrivilegePoints INTEGER DEFAULT 0
      );
      INSERT INTO users VALUES ('child-1', 100, 0, 0);
      INSERT INTO wishes VALUES ('none-1', 'family-1', 'lottery', 1, -1, 'common', 10, 'none', '谢谢参与', '😊', 0);
    `);

    const result = await drawPrizeCoreV2(db, 'family-1', 'child-1', 15, 'lottery');

    expect(result).toMatchObject({ isBonusCoins: true, bonusCoins: 5 });
    expect('isNothing' in result).toBe(false);
    expect(result.prize).toMatchObject({ title: '5金币', cost: 5, effectType: 'bonus_coins' });
    expect((await db.get('SELECT coins FROM users WHERE id = ?', 'child-1')).coins).toBe(105);
    expect(await db.get(
      'SELECT title, cost, rewardCoins, rewardXp, rewardPrivilegePoints FROM user_inventory WHERE id = ?',
      result.newInventoryId,
    )).toMatchObject({ title: '5金币', cost: 15, rewardCoins: 5, rewardXp: 0, rewardPrivilegePoints: 0 });
    expect(await db.get('SELECT title, cost, effectType FROM wishes WHERE id = ?', 'none-1'))
      .toMatchObject({ title: '谢谢参与', cost: 0, effectType: 'none' });
    await db.close();
  });
});

describe('抽奖即时奖励金额：孩子看到多少就到账多少', () => {
  it('数值字段与旧标题冲突时，以实际结算字段生成唯一展示标题', () => {
    const prize = normalizeLotteryPrize({ title: '5金币', cost: 20, effectType: 'bonus_coins' });
    expect(resolveLotteryRewardAmount(prize)).toBe(20);
    expect(prize.title).toBe('20金币');
    expect(prize.cost).toBe(20);
  });

  it('旧数据没有有效数值时，只从严格金额标题恢复', () => {
    expect(resolveLotteryRewardAmount({ title: '5金币', cost: 0, effectType: 'bonus_coins' })).toBe(5);
    expect(normalizeLotteryPrize({ title: '10经验', cost: null, effectType: 'bonus_xp' })).toMatchObject({ title: '10成长', cost: 10 });
    expect(normalizeLotteryPrize({ title: '1特权点', cost: -1, effectType: 'bonus_privilege' })).toMatchObject({ title: '1权益点', cost: 1 });
  });

  it('无效、小数和无法解析的配置必须失败，不能静默发默认金币', () => {
    for (const prize of [
      { title: '幸运金币', cost: 0, effectType: 'bonus_coins' },
      { title: '5金币', cost: 1.5, effectType: 'bonus_coins' },
      { title: '-5金币', cost: -5, effectType: 'bonus_coins' },
      { title: '十金币', cost: 'abc', effectType: 'bonus_coins' },
    ]) {
      expect(() => resolveLotteryRewardAmount(prize)).toThrow(/正整数/);
    }
  });

  it('家长保存即时奖励时规范标题，并拒绝依赖旧标题补值', () => {
    expect(normalizeLotteryPrizeInput({ title: '自定义名称', cost: 8, effectType: 'bonus_coins' }))
      .toMatchObject({ title: '8金币', cost: 8 });
    expect(() => normalizeLotteryPrizeInput({ title: '5金币', cost: 0, effectType: 'bonus_coins' }))
      .toThrow(/正整数/);
  });

  it('翻倍后的奖品标题仍与最终到账金额一致', () => {
    expect(normalizeLotteryPrize({ title: '5金币', cost: 10, effectType: 'bonus_coins' }).title).toBe('10金币');
  });

  it('金币、成长和权益流水分别记录实际到账字段，不把抽奖花费当奖励值', async () => {
    const cases = [
      { id: 'coins', effectType: 'bonus_coins', amount: 7, title: '7金币', balanceColumn: 'coins', rewardColumn: 'rewardCoins', initial: 100 },
      { id: 'xp', effectType: 'bonus_xp', amount: 8, title: '8成长', balanceColumn: 'xp', rewardColumn: 'rewardXp', initial: 0 },
      { id: 'rights', effectType: 'bonus_privilege', amount: 2, title: '2权益点', balanceColumn: 'privilegePoints', rewardColumn: 'rewardPrivilegePoints', initial: 0 },
    ] as const;

    for (const item of cases) {
      const db = await open({ filename: ':memory:', driver: sqlite3.Database });
      await db.exec(`
        CREATE TABLE users (id TEXT PRIMARY KEY, coins INTEGER, xp INTEGER, privilegePoints INTEGER);
        CREATE TABLE wishes (
          id TEXT PRIMARY KEY, familyId TEXT, type TEXT, isActive INTEGER, stock INTEGER,
          rarity TEXT, weight INTEGER, effectType TEXT, title TEXT, icon TEXT, cost INTEGER
        );
        CREATE TABLE lottery_stats (
          childId TEXT PRIMARY KEY, totalDraws INTEGER DEFAULT 0, rareStreak INTEGER DEFAULT 0,
          epicStreak INTEGER DEFAULT 0, legendaryStreak INTEGER DEFAULT 0, updatedAt TEXT
        );
        CREATE TABLE user_inventory (
          id TEXT PRIMARY KEY, childId TEXT, wishId TEXT, title TEXT, icon TEXT, cost INTEGER,
          costType TEXT, source TEXT, status TEXT, redeemedAt TEXT, acquiredAt TEXT DEFAULT CURRENT_TIMESTAMP,
          rewardCoins INTEGER DEFAULT 0, rewardXp INTEGER DEFAULT 0, rewardPrivilegePoints INTEGER DEFAULT 0
        );
        INSERT INTO users VALUES ('child-1', 100, 0, 0);
      `);
      await db.run(
        `INSERT INTO wishes VALUES (?, 'family-1', 'lottery', 1, -1, 'common', 10, ?, '旧标题', '🎁', ?)`,
        item.id, item.effectType, item.amount,
      );

      const result = await drawPrizeCoreV2(db, 'family-1', 'child-1', 15, 'lottery');
      const inventory = await db.get('SELECT * FROM user_inventory WHERE id = ?', result.newInventoryId);
      const user = await db.get('SELECT * FROM users WHERE id = ?', 'child-1');

      expect(result.prize).toMatchObject({ title: item.title, cost: item.amount, effectType: item.effectType });
      expect(inventory.title).toBe(item.title);
      expect(inventory.cost).toBe(15);
      expect(inventory[item.rewardColumn]).toBe(item.amount);
      expect(user[item.balanceColumn]).toBe(item.initial + item.amount);
      await db.close();
    }
  });
});

describe('抽奖背包：即时流水不伪装成待兑现物品', () => {
  const hiddenEffects = ['draw_again', 'bonus_coins', 'bonus_xp', 'bonus_privilege', 'none'];

  it('隐藏所有即时效果和历史谢谢参与记录', () => {
    for (const effectType of hiddenEffects) {
      expect(isLotteryInventoryVisible({ source: 'lottery', effectType, title: '任意标题' })).toBe(false);
      expect(isLotteryInventoryVisible({ source: 'free_draw', effectType, title: '任意标题' })).toBe(false);
    }
    expect(isLotteryInventoryVisible({ source: 'lottery', effectType: null, title: '谢谢参与' })).toBe(false);
    expect(isLotteryInventoryVisible({ source: 'lottery', effectType: null, title: '谢谢参与，下次再来' })).toBe(false);
  });

  it('保留真正需要使用或兑现的背包物品', () => {
    expect(isLotteryInventoryVisible({ source: 'lottery', effectType: 'free_spin', title: '抽奖券' })).toBe(true);
    expect(isLotteryInventoryVisible({ source: 'lottery', effectType: 'double_next', title: '双倍卡' })).toBe(true);
    expect(isLotteryInventoryVisible({ source: 'lottery', effectType: null, title: '赖床10分钟卡' })).toBe(true);
    expect(isLotteryInventoryVisible({ source: 'shop', effectType: 'bonus_coins', title: '纪念品' })).toBe(true);
  });
});

describe('抽奖奖池上架：必须是8个真实且不重复的选择', () => {
  it('接受8个不同ID，拒绝重复、空值和数量错误', () => {
    const ids = Array.from({ length: 8 }, (_, index) => `prize-${index}`);
    expect(validateLotteryActivationIds(ids)).toEqual(ids);
    expect(() => validateLotteryActivationIds([...ids.slice(0, 7), ids[0]])).toThrow(/不能重复/);
    expect(() => validateLotteryActivationIds([...ids.slice(0, 7), ''])).toThrow(/不能重复或为空/);
    expect(() => validateLotteryActivationIds(ids.slice(0, 7))).toThrow(/恰好8个/);
  });
});
