import { afterEach, describe, expect, test } from 'vitest';
import fc from 'fast-check';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import { sql } from '@caiwu/db';
import { syntheticNative } from '../native-sample';
import {
  NATIVE_SAVEAS,
  NATIVE_SAVEAS0,
  NATIVE_PZ,
  NATIVE_HEAD,
  NATIVE_KEYS,
  NATIVE_TYPES,
  type NativeDocument,
  type NativeTable,
} from '../native';
import { nativePreflight } from '../server/native-preflight';
import server from '../server';

const apps: TestApp[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
});
const run = (doc = syntheticNative()) =>
  nativePreflight({ name: '虚构明确表行.json', text: JSON.stringify(doc) });
const table = (doc: NativeDocument, name: string) => doc.tables.find((t) => t.name === name)!;
function cell(t: NativeTable, row: number, field: string, value: string | null) {
  t.rows[row]![t.columns.indexOf(field)] = value;
}
const codes = (doc: NativeDocument) => run(doc).issues.map((i) => i.code);

async function state(app: TestApp) {
  // Every persistent table, not just the voucher count: prove no batch/log/setting/opening writes.
  const names = (
    await sql<{ name: string; type: string }>`SELECT name, type FROM sqlite_schema`.execute(
      app.svc.db,
    )
  ).rows;
  const snapshot: Record<string, unknown> = {};
  for (const t of names
    .filter((t) => t.type === 'table')
    .sort((a, b) => a.name.localeCompare(b.name))) {
    snapshot[t.name] = (await sql`SELECT * FROM ${sql.table(t.name)}`.execute(app.svc.db)).rows;
  }
  return snapshot;
}

