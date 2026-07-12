import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ECONOMY_SETTINGS,
  ECONOMY_PRESETS,
  assessPriceAlignment,
  daysToRedeem,
  normalizeEconomySettings,
  suggestShopCoins,
} from './economyPolicy';

describe('家庭经济设置：简单、稳定、可解释', () => {
  it('默认以1元约等于10金币，并将每日目标控制为30金币', () => {
    expect(DEFAULT_ECONOMY_SETTINGS).toEqual({ coinPerRmb: 10, dailyCoinTarget: 30 });
    expect(normalizeEconomySettings({})).toEqual(DEFAULT_ECONOMY_SETTINGS);
  });

  it('只提供快速、标准、长期三种明确的价值预设', () => {
    expect(ECONOMY_PRESETS).toEqual({ fast: 5, standard: 10, longTerm: 20 });
  });

  it('旧数据或越界配置会被规范为安全整数', () => {
    expect(normalizeEconomySettings({ coinPerRmb: '12.6', dailyCoinTarget: '40.4' }))
      .toEqual({ coinPerRmb: 13, dailyCoinTarget: 40 });
    expect(normalizeEconomySettings({ coinPerRmb: 0, dailyCoinTarget: 9999 }))
      .toEqual({ coinPerRmb: 1, dailyCoinTarget: 500 });
    expect(normalizeEconomySettings({ coinPerRmb: '无效', dailyCoinTarget: null }))
      .toEqual(DEFAULT_ECONOMY_SETTINGS);
  });
});

describe('商品建议价：现实参考价决定金币价格', () => {
  it('标准模式下25元商品建议为250金币', () => {
    expect(suggestShopCoins(25, 10)).toBe(250);
  });

  it('允许小数参考价，但最终金币始终为整数', () => {
    expect(suggestShopCoins(5.45, 10)).toBe(55);
  });

  it('拒绝负数或非数字参考价，避免生成错误商品价格', () => {
    expect(() => suggestShopCoins(-1, 10)).toThrow(/referenceRmb/);
    expect(() => suggestShopCoins(Number.NaN, 10)).toThrow(/referenceRmb/);
  });

  it('以建议价上下20%为可接受区间', () => {
    expect(assessPriceAlignment(80, 100)).toBe('aligned');
    expect(assessPriceAlignment(79, 100)).toBe('underpriced');
    expect(assessPriceAlignment(120, 100)).toBe('aligned');
    expect(assessPriceAlignment(121, 100)).toBe('overpriced');
  });
});

describe('预计积累天数：只解释门槛，不动态改变价格', () => {
  it('根据每日目标向上取整', () => {
    expect(daysToRedeem(50, 30)).toBe(2);
    expect(daysToRedeem(250, 30)).toBe(9);
  });

  it('零价商品仍显示最短1天，异常日目标不会除零', () => {
    expect(daysToRedeem(0, 30)).toBe(1);
    expect(daysToRedeem(50, 0)).toBe(50);
  });
});
