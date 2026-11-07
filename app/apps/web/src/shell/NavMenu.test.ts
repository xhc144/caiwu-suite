import { describe, expect, it } from 'vitest';
import { defineManifest } from '@caiwu/core';
import { buildNavItems, groupNavItems, navTier } from './NavMenu';

const admin = { id: 1, code: 'admin', name: '管理员', isAdmin: true, permissions: [] };
const ledgers = defineManifest({
  id: 'ledgers',
  name: '账簿',
  products: 'all',
  menu: [
    { group: 'ledger', title: '总分类账', path: '/general', order: 110 },
    { group: 'ledger', title: '三栏明细账', path: '/detail', order: 120 },
    { group: 'ledger', title: '辅助明细账', path: '/auxiliary', order: 210 },
    // 未声明 order：保留在清单里的位置
    { group: 'ledger', title: '多栏账', path: '/multi' },
  ],
});
const balances = defineManifest({
  id: 'balances',
  name: '余额表',
  products: 'all',
  menu: [
    { group: 'ledger', title: '辅助余额表', path: '/auxiliary', order: 220 },
    { group: 'ledger', title: '汇总余额表', path: '/', order: 130 },
  ],
});

describe('导航按业务顺序排列', () => {
  it('组内按 order 排列，跨模块交错；不按拼音', () => {
    const items = buildNavItems([ledgers, balances], admin);
    const [group] = groupNavItems(items);
    expect(group?.group.id).toBe('ledger');
    expect(group?.items.map((i) => i.title)).toEqual([
      '总分类账',
      '三栏明细账',
      '汇总余额表',
      '辅助明细账',
      '辅助余额表',
      '多栏账',
    ]);
  });
  it('order 相同时保持清单声明顺序', () => {
    const plain = defineManifest({
      id: 'plain',
      name: '无序',
      products: 'all',
      menu: [
        { group: 'system', title: '乙', path: '/b' },
        { group: 'system', title: '甲', path: '/a' },
      ],
    });
    const [group] = groupNavItems(buildNavItems([plain], admin));
    expect(group?.items.map((i) => i.title)).toEqual(['乙', '甲']);
  });
  it('百位相同为同一档，换档处才加分隔线', () => {
    expect(navTier(110)).toBe(navTier(160));
    expect(navTier(160)).not.toBe(navTier(210));
    expect(navTier(500)).toBe(5);
  });
});
