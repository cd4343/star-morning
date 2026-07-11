import { describe, expect, it } from 'vitest';
import {
  isLotteryInventoryVisible,
  normalizeLotteryPrize,
  normalizeLotteryPrizeInput,
  resolveLotteryRewardAmount,
  validateLotteryActivationIds,
} from './lotteryRules';

describe('抽奖即时奖励金额：孩子看到多少就到账多少', () => {
  it('数值字段与旧标题冲突时，以实际结算字段生成唯一展示标题', () => {
    const prize = normalizeLotteryPrize({ title: '5金币', cost: 20, effectType: 'bonus_coins' });
    expect(resolveLotteryRewardAmount(prize)).toBe(20);
    expect(prize.title).toBe('20金币');
    expect(prize.cost).toBe(20);
  });

  it('旧数据没有有效数值时，只从严格金额标题恢复', () => {
    expect(resolveLotteryRewardAmount({ title: '5金币', cost: 0, effectType: 'bonus_coins' })).toBe(5);
    expect(normalizeLotteryPrize({ title: '10经验', cost: null, effectType: 'bonus_xp' })).toMatchObject({ title: '10经验', cost: 10 });
    expect(normalizeLotteryPrize({ title: '1特权点', cost: -1, effectType: 'bonus_privilege' })).toMatchObject({ title: '1特权点', cost: 1 });
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
