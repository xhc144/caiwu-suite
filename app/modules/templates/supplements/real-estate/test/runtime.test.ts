import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { balanceSide, type DimensionValues, type VoucherInput } from '@caiwu/core';
import { createCoreServices, emptyModuleLookup, loadServiceUser } from '@caiwu/core/server';
import { createTestBook, type TestBook } from '@caiwu/testkit';
import { createRuntime, defineServerModule, moduleKit } from '@caiwu/server-kit';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import manifest from '../../../manifest';
import { buildRealEstateTemplate } from '../index';
import { readOnlyEnterpriseBase } from './base-fixture';

const makeBook = (scheme = '4-2-2') => {
  const template = buildRealEstateTemplate(readOnlyEnterpriseBase(), scheme);
  return createTestBook({
    templates: [template],
    templateId: template.id,
    codeScheme: scheme,
    seed: false,
  });
};

async function input(
  book: TestBook,
  lines: { account: string; debit?: number; credit?: number; dimensions?: DimensionValues }[],
): Promise<VoucherInput> {
  return {
    voucherTypeId: (await book.svc.reference.voucherTypes())[0]!.id,
    date: '2026-01-05',
    lines: await Promise.all(
      lines.map(async ({ account, ...line }) => ({
        ...line,
        accountId: (await book.svc.accounts.require(account)).id,
        summary: '合成房地产业务',
      })),
    ),
  };
}

async function post(book: TestBook, lines: Parameters<typeof input>[1]) {
  const saved = await book.svc.vouchers.create(await input(book, lines));
  await book.svc.vouchers.changeStatus({ ids: [saved.id], to: 'audited' });
  await book.svc.vouchers.changeStatus({ ids: [saved.id], to: 'posted' });
  return saved;
}

