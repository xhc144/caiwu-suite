import { expect, test as base } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createTestBook, voucherInputFromSpec } from '@caiwu/testkit';
import { callApi } from '@caiwu/testkit/e2e';
import { spawnLocalServer } from '@caiwu/testkit/local-server';
import type { Voucher, VoucherInput } from '@caiwu/core';
import type { Preview, ActionResult } from '../shared';

const test = base.extend<{
  joint: {
    save: (data: VoucherInput, more?: { id: number; expectedRevision: number }) => Promise<Voucher>;
    preview: (
      id: number,
      who?: 'maker' | 'auditor',
      action?: 'audit' | 'delete',
    ) => Promise<Preview>;
    commit: (token: string, who?: 'maker' | 'auditor') => Promise<ActionResult>;
    get: (id: number) => Promise<Voucher>;
    count: () => Promise<number>;
    input: (
      cash: { account?: string; debit?: number; credit?: number; flow: 'CF01' | 'CF02' | 'CFI' }[],
      other?: { debit?: number; credit?: number },
    ) => Promise<VoucherInput>;
    source: Voucher;
    legacyInternal: Voucher[];
    legacyWrongFlow: Record<string, Voucher>;
  };
}>({
  joint: async ({ playwright }, use) => {
    const book = await createTestBook();
    for (const [code, direction] of [
      ['CF01', 'inflow'],
      ['CF02', 'outflow'],
    ] as const) {
      const item = (await book.svc.dimensions.getByCode('cashflow', code))!;
      await book.svc.db
        .updateTable('dimension_item')
        .set({ attrs: JSON.stringify({ cashflowDirection: direction }) })
        .where('id', '=', item.id)
        .execute();
    }
    await book.svc.dimensions.create({
      type: 'cashflow',
      code: 'CFI',
      name: '内部转移',
      attrs: { cashflowDirection: 'internal' },
    });
    await book.addUser('auditor', {
      password: 'review',
      permissions: ['voucher-book.view', 'voucher-book.audit', 'voucher-book.delete'],
    });
    const input = async (
      cash: { account?: string; debit?: number; credit?: number; flow: 'CF01' | 'CF02' | 'CFI' }[],
      other?: { debit?: number; credit?: number },
    ) =>
      voucherInputFromSpec(book.svc, {
        date: '2026-01-05',
        summary: '现金流联合回归',
        lines: [
          ...cash.map((l) => ({
            account: l.account ?? '1001',
            debit: l.debit,
            credit: l.credit,
            dims: { cashflow: l.flow },
          })),
          ...(other ? [{ account: '6603', ...other }] : []),
        ],
      });
    // 在正常停库之前用 core 造来源凭证和遗留反例；运行期间所有读写走真实 HTTP。
    const source = await book.forModule('cashier').vouchers.create({
      ...(await input([{ credit: -12345, flow: 'CF01' }], { debit: -12345 })),
      source: { type: 'document', id: 'JOINT-SOURCE' },
    });
    const legacyInternal: Voucher[] = [];
    for (const sign of [1, -1])
      legacyInternal.push(
        await book.svc.vouchers.create(
          await input([
            { debit: sign * 100, flow: 'CFI' },
            { account: '100201', credit: sign * 100, flow: sign > 0 ? 'CF02' : 'CF01' },
          ]),
        ),
      );
    const legacyWrongFlow: Record<string, Voucher> = {};
    for (const c of cases)
      legacyWrongFlow[c.name] = await book.svc.vouchers.create(
        await input(
          [{ debit: c.debit, credit: c.credit, flow: c.flow === 'CF01' ? 'CF02' : 'CF01' }],
          c.opposite,
        ),
      );
    // 保存输入只包含稳定的 core ID，后续不要再使用已关闭的 svc。
    const accounts = new Map((await book.svc.accounts.list()).map((a) => [a.code, a.id]));
    const flows = new Map((await book.svc.dimensions.items('cashflow')).map((d) => [d.code, d.id]));
    const type = (await book.svc.reference.voucherTypes())[0]!.id;
    await book.store.closeAll();
    const server = spawnLocalServer({
      dataDir: book.dataDir,
      shutdownProtocol: 'native',
      env: { CAIWU_PORT: '0', CAIWU_TOKEN: 'e2e-token', CAIWU_DEV: '1' },
    });
    const port = await server.ready();
    const http = await playwright.request.newContext({ baseURL: `http://127.0.0.1:${port}` });
    try {
      const login = async (userCode: string, password: string) =>
        (
          await callApi<{ token: string }>(http, 'core.auth.login', {
            bookId: book.info.id,
            userCode,
            password,
          })
        ).token;
      const maker = await login('admin', 'admin');
      const auditor = await login('auditor', 'review');
      const actor = (who: 'maker' | 'auditor') => (who === 'maker' ? maker : auditor);
      await use({
        input: async (cash, other) => ({
          date: '2026-01-05',
          voucherTypeId: type,
          attachments: 0,
          draft: false,
          lines: [
            ...cash.map((l) => ({
              summary: '现金流联合回归',
              accountId: accounts.get(l.account ?? '1001')!,
              dimensions: { cashflow: flows.get(l.flow)! },
              debit: l.debit ?? 0,
              credit: l.credit ?? 0,
            })),
            ...(other
              ? [
                  {
                    summary: '对方分录',
                    accountId: accounts.get('6603')!,
                    dimensions: {},
                    debit: other.debit ?? 0,
                    credit: other.credit ?? 0,
                  },
                ]
              : []),
          ],
        }),
        save: async (data, more) =>
          (
            await callApi<{ voucher: Voucher }>(
              http,
              'm.voucher-entry.save',
              { key: randomUUID(), bufferRevision: 0, data, ...more },
              { token: maker },
            )
          ).voucher,
        preview: (id, who = 'auditor', action = 'audit') =>
          callApi<Preview>(
            http,
            `m.voucher-book.preview.${action}`,
            { action, selection: { ids: [id] } },
            { token: actor(who) },
          ),
        commit: (token, who = 'auditor') =>
          callApi<ActionResult>(
            http,
            'm.voucher-book.commit',
            { token, confirmed: true },
            { token: actor(who) },
          ),
        get: (id) =>
          callApi<Voucher>(http, 'core.vouchers.get', { id }, { token: maker, method: 'GET' }),
        count: async () =>
          (
            await callApi<{ total: number }>(
              http,
              'core.vouchers.list',
              {},
              { token: maker, method: 'GET' },
            )
          ).total,
        source,
        legacyInternal,
        legacyWrongFlow,
      });
    } finally {
      await http.dispose();
      await server.close();
      await book.close();
    }
  },
});