describe('w_pz_get / dw_pz_saveas 原生结构只读预检', () => {
  test('固定字段逐一对应真实 qingsong DW 定义，不拼 tables.md 展示变体', () => {
    const defs = JSON.parse(
      readFileSync(
        new URL('../../../../docs/original-analysis/json/datawindows.json', import.meta.url),
        'utf8',
      ),
    ) as Record<string, { columns: { name: string; db: string }[]; query: string }>;
    expect(NATIVE_SAVEAS).toEqual(defs['qingsong/dw_pz_saveas']!.columns.map((c) => c.name));
    expect(NATIVE_SAVEAS0).toEqual(defs['qingsong/dw_pz_saveas0']!.columns.map((c) => c.name));
    expect(NATIVE_SAVEAS).not.toContain('htbh');
    expect(NATIVE_SAVEAS0).toContain('pz_htbh');
    expect(NATIVE_SAVEAS0).not.toContain('pzdj_pzdj_bz');
    const original = defs['qingsong/dw_pz_saveas']!;
    expect(NATIVE_PZ).toEqual(
      original.columns.filter((c) => c.db.startsWith('pz.')).map((c) => c.db.slice(3)),
    );
    expect(NATIVE_HEAD).toEqual([
      ...NATIVE_KEYS,
      ...original.columns.filter((c) => c.db.startsWith('pzdj.')).map((c) => c.db.slice(5)),
    ]);
    expect(NATIVE_TYPES).toEqual(defs['qingsong/dw_xt_pzlx']!.columns.map((c) => c.name));
    for (const key of NATIVE_KEYS) expect(original.query).toContain(`RIGHT="pzdj.${key}"`);
  });
  test.each(['tables', 'saveas'] as const)(
    '%s 正常结构保留文本哈希、原字段、每行、精确分和阻断边界',
    (mode) => {
      const doc = syntheticNative(mode);
      const text = JSON.stringify(doc);
      const r = nativePreflight({ name: 'fixture.json', text });
      expect(r.source).toEqual({
        name: 'fixture.json',
        bytes: Buffer.byteLength(text),
        sha256: createHash('sha256').update(text).digest('hex'),
      });
      expect(r.structurePassed).toBe(true);
      expect(r.document).toEqual(doc);
      expect(r.coverage.every((c) => c.present)).toBe(true);
      expect(r.records).toHaveLength(mode === 'tables' ? 4 : 3);
      expect(r.vouchers).toMatchObject([
        {
          key: '2026/1/3/7',
          typeName: '记',
          debitCents: '12345',
          creditCents: '12345',
          lines: [{ row: 1 }, { row: 2 }],
        },
      ]);
      expect(r.vouchers[0]!.amounts).toMatchObject([
        { debitText: '123.45', debitCents: '12345', creditCents: '0' },
        { creditText: '123.45', creditCents: '12345' },
      ]);
      expect(r.issues.map((i) => i.code)).toContain('HISTORICAL_STATUS_UNSUPPORTED');
      expect(r).toMatchObject({ migrationAllowed: false, targetChanges: 0 });
      expect(r.notice).toContain('原生数据尚未完成迁移');
      expect(r.notice).toContain('所有目标账务零变化');
    },
  );
  test('四键连接：同编号跨月、跨类型独立，不按 pzbh 合并', () => {
    const d = syntheticNative();
    const pz = table(d, 'pz');
    const heads = table(d, 'pzdj');
    for (const [month, type] of [
      ['2', '3'],
      ['1', '4'],
    ]) {
      const h = [...heads.rows[0]!];
      const idx = heads.rows.length;
      heads.rows.push(h);
      cell(heads, idx, 'yf', month!);
      cell(heads, idx, 'pzlx', type!);
      cell(heads, idx, 'pzdj_rq', `2026-${month!.padStart(2, '0')}-05`);
      cell(heads, idx, 'pzdj_shrq', null);
      for (const original of pz.rows.slice(0, 2)) {
        const n = pz.rows.length;
        pz.rows.push([...original]);
        cell(pz, n, 'yf', month!);
        cell(pz, n, 'pzlx', type!);
      }
    }
    table(d, 'pzlx').rows.push(['4', '收', '收款凭证']);
    const r = run(d);
    expect(r.structurePassed).toBe(true);
    expect(r.textAmountsPassed).toBe(true);
    expect(r.vouchers.map((v) => [v.key, v.typeName, v.lines.length])).toEqual([
      ['2026/1/3/7', '记', 2],
      ['2026/2/3/7', '记', 2],
      ['2026/1/4/7', '收', 2],
    ]);
  });
  test('重复头即使相同也阻断，重复行序保留坐标', () => {
    const d = syntheticNative();
    const h = table(d, 'pzdj');
    h.rows.push([...h.rows[0]!]);
    const p = table(d, 'pz');
    p.rows.push([...p.rows[0]!]);
    const r = run(d);
    expect(r.structurePassed).toBe(false);
    expect(r.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'HEAD_DUPLICATE', table: 'pzdj', row: 2 }),
        expect.objectContaining({ code: 'LINE_DUPLICATE', table: 'pz', row: 3, field: 'pz_xh' }),
      ]),
    );
    expect(r.document).toEqual(d);
  });
  test('孤立头、孤立分录按四键拒绝；不能只按编号接回', () => {
    const d = syntheticNative();
    cell(table(d, 'pzdj'), 0, 'yf', '2');
    expect(codes(d)).toEqual(expect.arrayContaining(['HEAD_ORPHAN', 'LINE_ORPHAN']));
  });
  test.each(['0', '9', ' ', 'draft'])('未知状态 %s 明确阻断，未默认未审核', (s) => {
    const d = syntheticNative();
    cell(table(d, 'pzdj'), 0, 'pzdj_bz', s);
    expect(codes(d)).toContain('STATUS_UNKNOWN');
    expect(run(d).migrationAllowed).toBe(false);
  });
  test('NULL 状态与缺状态字段分别报告，不能从人员推定', () => {
    const d = syntheticNative();
    const h = table(d, 'pzdj');
    cell(h, 0, 'pzdj_bz', null);
    expect(codes(d)).toContain('STATUS_MISSING');
    const index = h.columns.indexOf('pzdj_bz');
    h.columns.splice(index, 1);
    h.rows.forEach((r) => r.splice(index, 1));
    expect(run(d).coverage).toContainEqual(
      expect.objectContaining({ field: 'pzdj_bz', present: false }),
    );
    expect(codes(d)).toContain('FIELD_MISSING');
  });
  test('saveas0 精确认出，但缺状态及审核过账日期，不能拼 dd 为凭证日期', () => {
    const d = syntheticNative('saveas0');
    const r = run(d);
    expect(r.profile).toBe('qingsong/dw_pz_saveas0');
    expect(r.structurePassed).toBe(false);
    expect(r.coverage.filter((f) => !f.present).map((f) => f.field)).toEqual([
      'pzdj_bz',
      'pzdj_rq',
      'pzdj_shrq',
      'pzdj_jzrq',
    ]);
    expect(r.issues.map((i) => i.code)).toContain('SAVEAS0_INFORMATION_MISSING');
    expect(r.document).toEqual(d);
  });
  test('联表头信息冲突、重复及乱序分录拒绝，不自动排序', () => {
    const d = syntheticNative('saveas');
    const t = table(d, 'dw_pz_saveas');
    cell(t, 1, 'pzdj_pzdj_fds', '8');
    [t.rows[0], t.rows[1]] = [t.rows[1]!, t.rows[0]!];
    expect(codes(d)).toEqual(expect.arrayContaining(['HEAD_CONFLICT', 'LINE_ORDER']));
  });
  test('字典缺失、重复、未知代码分别拒绝，不以目标名称代替原类型', () => {
    const d = syntheticNative();
    table(d, 'pzlx').rows.push(['3', '收', '收款']);
    expect(codes(d)).toContain('TYPE_DUPLICATE');
    table(d, 'pzlx').rows = [['4', '记', '记账']];
    expect(codes(d)).toContain('TYPE_UNKNOWN');
    d.tables = d.tables.filter((t) => t.name !== 'pzlx');
    expect(codes(d)).toContain('TABLE_MISSING');
  });
  test.each([
    ['pzdj_rq', '2026-02-30', 'DATE_INVALID'],
    ['pzdj_rq', '2026-02-05', 'DATE_PERIOD_MISMATCH'],
    ['pzdj_shrq', '2026-01-04', 'DATE_ORDER'],
    ['pzdj_jzrq', '2026-01-05', 'DATE_ORDER'],
    ['pzdj_rq', '01/05/2026', 'DATE_INVALID'],
    ['pzdj_rq', null, 'DATE_MISSING'],
  ])('日期 %s=%s 拒绝 %s', (f, v, code) => {
    const d = syntheticNative();
    cell(table(d, 'pzdj'), 0, f!, v);
    expect(codes(d)).toContain(code);
  });
  test('行日与头日期冲突、不连续行序及超限原编号均拒绝', () => {
    const d = syntheticNative();
    const p = table(d, 'pz');
    cell(p, 1, 'dd', '6');
    cell(p, 1, 'pz_xh', '3');
    cell(p, 1, 'pzbh', '10001');
    expect(codes(d)).toContain('INTEGER_INVALID');
    cell(p, 1, 'pzbh', '7');
    expect(codes(d)).toEqual(expect.arrayContaining(['DAY_MISMATCH', 'LINE_ORDER']));
  });
  test.each([
    'pz_wb',
    'pz_hl',
    'pz_sl',
    'pz_dj',
    'xmbm',
    'dwbm',
    'bmbm',
    'grbm',
    'xjbm',
    'bz',
    'dw',
    'jzbz',
    'jslb',
    'pz_ph',
    'bz1',
  ])('不支持原字段 %s 即使为零也阻断并保留', (f) => {
    const d = syntheticNative();
    cell(table(d, 'pz'), 0, f, '0');
    const r = run(d);
    expect(r.issues).toContainEqual(
      expect.objectContaining({ code: 'NATIVE_FIELD_UNSUPPORTED', table: 'pz', row: 1, field: f }),
    );
    expect(r.records[0]!.values[f]).toBe('0');
    expect(r.migrationAllowed).toBe(false);
  });
  test.each(['pzdj_zdr', 'pzdj_shr', 'pzdj_jzr'])('历史人员 %s 不冒充当前用户', (f) => {
    const d = syntheticNative();
    cell(table(d, 'pzdj'), 0, f, 'OLD-001');
    expect(codes(d)).toContain('HISTORICAL_PERSON_UNSUPPORTED');
  });
  test.each(['0.001', '123.450', '1e2', '1,000', ' 123.45', '', null, '90071992547409.92'])(
    '金额 %s 不猜测、不舍入、不截断',
    (value) => {
      const d = syntheticNative();
      cell(table(d, 'pz'), 0, 'pz_jf', value);
      const r = run(d);
      expect(r.vouchers[0]!.debitCents).toBeNull();
      expect(r.issues.some((i) => ['AMOUNT_PRECISION', 'AMOUNT_RANGE'].includes(i.code))).toBe(
        true,
      );
    },
  );
  test('单位元/分必须显式；数值相同不能被猜作同一金额，未知单位不计算', () => {
    const d = syntheticNative();
    const p = table(d, 'pz');
    cell(p, 0, 'pz_jf', '12345');
    cell(p, 1, 'pz_df', '12345');
    expect(run(d).vouchers[0]!.debitCents).toBe('1234500');
    d.source.amountUnit = 'fen';
    expect(run(d).vouchers[0]!.debitCents).toBe('12345');
    d.source.amountUnit = 'unknown';
    expect(run(d).vouchers[0]!.debitCents).toBeNull();
    expect(codes(d)).toContain('AMOUNT_UNIT_UNKNOWN');
  });
  test('double、未知字节及币种不能冒充兼容', () => {
    const d = syntheticNative();
    d.source.amountEncoding = 'unverified-double';
    d.source.decoding = 'unknown-original-bytes';
    d.source.currency = 'USD';
    expect(codes(d)).toEqual(
      expect.arrayContaining(['DOUBLE_UNVERIFIED', 'BYTE_FORMAT_UNKNOWN', 'CURRENCY_UNSUPPORTED']),
    );
    expect(run(d).vouchers[0]!.debitCents).toBeNull();
  });
  test('借贷不平、双侧与零分录拒绝，合计不能越过安全整数分', () => {
    const d = syntheticNative();
    const p = table(d, 'pz');
    cell(p, 1, 'pz_df', '123.44');
    expect(codes(d)).toContain('VOUCHER_UNBALANCED');
    cell(p, 0, 'pz_df', '1');
    expect(codes(d)).toContain('AMOUNT_SIDE');
    for (const [index, r] of p.rows.entries()) {
      r[p.columns.indexOf('pz_jf')] = '90071992547409.91';
      r[p.columns.indexOf('pz_df')] = '0';
      r[p.columns.indexOf('pz_xh')] = String(index + 1);
    }
    expect(codes(d)).toContain('TOTAL_RANGE');
  });
  test('合成任意整数分与红字，十进制文本转分严格相等', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100000000, max: 100000000 }).filter((n) => n !== 0),
        (n) => {
          const text = `${n < 0 ? '-' : ''}${Math.floor(Math.abs(n) / 100)}.${String(Math.abs(n) % 100).padStart(2, '0')}`;
          const d = syntheticNative();
          cell(table(d, 'pz'), 0, 'pz_jf', text);
          cell(table(d, 'pz'), 1, 'pz_df', text);
          const r = run(d);
          expect(r.structurePassed).toBe(true);
          expect(r.vouchers[0]!.debitCents).toBe(String(n));
          expect(r.vouchers[0]!.creditCents).toBe(String(n));
        },
      ),
    );
  });
  test('未知列/表即使为空也拒绝，重复列原始数组完整保留', () => {
    const d = syntheticNative();
    const p = table(d, 'pz');
    p.columns.push('htbh');
    p.rows.forEach((r) => r.push(null));
    expect(codes(d)).toContain('FIELD_UNSUPPORTED');
    p.columns.push('pz_jf');
    p.rows.forEach((r) => r.push('999'));
    expect(codes(d)).toContain('COLUMN_DUPLICATE');
    expect(run(d).document).toEqual(d);
    d.tables.push({ name: 'kmbm', columns: ['kmbm'], rows: [['1001']] });
    expect(codes(d)).toContain('TABLE_UNSUPPORTED');
  });
  test('异常输入、浮点 JSON、缺格、超限及空表有可见阻断报告', () => {
    expect(nativePreflight({ name: 'old.txt', text: 'unknown bytes ~t' }).issues[0]!.code).toBe(
      'EXPLICIT_ROWS_REQUIRED',
    );
    const d = syntheticNative();
    const p = table(d, 'pz');
    p.rows[0]!.pop();
    expect(codes(d)).toContain('ROW_WIDTH');
    p.rows = [];
    expect(codes(d)).toContain('TABLE_EMPTY');
    const numeric = JSON.stringify(syntheticNative()).replace('"123.45"', '123.45');
    expect(nativePreflight({ name: 'float.json', text: numeric }).issues[0]!.code).toBe(
      'ROW_DOCUMENT_INVALID',
    );
    expect(nativePreflight({ name: 'large.json', text: '中'.repeat(100000) }).issues[0]!.code).toBe(
      'SOURCE_LIMIT',
    );
  });
  test('kmbm 原字符标识不误判成数字编码，不据此证明目标科目有效', () => {
    const d = syntheticNative();
    cell(table(d, 'pz'), 0, 'kmbm', 'A001');
    const r = run(d);
    expect(r.structurePassed).toBe(true);
    expect(r.records[0]!.values.kmbm).toBe('A001');
    expect(r.document).toEqual(d);
    expect(r.migrationAllowed).toBe(false);
  });
  test('日期与四键核对，不自造 1900 年下限或把历史年份改成目标年度', () => {
    const d = syntheticNative();
    for (const t of d.tables.filter((t) => t.name !== 'pzlx')) {
      for (const [index] of t.rows.entries()) cell(t, index, 'nf', '1899');
    }
    cell(table(d, 'pzdj'), 0, 'pzdj_rq', '1899-01-05');
    cell(table(d, 'pzdj'), 0, 'pzdj_shrq', '1899-01-06');
    const r = run(d);
    expect(r.structurePassed).toBe(true);
    expect(r.vouchers[0]!.key).toBe('1899/1/3/7');
    expect(r.migrationAllowed).toBe(false);
  });
  test('pzlx 字典是 integer，未被分录引用的代码不错误套用 pz.smallint 上限', () => {
    const d = syntheticNative();
    table(d, 'pzlx').rows.push(['40000', '保留', '虚构保留类型']);
    const r = run(d);
    expect(r.structurePassed).toBe(true);
    expect(r.records.at(-1)!.values.pzlx).toBe('40000');
    expect(r.vouchers[0]!.typeName).toBe('记');
    expect(r.migrationAllowed).toBe(false);
  });
  test('已有真实已过账凭证及余额的账套也完全不变，不把原生预检当覆盖或迁移', async () => {
    const app = await createTestApp({ modules: [server] });
    apps.push(app);
    await seedVouchers(app.svc, [
      {
        date: '2026-01-08',
        status: 'posted',
        lines: [
          { account: '1001', debit: 98765 },
          { account: '6001', credit: 98765 },
        ],
      },
    ]);
    const before = await state(app);
    const api = app.call(server);
    expect(
      await api.nativePreflight({
        name: 'synthetic.json',
        text: JSON.stringify(syntheticNative()),
      }),
    ).toMatchObject({ migrationAllowed: false, targetChanges: 0 });
    expect(await state(app)).toEqual(before);
    expect(await api.list()).toEqual([]);
  });
  test('真实接口正常/异常只读，所有持久表完全一致，权限拒绝；不产生可执行批次', async () => {
    const app = await createTestApp({ modules: [server] });
    apps.push(app);
    const api = app.call(server);
    const before = await state(app);
    const request = { name: 'synthetic.json', text: JSON.stringify(syntheticNative()) };
    expect(await api.nativePreflight(request)).toMatchObject({
      structurePassed: true,
      migrationAllowed: false,
      targetChanges: 0,
    });
    expect(await api.nativePreflight({ ...request, text: 'not JSON' })).toMatchObject({
      structurePassed: false,
      migrationAllowed: false,
    });
    expect(await api.list()).toEqual([]);
    expect(await state(app)).toEqual(before);
    const user = await app.addUser('native-viewer', { permissions: ['legacy-import.view'] });
    const deniedBefore = await state(app);
    await expect(app.call(server, user).nativePreflight(request)).rejects.toThrow();
    expect(await state(app)).toEqual(deniedBefore);
  });
});
