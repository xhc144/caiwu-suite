import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import server from '../server';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [server] });
});
afterEach(async () => app.close());
const native = (year = 2026, month = 1) => ({
  name: '原凭证文本.csv',
  kind: 'vouchers' as const,
  contentBase64: Buffer.from(
    `nf,yf,pzlx,pzbh,pzdj_pzdj_rq,kmbm,pz_zy,pz_jf,pz_df\n${year},${month},3,7,2026-01-03,1601,迁移原表借方,1.23,\n${year},${month},3,7,2026-01-03,4001,迁移原表贷方,,1.23`,
  ).toString('base64'),
  valueMap: { pzlx: { '3': '记' } },
});

describe('w_pz_get 原版导出列与字典适配', () => {
  it('只依据明确值对应转换原凭证类型，并保留上传文件与原字段', async () => {
    const api = app.call(server),
      file = native();
    const prepared = await api.prepare({ name: '原版列名适配', files: [file] });
    const checked = await api.preflight({ id: prepared.id });
    expect(checked.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(checked.summary.vouchers).toBe(1);
    expect((await app.svc.vouchers.list({})).total).toBe(0);
    const done = await api.commit({ id: checked.id, revision: checked.revision, confirmed: true });
    const voucher = await app.svc.vouchers.get(done.receipt!.vouchers[0]!.id);
    expect(voucher).toMatchObject({
      voucherTypeCode: '记',
      debitTotal: 123,
      creditTotal: 123,
      date: '2026-01-03',
    });
    expect(await api.originalExport({ id: prepared.id, index: 0 })).toEqual({
      name: file.name,
      contentBase64: file.contentBase64,
    });
  });

  it.each([
    [2025, 1, '年度'],
    [2026, 2, '月份'],
  ])('来源年月%s/%s与日期冲突时拒绝并指出源列', async (year, month, column) => {
    const api = app.call(server),
      before = await app.svc.vouchers.list({});
    const prepared = await api.prepare({
      name: '冲突来源年月',
      files: [native(Number(year), Number(month))],
    });
    const checked = await api.preflight({ id: prepared.id });
    expect(checked.status).toBe('failed');
    expect(checked.issues).toContainEqual(
      expect.objectContaining({
        row: 2,
        column,
        message: expect.stringMatching(/与凭证日期不一致/),
      }),
    );
    expect(await app.svc.vouchers.list({})).toEqual(before);
  });

  it('未提供原类型字典时不猜测数字类型', async () => {
    const api = app.call(server),
      file = native();
    const prepared = await api.prepare({
      name: '未知类型字典',
      files: [{ ...file, valueMap: {} }],
    });
    const checked = await api.preflight({ id: prepared.id });
    expect(checked.status).toBe('failed');
    expect(checked.issues).toContainEqual(
      expect.objectContaining({
        row: 2,
        column: '凭证字',
        message: expect.stringMatching(/不存在/),
      }),
    );
  });
  it('相同文件改名重复上传仍会拒绝，不留下半个暂存批次', async () => {
    const api = app.call(server),
      file = native();
    await expect(
      api.prepare({ name: '误重复源', files: [file, { ...file, name: '误复制.csv' }] }),
    ).rejects.toThrow('内容完全相同');
    expect(await api.list({})).toEqual([]);
  });
  it('同一原凭证分散在两个来源表时拒绝，防止重复导出合并成双倍金额', async () => {
    const api = app.call(server),
      file = native();
    const second = {
      ...file,
      name: '第二个来源.csv',
      contentBase64: Buffer.from(
        Buffer.from(file.contentBase64, 'base64').toString('utf8').replaceAll('原表', '重复原表'),
      ).toString('base64'),
    };
    const prepared = await api.prepare({ name: '重复凭证来源', files: [file, second] });
    const checked = await api.preflight({ id: prepared.id });
    expect(checked.status).toBe('failed');
    expect(checked.issues).toContainEqual(
      expect.objectContaining({
        file: '第二个来源.csv',
        row: 2,
        column: '凭证号',
        message: expect.stringContaining('多份来源表'),
      }),
    );
    expect((await app.svc.vouchers.list({})).total).toBe(0);
  });
});
