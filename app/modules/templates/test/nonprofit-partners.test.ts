import { integrationModules } from './template-fixtures';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { defineManifest, parseTemplate, VoucherInputSchema, type VoucherInput } from '@caiwu/core';
import { createCoreServices, loadServiceUser } from '@caiwu/core/server';
import { createRuntime, defineServerModule, moduleKit } from '@caiwu/server-kit';
import { createTestApp, voucherInputFromSpec } from '@caiwu/testkit';
import templatesServer from '../server';

// 各项分别来自 nonprofit-2026.pdf 科目说明，不能从被测JSON生成这个集合。
const partnerAccounts = [
  { code: '1121', name: '应收账款', direction: 'debit', page: 65, clause: '第四项' },
  { code: '1141', name: '预付账款', direction: 'debit', page: 69, clause: '第四项' },
  { code: '2202', name: '应付账款', direction: 'credit', page: 96, clause: '第三项' },
  { code: '2203', name: '预收账款', direction: 'credit', page: 96, clause: '第三项' },
] as const;
const setup = () =>
  createTestApp({ modules: [...integrationModules], templateId: 'nonprofit-2026', seed: false });

it('w_xt_kgzb_a2：2026适用版本与四项原文定位明确，不把全部明细宣称为完成', () => {
  const template = parseTemplate(templatesServer.templates[0]);
  expect(template.version).toBe('1.2.0');
  expect(template.description).toContain('2026年1月1日');
  expect(template.description).toContain('限定/非限定');
  expect(template.description).toContain('不自动修改已有账套');
  expect(template.accounts.filter((a) => a.partner).map((a) => a.code)).toEqual(
    partnerAccounts.map((a) => a.code),
  );
  for (const expected of partnerAccounts) {
    const account = template.accounts.find((a) => a.code === expected.code)!;
    expect(account).toMatchObject({
      code: expected.code,
      name: expected.name,
      direction: expected.direction,
      dimensions: [{ type: 'partner', required: true }],
      needsReview: false,
    });
    expect(account.source).toContain(`PDF第${expected.page}页${expected.clause}`);
    expect(account.source).toContain('应用映射');
  }
});

describe.each(partnerAccounts)('w_xt_kgzb_3：$code $name 必填往来', (expected) => {
  it('真实建账保持方向/父级；无对象拒绝，带对象正式保存后可按对象核账', async () => {
    const app = await setup();
    try {
      const account = await app.svc.accounts.require(expected.code);
      expect(account).toMatchObject({
        direction: expected.direction,
        level: 1,
        parentId: null,
        isLeaf: true,
        isPartner: true,
        dimensions: [{ type: 'partner', required: true, defaultItemId: null }],
      });
      expect(await app.svc.dimensions.items()).toEqual([]);
      const party = await app.svc.dimensions.create({
        type: 'partner',
        code: 'D01',
        name: '测试往来对象',
      });
      const debit = expected.direction === 'debit';
      const raw = await voucherInputFromSpec(app.svc, {
        date: '2026-01-05',
        lines: [
          { account: expected.code, debit: debit ? 1 : 0, credit: debit ? 0 : 1 },
          { account: '1002', debit: debit ? 0 : 1, credit: debit ? 1 : 0 },
        ],
      });
      await expect(app.svc.vouchers.create(raw)).rejects.toMatchObject({
        data: { code: 'VOUCHER_INVALID' },
      });
      expect((await app.svc.vouchers.list({})).total).toBe(0);
      const saved = await app.svc.vouchers.create({
        ...raw,
        lines: raw.lines.map((line, i) =>
          i === 0 ? { ...line, dimensions: { partner: party.id } } : line,
        ),
      });
      expect(saved.number).toBe(1);
      expect(saved.debitTotal).toBe(1);
      expect(saved.creditTotal).toBe(1);
      expect(saved.lines[0]?.dimensions.partner).toBe(party.id);
      await app.svc.vouchers.changeStatus({ ids: [saved.id], to: 'audited' });
      await app.svc.vouchers.changeStatus({ ids: [saved.id], to: 'posted' });
      const balances = await app.svc.ledger.balances({
        periodFrom: 202601,
        periodTo: 202601,
        accountCodes: [expected.code],
        groupBy: ['partner'],
      });
      expect(balances).toHaveLength(1);
      expect(balances[0]).toMatchObject({
        dimensions: { partner: party.id },
        closing: debit ? 1 : -1,
      });
    } finally {
      await app.close();
    }
  });
});

