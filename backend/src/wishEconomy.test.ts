import { describe, expect, it } from 'vitest';
import {
  normalizeShopReferenceRmb,
  toChildWish,
  toParentWish,
} from './wishEconomy';

describe('商品现实参考价值边界', () => {
  it('只接受可审计的非负整数，空值保持为未配置', () => {
    expect(normalizeShopReferenceRmb(undefined)).toBeNull();
    expect(normalizeShopReferenceRmb('')).toBeNull();
    expect(normalizeShopReferenceRmb('25')).toBe(25);
    expect(() => normalizeShopReferenceRmb(-1)).toThrow('现实参考价');
    expect(() => normalizeShopReferenceRmb(1.5)).toThrow('现实参考价');
    expect(() => normalizeShopReferenceRmb('abc')).toThrow('现实参考价');
  });

  it('家长端获得驼峰参考价，孩子端永远不获得人民币字段', () => {
    const row = { id: 'wish-1', title: '一本书', cost: 120, reference_rmb: 12 };
    expect(toParentWish(row)).toEqual({
      id: 'wish-1',
      title: '一本书',
      cost: 120,
      referenceRmb: 12,
    });
    expect(toChildWish({ ...row, referenceRmb: 99 })).toEqual({
      id: 'wish-1',
      title: '一本书',
      cost: 120,
    });
  });
});
