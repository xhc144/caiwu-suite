import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import server from '../server';
import type { CardInput } from '../shared';

const caller = (app: TestApp) => app.call(server);
let app: TestApp;
let api: ReturnType<typeof caller>;
let id: number;
let data: CardInput;

beforeEach(async () => {
  app = await createTestApp({ modules: [server], product: 'minfei' });
  api = caller(app);
  const categoryId = await api.saveMaster({
    data: { kind: 'category', code: '01', name: '办公设备' },
  });
  const purposeId = await api.saveMaster({
    data: { kind: 'purpose', code: '01', name: '管理用' },
  });
  const statusId = await api.saveMaster({
    data: { kind: 'status', code: '01', name: '在用' },
  });
  data = {
    code: 'BATCH-001',
    name: '统一置数测试设备',
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
    unit: '台',
  };
  id = await api.save({ data });
});

afterEach(async () => app.close());

describe('w_zcgl_zs：统一置数保持资产卡片字段约束', () => {
  it('超长单位拒绝预览和确认，不改变卡片及版本', async () => {
    const valid = { filter: { id }, field: 'unit' as const, value: '套' };
    const preview = await api.batchPreview(valid);
    const before = await api.detail({ id });
    const invalid = { ...valid, value: '计'.repeat(21) };
    await expect(api.batchPreview(invalid)).rejects.toThrow('单位不能超过 20 个字');
    await expect(
      api.batchApply({ data: invalid, token: preview.token, confirm: true }),
    ).rejects.toThrow('单位不能超过 20 个字');
    expect((await api.detail({ id })).card).toEqual(before.card);
  });

  it.each([
    ['unit', '计量单位'.repeat(5)],
    ['model', '型'.repeat(500)],
  ] as const)('%s字段在长度上限可批量保存，随后卡片仍能正常编辑保存', async (field, value) => {
    const batch = { filter: { id }, field, value };
    const preview = await api.batchPreview(batch);
    expect(await api.batchApply({ data: batch, token: preview.token, confirm: true })).toEqual({
      changed: 1,
      skipped: [],
    });
    const current = (await api.detail({ id })).card;
    expect(current[field]).toBe(value);
    await api.save({
      id,
      revision: current.revision,
      data: { ...data, [field]: value, name: '批量置数后继续编辑' },
    });
    expect((await api.detail({ id })).card.name).toBe('批量置数后继续编辑');
  });
});
