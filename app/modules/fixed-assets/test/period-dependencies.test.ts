import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import server from '../server';

const caller = (app: TestApp) => app.call(server);
let app: TestApp;
let api: ReturnType<typeof caller>;
let statusId: number;

beforeEach(async () => {
  app = await createTestApp({ modules: [server], product: 'minfei' });
  api = caller(app);
  const categoryId = await api.saveMaster({
    data: {
      kind: 'category',
      code: '01',
      name: '办公设备',
      accountId: (await app.svc.accounts.require('1601')).id,
    },
  });
  const purposeId = await api.saveMaster({
    data: {
      kind: 'purpose',
      code: '01',
      name: '管理用',
      accountId: (await app.svc.accounts.require('6602')).id,
    },
  });
  statusId = await api.saveMaster({
    data: { kind: 'status', code: '01', name: '在用', depreciates: true },
  });
  await api.saveSettings({
    depreciationAccountId: (await app.svc.accounts.require('1602')).id,
    clearingAccountId: (await app.svc.accounts.require('1601')).id,
    voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
  });
  await api.save({
    data: {
      code: 'CLOSE-001',
      name: '计提结账测试设备',
      categoryId,
      purposeId,
      statusId,
      departmentId: (await app.svc.dimensions.getByCode('department', '01'))!.id,
      acquired: '2026-01-01',
      useDate: '2026-01-01',
      original: 60_000,
      rate: '0',
      method: '1',
      lifeMonths: 60,
    },
  });
});

afterEach(async () => app.close());

async function depreciate(period: number) {
  const preview = await api.preview({ period });
  return api.depreciate({ period, token: preview.token, confirm: true });
}

describe('w_zjjs：零折旧批次及制证依赖', () => {
  it('购入当月零折旧已完成计提，无须虚构凭证即可结账', async () => {
    const id = await depreciate(202601);
    expect((await api.batches()).find((batch) => batch.id === id)).toMatchObject({
      total: 0,
      requiresVoucher: false,
      voucher_id: null,
    });
    await expect(api.voucherPreview({ id })).rejects.toThrow('无折旧数据，不能生成凭证');
    await app.svc.periods.setStatus(202601, 'closed');
    expect((await app.svc.periods.require(202601)).status).toBe('closed');
  });

  it('非零折旧未制证不能结账，失败保留开放状态，生成凭证后解除依赖', async () => {
    const id = await depreciate(202602);
    expect((await api.batches()).find((batch) => batch.id === id)).toMatchObject({
      total: 1000,
      requiresVoucher: true,
      voucher_id: null,
    });
    await expect(app.svc.periods.setStatus(202602, 'closed')).rejects.toThrow('未制证折旧批次');
    expect((await app.svc.periods.require(202602)).status).toBe('open');
    const preview = await api.voucherPreview({ id });
    const voucher = await api.generateVoucher({ id, token: preview.token });
    expect((await api.batches()).find((batch) => batch.id === id)?.voucher_id).toBe(voucher.id);
    await app.svc.periods.setStatus(202602, 'closed');
    expect((await app.svc.periods.require(202602)).status).toBe('closed');
  });

  it('后续零批次不能解除前月非零批次的制证依赖，普通业务检查不受结账依赖阻挡', async () => {
    await depreciate(202602);
    await api.saveMaster({
      id: statusId,
      data: { kind: 'status', code: '01', name: '不计提', depreciates: false },
    });
    const marchId = await depreciate(202603);
    expect((await api.batches()).find((batch) => batch.id === marchId)?.requiresVoucher).toBe(
      false,
    );
    await app.svc.periods.assertWritable({ period: 202602, mode: 'business' });
    await expect(app.svc.periods.setStatus(202602, 'closed')).rejects.toThrow('未制证折旧批次');
    expect((await app.svc.periods.require(202602)).status).toBe('open');
    await app.svc.periods.setStatus(202603, 'closed');
    expect((await app.svc.periods.require(202603)).status).toBe('closed');
  });
});