it('w_xt_kgzb_3：错误类型/不存在/停用/非末级对象被拒绝，草稿转正式和修改不能清除必填对象', async () => {
  const app = await setup();
  try {
    const other = await app.svc.dimensions.create({
      type: 'person',
      code: 'P01',
      name: '测试个人',
    });
    const disabled = await app.svc.dimensions.create({
      type: 'partner',
      code: 'D00',
      name: '停用对象',
      disabled: true,
    });
    const parent = await app.svc.dimensions.create({
      type: 'partner',
      code: 'G',
      name: '对象分组',
    });
    const valid = await app.svc.dimensions.create({
      type: 'partner',
      code: 'D01',
      name: '有效对象',
      parentId: parent.id,
    });
    const raw = await voucherInputFromSpec(app.svc, {
      date: '2026-01-05',
      lines: [
        { account: '1121', debit: 101 },
        { account: '430101', credit: 101 },
      ],
    });
    const withParty = (id?: number): VoucherInput => ({
      ...raw,
      lines: raw.lines.map((line, i) =>
        i === 0 ? { ...line, dimensions: id ? { partner: id } : {} } : line,
      ),
    });
    for (const id of [other.id, disabled.id, parent.id, 999_999]) {
      await expect(app.svc.vouchers.create(withParty(id))).rejects.toMatchObject({
        data: { code: 'VOUCHER_INVALID' },
      });
    }
    expect((await app.svc.vouchers.list({})).total).toBe(0);
    const draft = await app.svc.vouchers.create({ ...withParty(), draft: true });
    await expect(
      app.svc.vouchers.update(draft.id, withParty(), { expectedRevision: draft.revision }),
    ).rejects.toMatchObject({ data: { code: 'VOUCHER_INVALID' } });
    expect(await app.svc.vouchers.get(draft.id)).toEqual(draft);
    const saved = await app.svc.vouchers.update(draft.id, withParty(valid.id), {
      expectedRevision: draft.revision,
    });
    await expect(
      app.svc.vouchers.update(saved.id, withParty(), { expectedRevision: saved.revision }),
    ).rejects.toMatchObject({ data: { code: 'VOUCHER_INVALID' } });
    expect(await app.svc.vouchers.get(saved.id)).toEqual(saved);
  } finally {
    await app.close();
  }
});

it('w_xt_kgzb_3：事务后段SQLite失败不留凭证/分录，重试有效输入仍从1号开始', async () => {
  const app = await setup();
  try {
    await app.svc.dimensions.create({ type: 'partner', code: 'D01', name: '测试对象' });
    const raw = await voucherInputFromSpec(app.svc, {
      date: '2026-01-05',
      lines: [
        { account: '1121', debit: 101, dims: { partner: 'D01' } },
        { account: '430101', credit: 101 },
      ],
    });
    const db = app.runtime.bookStore.open(app.book.id).raw;
    db.exec(
      "CREATE TRIGGER fail_last_line BEFORE INSERT ON voucher_line WHEN NEW.line_no = 2 BEGIN SELECT RAISE(ABORT, 'test-last-line'); END",
    );
    await expect(app.svc.vouchers.create(raw)).rejects.toThrow(/test-last-line/);
    expect(await app.svc.db.selectFrom('voucher').selectAll().execute()).toEqual([]);
    expect(await app.svc.db.selectFrom('voucher_line').selectAll().execute()).toEqual([]);
    db.exec('DROP TRIGGER fail_last_line');
    expect((await app.svc.vouchers.create(raw)).number).toBe(1);
  } finally {
    await app.close();
  }
});

it('w_xt_kgzb_3：两个往来对象的整数分汇总与科目余额一致（fast-check）', async () => {
  const app = await setup();
  try {
    for (const code of ['A', 'B'])
      await app.svc.dimensions.create({ type: 'partner', code, name: `测试对象${code}` });
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 2, maxLength: 8 }),
        async (amounts) => {
          const ids: number[] = [];
          try {
            for (const [index, amount] of amounts.entries()) {
              const raw = await voucherInputFromSpec(app.svc, {
                date: '2026-01-05',
                lines: [
                  { account: '1121', debit: amount, dims: { partner: index % 2 ? 'B' : 'A' } },
                  { account: '430101', credit: amount },
                ],
              });
              ids.push((await app.svc.vouchers.create(raw)).id);
            }
            const query = {
              periodFrom: 202601,
              periodTo: 202601,
              accountCodes: ['1121'],
              includeUnposted: true,
            };
            const total = amounts.reduce((sum, amount) => sum + BigInt(amount), 0n);
            const grouped = await app.svc.ledger.balances({ ...query, groupBy: ['partner'] });
            expect(grouped).toHaveLength(2);
            expect(grouped.reduce((sum, row) => sum + BigInt(row.closing), 0n)).toBe(total);
            expect((await app.svc.ledger.balances(query))[0]?.closing).toBe(Number(total));
            for (const [index, code] of ['A', 'B'].entries()) {
              const party = (await app.svc.dimensions.getByCode('partner', code))!;
              const expected = amounts
                .filter((_, i) => i % 2 === index)
                .reduce((sum, amount) => sum + amount, 0);
              expect(grouped.find((row) => row.dimensions.partner === party.id)?.closing).toBe(
                expected,
              );
            }
          } finally {
            for (const id of ids) await app.svc.vouchers.delete(id);
          }
        },
      ),
      { numRuns: 20 },
    );
  } finally {
    await app.close();
  }
});

