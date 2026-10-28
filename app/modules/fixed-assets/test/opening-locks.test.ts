import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import server from '../server';
import type { CardInput } from '../shared';

let app: TestApp;
let api: ReturnType<TestApp['call']> & ReturnType<typeof caller>;
const caller = (value: TestApp) => value.call(server);
let rows: { row: number; data: CardInput }[];

beforeEach(async () => {
  app = await createTestApp({ modules: [server], product: 'minfei', startMonth: 3 });
  api = caller(app) as typeof api;
  const categoryId = await api.saveMaster({
    data: { kind: 'category', code: '01', name: '办公设备' },
  });
  const purposeId = await api.saveMaster({
    data: { kind: 'purpose', code: '01', name: '管理用' },
  });
  const statusId = await api.saveMaster({
    data: { kind: 'status', code: '01', name: '在用' },
  });
  rows = [
    {
      row: 2,
      data: {
        code: 'OPEN-001',
        name: '资产期初保护测试设备',
        categoryId,
        purposeId,
        statusId,
        departmentId: (await app.svc.dimensions.getByCode('department', '01'))!.id,
        acquired: '2025-01-01',
        useDate: '2025-01-01',
        original: 600_000,
        rate: '0',
        method: '1',
        lifeMonths: 60,
        openingDepreciation: 120_000,
        openingMonths: 12,
      },
    },
  ];
});

afterEach(async () => app.close());

async function setBlocked(kind: 'opening' | 'period' | 'year', blocked: boolean) {
  if (kind === 'opening') {
    await app.svcFor('opening').settings.set('lock.2026', blocked);
  } else if (kind === 'period') {
    await app.svc.periods.setStatus(app.book.startPeriod, blocked ? 'closed' : 'open');
  } else {
    await app.svc.db
      .updateTable('fiscal_year')
      .set({ status: blocked ? 'closed' : 'open' })
      .where('year', '=', 2026)
      .execute();
  }
}

describe('w_xt_kgzb_zc：资产期初导入的期间与锁定保护', () => {
  it.each([
    ['opening', '期初锁定', /期初已锁定/],
    ['period', '启用月结账', /已经结账/],
    ['year', '年度年结', /已经年结/],
  ] as const)(
    '%s：%s阻止预览，预览后锁定阻止确认，解除后可用原数据重试',
    async (kind, _, message) => {
      await setBlocked(kind, true);
      await expect(api.importPreview({ rows })).rejects.toThrow(message);
      expect(await api.list({ includeDisposed: true })).toHaveLength(0);

      await setBlocked(kind, false);
      const preview = await api.importPreview({ rows });
      expect(preview.valid).toBe(true);
      expect(preview.count).toBe(1);

      await setBlocked(kind, true);
      await expect(
        api.importConfirm({ rows, token: preview.token, confirm: true }),
      ).rejects.toThrow(message);
      expect(await api.list({ includeDisposed: true })).toHaveLength(0);
      expect(await app.svcFor('fixed-assets').settings.get('enabled', false)).toBe(false);

      await setBlocked(kind, false);
      expect(await api.importConfirm({ rows, token: preview.token, confirm: true })).toEqual({
        imported: 1,
        skipped: 0,
      });
      const cards = await api.list({ includeDisposed: true });
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({
        code: 'OPEN-001',
        depreciation: 120_000,
        opening_months: 12,
      });
    },
  );
});
