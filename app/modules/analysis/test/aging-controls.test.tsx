import { describe, expect, it } from 'vitest';
import {
  AGING_WIDTH_KEY,
  adjustAgingWidth,
  changeAgingYear,
  readAgingWidths,
  restoreAgingWidths,
} from '../web/AgingPage';

function memoryStorage(initial: string | null = null) {
  const values = new Map<string, string>();
  if (initial !== null) values.set(AGING_WIDTH_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

describe('w_fx_zl 本机列宽恢复与左右微调', () => {
  it('兼容表格原有列宽键，微调保留其他列，恢复后重读为空', () => {
    const storage = memoryStorage('{"account":200,"bucket-0":150}');
    expect(adjustAgingWidth(storage, 'account', 170, -10)).toEqual({
      account: 190,
      'bucket-0': 150,
    });
    expect(adjustAgingWidth(storage, 'bucket-0', 130, 10)).toEqual({
      account: 190,
      'bucket-0': 160,
    });
    expect(readAgingWidths(storage)).toEqual({ account: 190, 'bucket-0': 160 });
    expect(storage.getItem('caiwu.table.analysis.aging.widths')).not.toBeNull();
    restoreAgingWidths(storage);
    expect(readAgingWidths(storage)).toEqual({});
  });
  it('没有自定义列宽时从原列宽微调，最窄48像素、最宽10000像素', () => {
    const storage = memoryStorage();
    expect(adjustAgingWidth(storage, 'account', 170, 10).account).toBe(180);
    expect(adjustAgingWidth(storage, 'bucket-0', 48, -10)['bucket-0']).toBe(48);
    expect(adjustAgingWidth(storage, 'bucket-1', 10000, 10)['bucket-1']).toBe(10000);
  });
  it.each(['null', '[]', 'broken', '{"account":47}', '{"account":"190"}', '{"account":1e100}'])(
    '错误列宽不能进入通用表格，恢复后可继续显示：%s',
    (raw) => {
      const storage = memoryStorage(raw);
      expect(() => readAgingWidths(storage)).toThrow('列宽设置');
      restoreAgingWidths(storage);
      expect(readAgingWidths(storage)).toEqual({});
    },
  );
  it('写入拒绝、静默丢失或恢复失败必须明确失败，不能声称已经保存', () => {
    const storage = memoryStorage();
    expect(() =>
      adjustAgingWidth(
        {
          ...storage,
          setItem: () => {
            throw new Error('存储被拒绝');
          },
        },
        'account',
        170,
        10,
      ),
    ).toThrow('存储被拒绝');
    expect(() => adjustAgingWidth({ ...storage, setItem: () => {} }, 'account', 170, 10)).toThrow(
      '未能读取',
    );
    const existing = memoryStorage('{"account":180}');
    expect(() => restoreAgingWidths({ ...existing, removeItem: () => {} })).toThrow('未能恢复');
    expect(readAgingWidths(existing).account).toBe(180);
  });
});

describe('w_fx_zl / w_xt_ye_nf 选择截止年份', () => {
  it('只改变年份并保留月日，不调整账务金额', () => {
    expect(changeAgingYear('2026-04-15', 2027, 202601)).toEqual({
      date: '2027-04-15',
      adjusted: false,
    });
    expect(changeAgingYear('2026-12-31', 2028, 202601)).toEqual({
      date: '2028-12-31',
      adjusted: false,
    });
  });
  it('闰日到非闰年调整为二月末日，仍是闰年时保留29日', () => {
    expect(changeAgingYear('2028-02-29', 2027, 202601)).toEqual({
      date: '2027-02-28',
      adjusted: true,
    });
    expect(changeAgingYear('2028-02-29', 2032, 202601)).toEqual({
      date: '2032-02-29',
      adjusted: false,
    });
    expect(changeAgingYear('2000-02-29', 2100, 190001)).toEqual({
      date: '2100-02-28',
      adjusted: true,
    });
  });
  it.each([null, 2026.5, 1899, 10000])('错误年份被阻止，原截止日期仍由调用方保留：%s', (year) => {
    expect(() => changeAgingYear('2026-04-15', year, 202601)).toThrow('整数年份');
  });
  it('早于开账年份和错误日期分别提示，不能补造历史', () => {
    expect(() => changeAgingYear('2026-04-15', 2025, 202601)).toThrow('早于账套启用年份');
    expect(() => changeAgingYear('2026-02-30', 2027, 202601)).toThrow('当前截止日期无效');
    expect(() => changeAgingYear('', 2027, 202601)).toThrow('当前截止日期无效');
  });
});