const cases = [
  {
    name: '借方正数为流入',
    debit: 12345,
    credit: 0,
    flow: 'CF01' as const,
    opposite: { credit: 12345 },
  },
  {
    name: '贷方正数为流出',
    debit: 0,
    credit: 12345,
    flow: 'CF02' as const,
    opposite: { debit: 12345 },
  },
  {
    name: '借方红字为流出',
    debit: -12345,
    credit: 0,
    flow: 'CF02' as const,
    opposite: { credit: -12345 },
  },
  {
    name: '贷方红字为流入',
    debit: 0,
    credit: -12345,
    flow: 'CF01' as const,
    opposite: { debit: -12345 },
  },
] as const;
for (const c of cases) {
  test(`w_pz_tjsh 基线P1联合回归：entry.save→${c.name}→独立审核，不能本人审核`, async ({
    joint,
  }) => {
    const data = await joint.input(
      [{ debit: c.debit, credit: c.credit, flow: c.flow }],
      c.opposite,
    );
    const saved = await joint.save(data);
    expect(saved.status).toBe('pending');
    const mine = await joint.preview(saved.id, 'maker');
    expect(mine.eligibleCount).toBe(0);
    expect(mine.rows[0]!.reasons.join()).toContain('制单人与审核人相同');
    await expect(joint.commit(mine.token, 'maker')).rejects.toThrow(/没有合格凭证/);
    expect(await joint.get(saved.id)).toEqual(saved);
    const plan = await joint.preview(saved.id);
    expect(plan).toMatchObject({ eligibleCount: 1, skippedCount: 0 });
    expect(plan.rows[0]!.warnings).toEqual([]);
    const result = await joint.commit(plan.token);
    expect(result.successCount).toBe(1);
    expect(await joint.get(saved.id)).toMatchObject({
      status: 'audited',
      auditedBy: { name: 'auditor' },
      lines: saved.lines,
    });
    const wrong = await joint.input(
      [{ debit: c.debit, credit: c.credit, flow: c.flow === 'CF01' ? 'CF02' : 'CF01' }],
      c.opposite,
    );
    const before = await joint.count();
    await expect(joint.save(wrong)).rejects.toThrow(/方向.*冲突/);
    expect(await joint.count()).toBe(before);
    const legacy = await joint.get(joint.legacyWrongFlow[c.name]!.id);
    const rejected = await joint.preview(legacy.id);
    expect(rejected.eligibleCount).toBe(0);
    expect(rejected.rows[0]!.reasons.join()).toMatch(/方向.*冲突/);
    await expect(joint.commit(rejected.token)).rejects.toThrow(/没有合格凭证/);
    expect(await joint.get(legacy.id)).toEqual(legacy);
  });
}