const fixtureManifest = defineManifest({
  id: 'templates-fixture',
  name: '模板测试凭证入口',
  products: 'all',
  permissions: [{ id: 'templates-fixture.write', name: '保存测试凭证' }],
  sources: [{ type: 'document', name: '测试来源', path: '/documents/{id}' }],
});
const kit = moduleKit(fixtureManifest);
const fixtureModule = defineServerModule(fixtureManifest, {
  router: kit.router({
    save: kit.procedure
      .meta({ permission: 'templates-fixture.write' })
      .input(VoucherInputSchema)
      .mutation(({ ctx, input }) => ctx.svc.vouchers.create(input)),
  }),
});

it('w_xt_kgzb_3：模板字段不绕过权限/来源锁；账套覆盖拒绝并保留在线备份', async () => {
  const app = await createTestApp({
    modules: [...integrationModules, fixtureModule],
    templateId: 'nonprofit-2026',
    seed: false,
  });
  try {
    const raw = await voucherInputFromSpec(app.svc, {
      date: '2026-01-05',
      lines: [
        { account: '1121', debit: 101 },
        { account: '430101', credit: 101 },
      ],
    });
    const party = await app.svc.dimensions.create({ type: 'partner', code: 'A', name: '测试对象' });
    raw.lines[0]!.dimensions = { partner: party.id };
    const clerk = await app.addUser('clerk');
    await expect(app.call(fixtureModule, clerk).save(raw)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(app.call(fixtureModule, null).save(raw)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect((await app.svc.vouchers.list({})).total).toBe(0);
    const writer = await app.addUser('writer', { permissions: ['templates-fixture.write'] });
    const saved = await app
      .call(fixtureModule, writer)
      .save({ ...raw, source: { type: 'document', id: '1' } });
    await expect(app.svc.vouchers.delete(saved.id)).rejects.toMatchObject({
      data: { code: 'VOUCHER_FROM_SOURCE' },
    });
    await expect(
      app.svc.vouchers.update(saved.id, raw, { expectedRevision: saved.revision }),
    ).rejects.toMatchObject({ data: { code: 'VOUCHER_FROM_SOURCE' } });
    const backup = path.join(app.runtime.bookStore.booksDir, 'protection.backup');
    await app.runtime.bookStore.open(app.book.id).raw.backup(backup);
    const hash = () => createHash('sha256').update(readFileSync(backup)).digest('hex');
    const before = hash();
    const prepare = vi.fn();
    await expect(
      app.runtime.bookStore.maintain(app.book.id, { kind: 'replace', prepare }),
    ).rejects.toMatchObject({ data: { code: 'DESTRUCTIVE_MAINTENANCE_UNAVAILABLE' } });
    expect(prepare).not.toHaveBeenCalled();
    expect(hash()).toBe(before);
    expect(await app.svc.vouchers.get(saved.id)).toEqual(saved);
    expect((await app.svc.accounts.require('1121')).dimensions).toEqual([
      { type: 'partner', required: true, defaultItemId: null },
    ]);
  } finally {
    await app.close();
  }
});

it('w_xt_kgzb_3：升级模板并重新打开旧账不改旧辅助配置，新账才加载1.2.0', async () => {
  // 合成1.0.0的辅助配置；不读取真实账套，也不复制旧用户数据。
  const current = parseTemplate(templatesServer.templates[0]);
  const legacy = {
    ...current,
    version: '1.0.0',
    accounts: current.accounts
      .filter((a) => a.code.length === 4)
      .map((a) => ({ ...a, partner: false, dimensions: [] })),
  };
  const legacyModule = defineServerModule(templatesServer.manifest, {
    router: templatesServer.router,
    templates: [legacy],
  });
  const app = await createTestApp({ modules: [legacyModule], templateId: current.id, seed: false });
  let runtime: ReturnType<typeof createRuntime> | undefined;
  try {
    const before = await app.svc.accounts.list();
    expect(before.every((a) => a.dimensions.length === 0)).toBe(true);
    await app.runtime.bookStore.dispose();
    runtime = createRuntime({ dataDir: app.runtime.dataDir, modules: [...integrationModules] });
    const book = runtime.bookStore.open(app.book.id);
    const svc = createCoreServices({
      db: book.db,
      user: (await loadServiceUser(book.db, 1))!,
      moduleId: null,
      modules: runtime.modules.lookup,
      now: runtime.now,
    });
    expect(await svc.accounts.list()).toEqual(before);
    const second = await runtime.bookStore.create({
      name: '升级后新账',
      orgName: '测试单位',
      templateId: current.id,
      product: 'minfei',
      startYear: 2026,
      startMonth: 1,
    });
    const rows = await runtime.bookStore
      .open(second.id)
      .db.selectFrom('account_dimension')
      .select(['dimension_type', 'required', 'default_item_id'])
      .execute();
    expect(rows).toEqual(
      partnerAccounts.map(() => ({
        dimension_type: 'partner',
        required: 1,
        default_item_id: null,
      })),
    );
    expect(await svc.accounts.list()).toEqual(before);
  } finally {
    await runtime?.bookStore.dispose();
    await app.close();
  }
});
