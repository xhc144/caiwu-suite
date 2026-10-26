import { describe, expect, it } from 'vitest';
import {
  convertCurrency,
  defineManifest,
  formatMoney,
  levelOfCode,
  moneyToChinese,
  multiplyToCents,
  nextPeriod,
  parentCodeOf,
  parseCodeScheme,
  parseMoney,
  parseTemplate,
  periodEndDate,
  periodOfDate,
  prevPeriod,
  qtyFromE6,
  qtyToE6,
  toCents,
} from '../src';
import demo from '../templates/demo.json' with { type: 'json' };

describe('金额', () => {
  it('元转分四舍五入', () => {
    expect(toCents('123.455')).toBe(12346);
    expect(toCents('0.1')).toBe(10);
    expect(toCents(0.3)).toBe(30);
  });

  it('格式化', () => {
    expect(formatMoney(123456789)).toBe('1,234,567.89');
    expect(formatMoney(-5)).toBe('-0.05');
    expect(formatMoney(0, { blankZero: true })).toBe('');
    expect(formatMoney(100000, { thousands: false })).toBe('1000.00');
  });

  it('解析用户输入', () => {
    expect(parseMoney('1,234.5')).toBe(123450);
    expect(parseMoney('-12')).toBe(-1200);
    expect(parseMoney('（12.30）')).toBe(-1230);
    expect(parseMoney('¥１２.３')).toBe(1230);
    expect(parseMoney('.5')).toBe(50);
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('1.2.3')).toBeNull();
  });

  it('乘法和换算不丢精度', () => {
    expect(multiplyToCents('2.5', '3.33')).toBe(833);
    expect(multiplyToCents('0.1', '0.2')).toBe(2);
    expect(convertCurrency(10000, '7.1234')).toBe(71234);
  });

  it('金额大写', () => {
    expect(moneyToChinese(12345)).toBe('壹佰贰拾叁元肆角伍分');
    expect(moneyToChinese(100000000)).toBe('壹佰万元整');
    expect(moneyToChinese(1000500)).toBe('壹万零伍元整');
    expect(moneyToChinese(10001)).toBe('壹佰元零壹分');
    expect(moneyToChinese(1050)).toBe('壹拾元伍角整');
    expect(moneyToChinese(10000000005_00)).toBe('壹佰亿零伍元整');
    expect(moneyToChinese(-100)).toBe('负壹元整');
    expect(moneyToChinese(0)).toBe('零元整');
    expect(moneyToChinese(5)).toBe('伍分');
  });

  it('数量按百万分之一存储', () => {
    expect(qtyToE6('12.5')).toBe(12_500_000);
    expect(qtyFromE6(12_500_000)).toBe('12.5');
    expect(qtyFromE6(qtyToE6('0.0000005'))).toBe('0.000001');
  });
});

describe('期间与科目级次', () => {
  it('期间运算', () => {
    expect(periodOfDate('2026-07-31')).toBe(202607);
    expect(nextPeriod(202612)).toBe(202701);
    expect(prevPeriod(202601)).toBe(202512);
    expect(periodEndDate(202602)).toBe('2026-02-28');
    expect(() => periodOfDate('2026-02-30')).toThrow();
  });

  it('级次规则', () => {
    const s = parseCodeScheme('4-3-3');
    expect(levelOfCode('1002', s)).toBe(1);
    expect(levelOfCode('1002001', s)).toBe(2);
    expect(levelOfCode('10020', s)).toBeNull();
    expect(parentCodeOf('1002001001', s)).toBe('1002001');
    expect(parentCodeOf('1002', s)).toBeNull();
    expect(() => parseCodeScheme('4-0-3')).toThrow();
  });
});

describe('模块清单', () => {
  it('合法清单', () => {
    const m = defineManifest({
      id: 'cashier',
      name: '出纳',
      products: 'all',
      permissions: [{ id: 'cashier.document.edit', name: '录入单据' }],
      menu: [
        {
          group: 'cashier',
          title: '单据录入',
          path: '/documents',
          permission: 'cashier.document.edit',
        },
      ],
      sources: [{ type: 'document', name: '出纳单据', path: '/documents?id={id}' }],
    });
    expect(m.menu[0]!.order).toBe(500);
  });

  it('权限点必须带模块前缀、菜单引用的权限必须声明', () => {
    expect(() =>
      defineManifest({
        id: 'cashier',
        name: '出纳',
        products: 'all',
        permissions: [{ id: 'payroll.x', name: 'x' }],
      }),
    ).toThrow(/必须以 "cashier." 开头/);
    expect(() =>
      defineManifest({
        id: 'cashier',
        name: '出纳',
        products: 'all',
        menu: [{ group: 'cashier', title: 'a', path: '/a', permission: 'cashier.a' }],
      }),
    ).toThrow(/没有在 permissions 里声明/);
    expect(() => defineManifest({ id: 'Cashier', name: '出纳', products: 'all' })).toThrow(
      /模块 id/,
    );
  });
});

describe('会计制度模板', () => {
  it('演示模板自洽', () => {
    const t = parseTemplate(demo);
    expect(t.accounts.length).toBeGreaterThan(20);
  });

  it('指出编码、上级、类别的问题', () => {
    const bad = {
      ...demo,
      accounts: [
        { code: '1001', name: '库存现金', category: 'asset' },
        { code: '100101', name: '缺上级', category: 'asset' },
        { code: '1001', name: '重复', category: 'asset' },
        { code: '30010101', name: '上级不存在', category: 'asset' },
        { code: '9999', name: '类别不存在', category: 'nope' },
      ],
    };
    expect(() => parseTemplate(bad)).toThrow(/科目 1001 重复/);
    expect(() => parseTemplate(bad)).toThrow(/科目 30010101 的上级科目 300101 不存在/);
    expect(() => parseTemplate(bad)).toThrow(/科目 9999 的类别 nope 未定义/);
  });
});
