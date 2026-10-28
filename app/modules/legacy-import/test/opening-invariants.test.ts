import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import server from '../server';
import type { ImportKind } from '../shared';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
});
afterEach(async () => app.close());
function file(kind: ImportKind, rows: string[][]) {
  return {
    name: `${kind}.csv`,
    kind,
    contentBase64: Buffer.from(
      rows.map((row) => row.map((c) => `"${c.replaceAll('"', '""')}"`).join(',')).join('\n'),
    ).toString('base64'),
  };
}
async function check(rows: string[][]) {
  const api = app.call(server);
  const prepared = await api.prepare({ name: '期初约束', files: [file('opening', rows)] });
  return api.preflight({ id: prepared.id });
}

describe('w_xt_ye / w_bb_saveas 期初及科目一致性', () => {
  it('1月启用的来源累计即使借贷平衡也不能混入期初', async () => {
    const checked = await check([
      ['科目编码', '期初余额', '累计借方', '累计贷方'],
      ['1601', '1', '1', '0'],
      ['4001', '-1', '0', '1'],
    ]);
    expect(checked.status).toBe('failed');
    expect(checked.issues.some((i) => i.message.includes('1月启用'))).toBe(true);
    expect(await app.svc.opening.list(2026)).toEqual([]);
  });
  it('年中启用允许精确承接启用前累计，预检后仍不写入', async () => {
    await app.close();
    app = await createTestApp({ modules: [server], startMonth: 7 });
    const checked = await check([
      ['科目编码', '期初余额', '累计借方', '累计贷方'],
      ['1601', '3', '2', '0'],
      ['4001', '-3', '0', '2'],
    ]);
    expect(checked.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(await app.svc.opening.list(2026)).toEqual([]);
    await app.call(server).commit({ id: checked.id, revision: checked.revision, confirmed: true });
    expect(
      (await app.svc.opening.list(2026)).map((r) => [r.balance, r.ytdDebit, r.ytdCredit]),
    ).toEqual([
      [300, 200, 0],
      [-300, 0, 200],
    ]);
  });
  it('辅助汇总行与辅助明细即使合计平衡也拒绝双计', async () => {
    const checked = await check([
      ['科目编码', '部门编码', '期初余额'],
      ['6601', '', '1'],
      ['6601', '01', '1'],
      ['4001', '', '-2'],
    ]);
    expect(checked.status).toBe('failed');
    expect(checked.issues.some((i) => i.message.includes('无辅助汇总行'))).toBe(true);
    expect(await app.svc.opening.list(2026)).toEqual([]);
  });
  it('未配置的辅助核算不能通过导入附在期初上', async () => {
    const checked = await check([
      ['科目编码', '部门编码', '期初余额'],
      ['1601', '01', '1'],
      ['4001', '', '-1'],
    ]);
    expect(checked.status).toBe('failed');
    expect(checked.issues).toContainEqual(
      expect.objectContaining({
        row: 2,
        column: '部门编码',
        message: expect.stringContaining('未启用部门'),
      }),
    );
  });
  it('年度后续月份已结账，即使启用月开放也拒绝改期初', async () => {
    await app.svc.periods.setStatus(202603, 'closed');
    const checked = await check([
      ['科目编码', '期初余额'],
      ['1601', '1'],
      ['4001', '-1'],
    ]);
    expect(checked.status).toBe('failed');
    expect(checked.issues.some((i) => i.message.includes('已有结账期间'))).toBe(true);
  });
  it('年度总额溢出不会用借贷相抵掩盖，整体回滚', async () => {
    const checked = await check([
      ['科目编码', '期初余额'],
      ['1601', '50000000000000.00'],
      ['4001', '-50000000000000.00'],
    ]);
    expect(checked.status).toBe('failed');
    expect(checked.issues.some((i) => i.message.includes('合计超出'))).toBe(true);
    expect(await app.svc.opening.list(2026)).toEqual([]);
  });
  it('科目类别不能跨父级，现金及银行标志不能同时启用', async () => {
    const api = app.call(server);
    const prepared = await api.prepare({
      name: '科目矛盾',
      files: [
        file('accounts', [
          ['科目编码', '科目名称', '科目类别', '现金科目', '银行科目'],
          ['9191', '合成现金根', '资产', '是', '是'],
          ['100203', '合成错误分类明细', '负债', '否', '否'],
        ]),
      ],
    });
    const checked = await api.preflight({ id: prepared.id });
    expect(checked.status).toBe('failed');
    expect(checked.issues.some((i) => i.message.includes('同时标为现金和银行'))).toBe(true);
    expect(checked.issues.some((i) => i.message.includes('类别必须与上级一致'))).toBe(true);
    expect(await app.svc.accounts.getByCode('9191')).toBeNull();
    expect(await app.svc.accounts.getByCode('100203')).toBeNull();
  });
});
