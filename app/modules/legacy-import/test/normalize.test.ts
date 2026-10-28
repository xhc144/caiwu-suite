import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  CellError,
  date,
  decimal,
  dimensionType,
  flag,
  integer,
  issueFor,
  money,
  normalizeFile,
  requiredText,
  side,
  type SourceRow,
} from '../server/normalize';
import { parseImportFile } from '../server/files';

const source = (values: Record<string, string>): SourceRow => ({
  kind: 'vouchers',
  location: { file: '合成凭证.csv', sheet: '合成凭证.csv', row: 9 },
  values,
  original: {},
});

describe('w_pz_get 凭证导入：列映射与会计数字', () => {
  test('金额按元精确转换为整数分，支持负数、千分位、全角数字与会计括号', () => {
    for (const [value, expected] of [
      ['1234.56', 123456],
      ['0.01', 1],
      ['-12.34', -1234],
      ['￥1,234.56 元', 123456],
      ['１２３４.５６', 123456],
      ['(1,234.56)', -123456],
      ['（12.34）', -1234],
      ['.5', 50],
      ['+12', 1200],
    ] as const)
      expect(money(source({ debit: value }), 'debit')).toBe(expected);
    expect(money(source({}), 'debit')).toBe(0);
  });

  test('任意可安全表示的合成金额往返不损失一分', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), (cents) => {
        const abs = Math.abs(cents);
        const text = `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
        expect(money(source({ debit: text }), 'debit')).toBe(cents);
      }),
    );
  });

  test('拒绝金额精度丢失、错误分组、超界和非数字，不自动修补原账', () => {
    for (const value of [
      '1.001',
      '1e3',
      'NaN',
      'Infinity',
      '1,2',
      '1,23.00',
      '90071992547409.92',
      '--1',
      '一百',
    ]) {
      expect(() => money(source({ debit: value }), 'debit'), value).toThrow(CellError);
    }
  });

  test('日期规范化覆盖常用原表格式，拒绝不存在的日期', () => {
    for (const value of [
      '2026-1-9',
      '2026/01/09',
      '2026.01.09',
      '20260109',
      '2026-01-09 00:00:00',
    ]) {
      expect(date(source({ date: value }), 'date')).toBe('2026-01-09');
    }
    for (const value of ['2026-02-29', '2026-13-01', '2026-04-31', '', '2026-01-09 12:00:00']) {
      expect(() => date(source({ date: value }), 'date'), value).toThrow(CellError);
    }
    expect(date(source({ date: '2024-02-29' }), 'date')).toBe('2024-02-29');
  });

  test('数量最多六位小数且不四舍五入丢失原值，汇率保持十进制字符串', () => {
    expect(decimal(source({ quantity: '1.234567' }), 'quantity', true)).toBe('1.234567');
    expect(decimal(source({ quantity: '-0.000001' }), 'quantity', true)).toBe('-0.000001');
    expect(decimal(source({ exchangeRate: '7.100000' }), 'exchangeRate')).toBe('7.1');
    expect(decimal(source({}), 'quantity', true)).toBeUndefined();
    for (const value of ['0.0000001', '9007199254.740992', '1e2', 'NaN']) {
      expect(() => decimal(source({ quantity: value }), 'quantity', true), value).toThrow(
        CellError,
      );
    }
  });

  test('整数栏校验范围，方向不猜测原版数字标记', () => {
    expect(integer(source({ number: '000012' }), 'number')).toBe(12);
    expect(integer(source({}), 'attachments', 0, 9999)).toBe(0);
    for (const value of ['-1', '1.1', '9007199254740992', '10000']) {
      expect(() => integer(source({ attachments: value }), 'attachments', 0, 9999)).toThrow(
        CellError,
      );
    }
    expect(side(source({ direction: '借方' }), 'direction')).toBe('debit');
    expect(side(source({ direction: '贷' }), 'direction')).toBe('credit');
    expect(side(source({ direction: '平' }), 'direction')).toBeUndefined();
    expect(() => side(source({ direction: '1' }), 'direction')).toThrow('请填写借或贷');
  });

  test('辅助类型、核算标志与必填字段给出对应列名', () => {
    expect(dimensionType(source({ type: '客户/供应商' }))).toBe('partner');
    expect(dimensionType(source({ type: '现金流量项目' }))).toBe('cashflow');
    expect(() => dimensionType(source({ type: '不明类型' }))).toThrow(CellError);
    expect(flag(source({ disabled: '是' }), 'disabled')).toBe(true);
    expect(flag(source({ disabled: 'FALSE' }), 'disabled')).toBe(false);
    expect(flag(source({}), 'disabled')).toBeUndefined();
    expect(() => flag(source({ disabled: '2' }), 'disabled')).toThrow(CellError);
    expect(() => requiredText(source({ summary: '' }), 'summary')).toThrow('摘要不能为空');
    expect(() => requiredText(source({ summary: '三字长' }), 'summary', 2)).toThrow(
      '摘要不能超过2个字符',
    );
  });

  test('映射中文、原字段名与自定义列，原始值和实际源行全部保留', async () => {
    const text = '\n\n原科目号,原名称,原类别,不导入的备注\n0010,  库存现金  ,资产,原始备注\n';
    const file = {
      name: '合成科目.csv',
      contentBase64: Buffer.from(text).toString('base64'),
      kind: 'accounts' as const,
    };
    const parsed = normalizeFile(file.name, await parseImportFile(file), {
      原科目号: 'code',
      原名称: '科目名称',
      原类别: '科目类别',
      不导入的备注: '-',
    });
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows).toEqual([
      {
        kind: 'accounts',
        location: { file: file.name, sheet: file.name, row: 4 },
        values: { code: '0010', name: '库存现金', category: '资产' },
        original: {
          原科目号: '0010',
          原名称: '  库存现金  ',
          原类别: '资产',
          不导入的备注: '原始备注',
        },
      },
    ]);
    expect(parsed.files[0]!.sheets[0]).toMatchObject({ kind: 'accounts', rowCount: 1 });
  });

  test('期初方向与原过账人模板标题能识别', async () => {
    const file = {
      name: '期初.csv',
      kind: 'opening' as const,
      contentBase64: Buffer.from('科目编码,期初余额,期初方向\n2001,100.00,贷').toString('base64'),
    };
    const parsed = normalizeFile(file.name, await parseImportFile(file), {});
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0]!.values.direction).toBe('贷');
    const voucherFile = {
      name: '凭证.csv',
      kind: 'vouchers' as const,
      contentBase64: Buffer.from(
        '凭证日期,凭证字,凭证号,摘要,科目编码,借方金额,贷方金额,原过账人\n2026-01-01,记,1,合成数据,1001,100,0,张会计',
      ).toString('base64'),
    };
    const voucher = normalizeFile(voucherFile.name, await parseImportFile(voucherFile), {});
    expect(voucher.issues).toEqual([]);
    expect(voucher.rows[0]!.values.originalPoster).toBe('张会计');
  });

  test('未识别列保留原值并警告；多列映射同字段和缺必需列阻止导入', async () => {
    const file = {
      name: '科目.csv',
      kind: 'accounts' as const,
      contentBase64: Buffer.from('科目编码,code,未知字段\n1001,1002,原始内容').toString('base64'),
    };
    const parsed = normalizeFile(file.name, await parseImportFile(file), {});
    expect(parsed.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          column: 'code',
          severity: 'error',
          message: expect.stringContaining('多列映射'),
        }),
        expect.objectContaining({
          column: '未知字段',
          severity: 'warning',
          message: expect.stringContaining('未识别列'),
        }),
        expect.objectContaining({
          column: '科目名称',
          severity: 'error',
          message: expect.stringContaining('缺少'),
        }),
      ]),
    );
    expect(parsed.rows[0]!.original['未知字段']).toBe('原始内容');
  });

  test('表头前有空行时，映射和缺列错误定位实际表头行', async () => {
    const file = {
      name: '科目.csv',
      kind: 'accounts' as const,
      contentBase64: Buffer.from('\n\n科目编码,code,未知字段\n1001,1002,原始内容').toString(
        'base64',
      ),
    };
    const parsed = normalizeFile(file.name, await parseImportFile(file), {});
    expect(parsed.issues).toHaveLength(3);
    expect(parsed.issues.every((item) => item.row === 3)).toBe(true);
  });

  test('字段错误加上精确文件、工作表和源行，不丢失定位', () => {
    expect(issueFor(source({}), new CellError('借方金额', '金额过长'))).toEqual([
      {
        file: '合成凭证.csv',
        sheet: '合成凭证.csv',
        row: 9,
        column: '借方金额',
        message: '金额过长',
        severity: 'error',
      },
    ]);
  });
});