describe.each(['4-2-2', '4-3-3'])('w_xt_kgzb_3 房地产真实合成SQLite：%s', (scheme) => {
  const cost = (suffix: string) => `5001${suffix.padStart(scheme === '4-2-2' ? 2 : 3, '0')}`;

  it('空账原子加载255科目、父链/来源/方向持久化；归集、完工、预收与销售成本全程平衡', async () => {
    const book = await makeBook(scheme);
    try {
      const rows = await book.svc.accounts.list();
      expect(rows).toHaveLength(255);
      expect(await book.svc.dimensions.items()).toEqual([]);
      expect(await book.svc.opening.list(2026)).toEqual([]);
      expect((await book.svc.vouchers.list({})).total).toBe(0);
      expect(await book.svc.ledger.trialBalance(202601, 202601)).toMatchObject({
        balanced: true,
        closingDebit: 0,
        closingCredit: 0,
      });
      const parent = await book.svc.accounts.require('5001');
      const leaf = await book.svc.accounts.require(cost('01'));
      expect(parent).toMatchObject({ isLeaf: false, direction: 'debit', categoryId: 'cost' });
      expect(leaf).toMatchObject({
        parentId: parent.id,
        level: 2,
        isLeaf: true,
        direction: 'debit',
        balanceNature: 'debit',
        closingRule: 'none',
        dimensions: [{ type: 'project', required: true, defaultItemId: null }],
      });
      expect(await book.svc.accounts.provenance(leaf.id)).toMatchObject({
        source: expect.stringContaining('第二十六条'),
        sourceVersion: expect.stringContaining('财会〔2013〕17号'),
      });
      expect(await book.svc.accounts.provenance(parent.id)).toMatchObject({
        source: expect.stringContaining('基表=books-enterprise-cas-2006@2006.18+2026.2'),
      });
      expect(await book.svc.accounts.require('2202')).toMatchObject({
        direction: 'credit',
        isPartner: true,
      });
      expect(await book.svc.accounts.require('2204')).toMatchObject({
        direction: 'credit',
        isPartner: true,
      });
      const project = await book.svc.dimensions.create({
        type: 'project',
        code: 'TEST-P1',
        name: '合成一期住宅成本对象',
      });
      const contractor = await book.svc.dimensions.create({
        type: 'partner',
        code: 'TEST-S1',
        name: '合成工程承包方',
      });
      const customer = await book.svc.dimensions.create({
        type: 'partner',
        code: 'TEST-C1',
        name: '合成购房客户',
      });
      const p = { project: project.id };
      const supplier = { ...p, partner: contractor.id };
      const buyer = { ...p, partner: customer.id };
      await book.svc.opening.upsert({
        year: 2026,
        accountId: (await book.svc.accounts.require('1002')).id,
        balance: 1_000_000,
      });
      await book.svc.opening.upsert({
        year: 2026,
        accountId: (await book.svc.accounts.require('4001')).id,
        balance: -1_000_000,
      });
      await expect(
        book.svc.opening.upsert({ year: 2026, accountId: parent.id, balance: 100 }),
      ).rejects.toMatchObject({ data: { code: 'OPENING_NOT_LEAF' } });
      await post(book, [
        { account: cost('01'), debit: 10_000, dimensions: p },
        { account: '1002', credit: 10_000 },
      ]);
      await post(book, [
        { account: cost('03'), debit: 20_000, dimensions: p },
        { account: '2202', credit: 20_000, dimensions: supplier },
      ]);
      await post(book, [
        { account: cost('06'), debit: 5_000, dimensions: p },
        { account: '1002', credit: 5_000 },
      ]);
      await post(book, [
        { account: cost('07'), debit: 1_000, dimensions: p },
        { account: '1002', credit: 1_000 },
      ]);
      expect(
        (
          await book.svc.ledger.balances({
            periodFrom: 202601,
            periodTo: 202601,
            accountCodes: ['5001'],
            groupBy: ['project'],
          })
        ).find((row) => row.accountCode === '5001'),
      ).toMatchObject({ closing: 36_000, dimensions: p });
      // 合成业务前提：已经达到销售条件的开发产品按实际成本完工入库。
      await post(book, [
        { account: '1405', debit: 36_000, dimensions: p },
        { account: cost('01'), credit: 10_000, dimensions: p },
        { account: cost('03'), credit: 20_000, dimensions: p },
        { account: cost('06'), credit: 5_000, dimensions: p },
        { account: cost('07'), credit: 1_000, dimensions: p },
      ]);
      await post(book, [
        { account: '1002', debit: 60_000 },
        { account: '2204', credit: 60_000, dimensions: buyer },
      ]);
      // 合成业务前提：按合同转移控制权，全部预收款符合收入确认条件；不把到账即收入。
      await post(book, [
        { account: '2204', debit: 60_000, dimensions: buyer },
        { account: '6001', credit: 60_000, dimensions: p },
      ]);
      await post(book, [
        { account: '6401', debit: 36_000, dimensions: p },
        { account: '1405', credit: 36_000, dimensions: p },
      ]);
      const balances = await book.svc.ledger.balances({
        periodFrom: 202601,
        periodTo: 202601,
        includeZero: true,
      });
      const closing = (code: string) => balances.find((row) => row.accountCode === code)?.closing;
      expect(closing('1002')).toBe(1_044_000);
      expect(closing('2202')).toBe(-20_000);
      expect(closing('2204')).toBe(0);
      expect(closing('5001')).toBe(0);
      expect(closing('1405')).toBe(0);
      expect(closing('6001')).toBe(-60_000);
      expect(closing('6401')).toBe(36_000);
      expect(balanceSide(closing('2202')!, 'credit')).toEqual({ side: '贷', amount: 20_000 });
      expect(await book.svc.ledger.trialBalance(202601, 202601)).toMatchObject({
        balanced: true,
        openingDebit: 1_000_000,
        openingCredit: 1_000_000,
        closingDebit: 1_080_000,
        closingCredit: 1_080_000,
      });
      const dimensions = await book.svc.ledger.balances({
        periodFrom: 202601,
        periodTo: 202601,
        accountCodes: ['2202'],
        groupBy: ['project', 'partner'],
      });
      expect(dimensions).toHaveLength(1);
      expect(dimensions[0]).toMatchObject({ closing: -20_000, dimensions: supplier });
      const dbRows = book.book.raw
        .prepare('SELECT code, name, direction, source_version FROM account ORDER BY code')
        .all();
      await book.store.close(book.info.id);
      const reopened = book.store.open(book.info.id);
      expect(
        reopened.raw
          .prepare('SELECT code, name, direction, source_version FROM account ORDER BY code')
          .all(),
      ).toEqual(dbRows);
      const svc = createCoreServices({
        db: reopened.db,
        user: (await loadServiceUser(reopened.db, 1))!,
        moduleId: null,
        modules: emptyModuleLookup,
        now: () => new Date('2026-01-05T00:00:00Z'),
      });
      expect((await svc.ledger.trialBalance(202601, 202601)).balanced).toBe(true);
    } finally {
      await book.close();
    }
  });

  it('末级制证阻止父级、缺失/错类型/停用项目、缺往来及不平衡，失败不留凭证', async () => {
    const book = await makeBook(scheme);
    try {
      const project = await book.svc.dimensions.create({
        type: 'project',
        code: 'P',
        name: '合成正常项目',
      });
      const disabled = await book.svc.dimensions.create({
        type: 'project',
        code: 'X',
        name: '合成停用项目',
        disabled: true,
      });
      const party = await book.svc.dimensions.create({
        type: 'partner',
        code: 'C',
        name: '合成往来',
      });
      const group = await book.svc.dimensions.create({
        type: 'project',
        code: 'G',
        name: '合成项目组',
      });
      await book.svc.dimensions.create({
        type: 'project',
        code: 'G1',
        name: '合成子项目',
        parentId: group.id,
      });
      const bad = [
        [
          { account: '5001', debit: 100, dimensions: { project: project.id } },
          { account: '1002', credit: 100 },
        ],
        ...[
          undefined,
          { project: party.id },
          { project: disabled.id },
          { project: 999_999 },
          { project: group.id },
        ].map((dimensions) => [
          { account: cost('01'), debit: 100, dimensions },
          { account: '1002', credit: 100 },
        ]),
        [
          { account: cost('01'), debit: 100, dimensions: { project: project.id } },
          { account: '2202', credit: 100, dimensions: { project: project.id } },
        ],
        [
          { account: cost('01'), debit: 100, dimensions: { project: project.id } },
          { account: '1002', credit: 99 },
        ],
      ];
      for (const lines of bad)
        await expect(book.svc.vouchers.create(await input(book, lines))).rejects.toMatchObject({
          data: { code: 'VOUCHER_INVALID' },
        });
      expect((await book.svc.vouchers.list({})).total).toBe(0);
      const saved = await book.svc.vouchers.create(
        await input(book, [
          { account: cost('01'), debit: 100, dimensions: { project: project.id } },
          { account: '1002', credit: 100 },
        ]),
      );
      expect(saved.number).toBe(1);
      await expect(
        book.svc.vouchers.update(
          saved.id,
          {
            ...(await input(book, [
              { account: cost('01'), debit: 100 },
              { account: '1002', credit: 100 },
            ])),
          },
          { expectedRevision: saved.revision },
        ),
      ).rejects.toMatchObject({ data: { code: 'VOUCHER_INVALID' } });
      expect((await book.svc.vouchers.get(saved.id))?.lines[0]?.dimensions.project).toBe(
        project.id,
      );
    } finally {
      await book.close();
    }
  });
});