for (const amount of [1, -1, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) {
  test(`w_pz_tjsh 内部转移联合回归：${amount}分正负配平，entry.save和审核一致`, async ({
    joint,
  }) => {
    const saved = await joint.save(
      await joint.input([
        { debit: amount, flow: 'CFI' },
        { account: '100201', credit: amount, flow: 'CFI' },
      ]),
    );
    const p = await joint.preview(saved.id);
    expect(p.eligibleCount).toBe(1);
    expect(p.rows[0]!.warnings).toEqual([]);
    await joint.commit(p.token);
    expect(await joint.get(saved.id)).toMatchObject({ status: 'audited', lines: saved.lines });
  });
}

test('w_pz_tjsh 内部已配平可混合真实外部流入；其它现金收付不能替未配平内部项抵消', async ({
  joint,
}) => {
  const valid = await joint.input(
    [
      { debit: 100, flow: 'CFI' },
      { account: '100201', credit: 100, flow: 'CFI' },
      { credit: -300, flow: 'CF01' },
    ],
    { debit: -300 },
  );
  const saved = await joint.save(valid);
  const p = await joint.preview(saved.id);
  expect(p.eligibleCount).toBe(1);
  await joint.commit(p.token);
  expect((await joint.get(saved.id)).status).toBe('audited');
  for (const sign of [1, -1]) {
    const bad = await joint.input([
      { debit: sign * 100, flow: 'CFI' },
      { account: '100201', credit: sign * 100, flow: sign > 0 ? 'CF02' : 'CF01' },
    ]);
    const count = await joint.count();
    await expect(joint.save(bad)).rejects.toThrow(/内部现金流入流出未配平/);
    expect(await joint.count()).toBe(count);
  }
  for (const v of joint.legacyInternal) {
    const old = await joint.get(v.id);
    const legacy = await joint.preview(old.id);
    expect(legacy.eligibleCount).toBe(0);
    expect(legacy.rows[0]!.reasons.join()).toMatch(/内部.*未配平/);
    await expect(joint.commit(legacy.token)).rejects.toThrow(/没有合格凭证/);
    expect(await joint.get(old.id)).toEqual(old);
  }
});

test('w_pz_tjsh 红字流入审核允许来源凭证，但entry修改与book删除仍被来源锁阻止', async ({
  joint,
}) => {
  const source = await joint.get(joint.source.id);
  await expect(
    joint.save(await joint.input([{ credit: -12345, flow: 'CF01' }], { debit: -12345 }), {
      id: source.id,
      expectedRevision: source.revision,
    }),
  ).rejects.toThrow(/来源|生成|其他模块/);
  const deletion = await joint.preview(source.id, 'auditor', 'delete');
  expect(deletion.eligibleCount).toBe(0);
  expect(deletion.rows[0]!.reasons.join()).toContain('其它模块来源');
  await expect(joint.commit(deletion.token)).rejects.toThrow(/没有合格凭证/);
  expect(await joint.get(source.id)).toEqual(source);
  const audit = await joint.preview(source.id);
  expect(audit.eligibleCount).toBe(1);
  await joint.commit(audit.token);
  expect(await joint.get(source.id)).toMatchObject({
    status: 'audited',
    source: source.source,
    lines: source.lines,
  });
});
