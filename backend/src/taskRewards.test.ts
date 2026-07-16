import { describe, it, expect } from 'vitest';
import {
  getTaskRewardSuggestion,
  normalizeRewardCategory,
  normalizeRewardResistance,
} from './taskRewards';

// 这些测试锁住"金币/经验"的确定性数学与边界。
// 任何改动若破坏"整数、≥1、勇气>普通>轻松、开方防刷时长、特权点门槛、锁定公式"等业务约定，必须让测试失败（Rule 9：测试验证意图）。

const CATEGORIES = ['生活', '学习', '运动', '活动', '情绪调节', '其他'] as const;
const RESISTANCES = ['轻松', '普通', '勇气'] as const;

describe('金币/经验：整数与下限（不允许浮点、零、负数）', () => {
  it('各类别 × 各抗拒 × 多种分钟，金币与经验恒为 ≥1 的整数，特权点只取 0/1', () => {
    for (const category of CATEGORIES) {
      for (const resistance of RESISTANCES) {
        for (const minutes of [0, 1, 5, 10, 15, 30, 45, 60, 120, 180, 999]) {
          const r = getTaskRewardSuggestion({ category, resistance, minutes });
          expect(Number.isInteger(r.coins)).toBe(true);
          expect(r.coins).toBeGreaterThanOrEqual(1);
          expect(Number.isInteger(r.xp)).toBe(true);
          expect(r.xp).toBeGreaterThanOrEqual(1);
          expect([0, 1]).toContain(r.privilegePoints);
        }
      }
    }
  });
});

describe('抗拒系数：勇气 > 普通 > 轻松（奖励"勇气工作"）', () => {
  it('同类别同时长，金币随抗拒升高不降，且勇气严格大于轻松', () => {
    for (const category of CATEGORIES) {
      const easy = getTaskRewardSuggestion({ category, resistance: '轻松', minutes: 30 }).coins;
      const normal = getTaskRewardSuggestion({ category, resistance: '普通', minutes: 30 }).coins;
      const brave = getTaskRewardSuggestion({ category, resistance: '勇气', minutes: 30 }).coins;
      expect(normal).toBeGreaterThanOrEqual(easy);
      expect(brave).toBeGreaterThanOrEqual(normal);
      expect(brave).toBeGreaterThan(easy);
    }
  });
});

describe('时长开方：防止"刷时长"', () => {
  it('4 倍时长拿不到 4 倍金币（边际递减），但更长仍更多', () => {
    const base = getTaskRewardSuggestion({ category: '其他', resistance: '普通', minutes: 10 }).coins;
    const quad = getTaskRewardSuggestion({ category: '其他', resistance: '普通', minutes: 40 }).coins;
    expect(quad).toBeLessThan(base * 4);
    expect(quad).toBeGreaterThan(base);
  });
  it('金币随时长单调不减', () => {
    let prev = 0;
    for (const minutes of [1, 10, 20, 40, 80, 160, 180]) {
      const c = getTaskRewardSuggestion({ category: '其他', resistance: '普通', minutes }).coins;
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });
});

describe('特权点门槛（达到类别时长才给 1 点；无门槛类别永不给）', () => {
  it('学习满 45 分钟给 1 点，44 分钟给 0 点', () => {
    expect(getTaskRewardSuggestion({ category: '学习', minutes: 45 }).privilegePoints).toBe(1);
    expect(getTaskRewardSuggestion({ category: '学习', minutes: 44 }).privilegePoints).toBe(0);
  });
  it('生活满 60 分钟给 1 点，59 分钟给 0 点', () => {
    expect(getTaskRewardSuggestion({ category: '生活', minutes: 60 }).privilegePoints).toBe(1);
    expect(getTaskRewardSuggestion({ category: '生活', minutes: 59 }).privilegePoints).toBe(0);
  });
  it('运动/情绪调节无论多久都不给特权点', () => {
    for (const category of ['运动', '情绪调节']) {
      expect(getTaskRewardSuggestion({ category, minutes: 180 }).privilegePoints).toBe(0);
    }
  });
});

describe('经验 = round(金币 × 类别倍率)（锁公式，改了要让测试失败）', () => {
  it('学习 10 分钟 普通：金币 10、经验 15（=10×1.5）', () => {
    const r = getTaskRewardSuggestion({ category: '学习', resistance: '普通', minutes: 10 });
    expect(r.coins).toBe(10);
    expect(r.xp).toBe(15);
  });
  it('情绪调节 10 分钟 普通：金币 10、经验 20（=10×2.0）', () => {
    const r = getTaskRewardSuggestion({ category: '情绪调节', resistance: '普通', minutes: 10 });
    expect(r.coins).toBe(10);
    expect(r.xp).toBe(20);
  });
});

describe('类别 / 抗拒 归一化', () => {
  it('别名映射到正确类别', () => {
    expect(normalizeRewardCategory('阅读')).toBe('学习');
    expect(normalizeRewardCategory('晨读')).toBe('学习');
    expect(normalizeRewardCategory('家务')).toBe('生活');
    expect(normalizeRewardCategory('早晨启动')).toBe('生活');
    expect(normalizeRewardCategory('锻炼')).toBe('运动');
    expect(normalizeRewardCategory('不存在的类别')).toBe('其他');
  });
  it('抗拒别名与按类别默认值', () => {
    expect(normalizeRewardResistance('hard')).toBe('勇气');
    expect(normalizeRewardResistance('', '学习')).toBe('勇气');
    expect(normalizeRewardResistance('', '生活')).toBe('轻松');
  });
});

describe('分钟边界 clamp（默认 15、下限 1、上限 180）', () => {
  it('缺失分钟按 15 计', () => {
    const r = getTaskRewardSuggestion({ category: '其他', resistance: '普通' });
    const r15 = getTaskRewardSuggestion({ category: '其他', resistance: '普通', minutes: 15 });
    expect(r.coins).toBe(r15.coins);
  });
  it('超大/非法分钟被夹紧，不产生 NaN', () => {
    const big = getTaskRewardSuggestion({ category: '其他', resistance: '普通', minutes: 99999 });
    const max = getTaskRewardSuggestion({ category: '其他', resistance: '普通', minutes: 180 });
    expect(big.coins).toBe(max.coins);
    const neg = getTaskRewardSuggestion({ category: '其他', resistance: '普通', minutes: -5 });
    expect(Number.isInteger(neg.coins)).toBe(true);
    expect(neg.coins).toBeGreaterThanOrEqual(1);
  });
});