it('w_xt_kgzb_3：整数分性质检查，项目成本与供应商应付借贷对称且按项目隔离', async () => {
  const book = await makeBook();
  try {
    const project1 = await book.svc.dimensions.create({
      type: 'project',
      code: 'P1',
      name: '合成对象一',
    });
    const project2 = await book.svc.dimensions.create({
      type: 'project',
      code: 'P2',
      name: '合成对象二',
    });
    const party = await book.svc.dimensions.create({
      type: 'partner',
      code: 'S1',
      name: '合成承包方',
    });
    let total1 = 0;
    let total2 = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.boolean(),
        async (amount, second) => {
          const project = second ? project2 : project1;
          await post(book, [
            { account: '500103', debit: amount, dimensions: { project: project.id } },
            {
              account: '2202',
              credit: amount,
              dimensions: { project: project.id, partner: party.id },
            },
          ]);
          if (second) total2 += amount;
          else total1 += amount;
          const query = {
            periodFrom: 202601,
            periodTo: 202601,
            accountCodes: ['5001', '2202'],
            groupBy: ['project'] as const,
            includeZero: true,
          };
          const rows = await book.svc.ledger.balances({ ...query, groupBy: [...query.groupBy] });
          for (const [projectId, total] of [
            [project1.id, total1],
            [project2.id, total2],
          ] as const) {
            expect(
              rows.find((row) => row.accountCode === '5001' && row.dimensions.project === projectId)
                ?.closing ?? 0,
            ).toBe(total);
            expect(
              rows.find((row) => row.accountCode === '2202' && row.dimensions.project === projectId)
                ?.closing ?? 0,
            ).toBe(total === 0 ? 0 : -total);
          }
          expect((await book.svc.ledger.trialBalance(202601, 202601)).balanced).toBe(true);
        },
      ),
      { numRuns: 25, seed: 20261028 },
    );
  } finally {
    await book.close();
  }
});

it('w_xt_kgzb_a2/1/3：只读登记适配、请求重试与已有基表账隔离，不碰全局registry', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'caiwu-real-estate-provider-'));
  const base = readOnlyEnterpriseBase();
  const template = buildRealEstateTemplate(base);
  const m = moduleKit(manifest);
  const provider = defineServerModule(manifest, {
    router: m.router({}),
    templates: [base, template],
  });
  const runtime = createRuntime({ dataDir: directory, modules: [provider], devMode: false });
  const input = {
    name: '合成房地产账套',
    orgName: '合成测试企业',
    product: 'qingsong' as const,
    templateId: template.id,
    startYear: 2026,
    startMonth: 1,
    adminPassword: 'test-only',
  };
  try {
    expect(runtime.templates.list().map((entry) => entry.id)).toEqual([base.id, template.id]);
    const original = await runtime.bookStore.create({ ...input, templateId: base.id });
    const originalRows = runtime.bookStore
      .open(original.id)
      .raw.prepare('SELECT code, name, direction, source_version FROM account ORDER BY code')
      .all();
    const [created, retried] = await Promise.all([
      runtime.bookStore.create({
        ...input,
        requestKey: 'synthetic-real-estate-same-request',
        codeScheme: '4-3-3',
      }),
      runtime.bookStore.create({
        ...input,
        requestKey: 'synthetic-real-estate-same-request',
        codeScheme: '4-3-3',
      }),
    ]);
    expect(created.id).toBe(retried.id);
    const book = runtime.bookStore.open(created.id);
    expect(book.raw.prepare('SELECT template_id, template_version FROM book_info').get()).toEqual({
      template_id: template.id,
      template_version: template.version,
    });
    expect(
      book.raw
        .prepare('SELECT code, name, is_leaf, direction FROM account WHERE code = ?')
        .get('5001007'),
    ).toMatchObject({ code: '5001007', name: '借款费用', is_leaf: 1, direction: 'debit' });
    expect(
      runtime.bookStore
        .open(original.id)
        .raw.prepare('SELECT code, name, direction, source_version FROM account ORDER BY code')
        .all(),
    ).toEqual(originalRows);
    const before = readdirSync(runtime.bookStore.booksDir).sort();
    await expect(runtime.bookStore.create({ ...input, codeScheme: '3-2-2' })).rejects.toThrow(
      /一级科目编码不能使用/,
    );
    expect(readdirSync(runtime.bookStore.booksDir).sort()).toEqual(before);
    expect((await runtime.bookStore.list()).length).toBe(2);
  } finally {
    await runtime.bookStore.closeAll();
    rmSync(directory, { recursive: true, force: true });
  }
});
