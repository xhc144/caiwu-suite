import { expect, test as base, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createTestBook, voucherInputFromSpec } from '@caiwu/testkit';
import { callApi } from '@caiwu/testkit/e2e';
import { spawnLocalServer } from '@caiwu/testkit/local-server';
import type { Voucher, VoucherInput } from '@caiwu/core';
import type { Preview, ActionResult, CommitInput } from '../shared';

const test = base.extend<{
  joint: {
    save: (data: VoucherInput, more?: { id: number; expectedRevision: number }) => Promise<Voucher>;
    preview: (
      id: number,
      who?: 'maker' | 'auditor',
      action?: 'audit' | 'delete',
    ) => Promise<Preview>;
    commit: (
      token: string,
      who?: 'maker' | 'auditor',
      mappings?: CommitInput['cashflowMappings'],
    ) => Promise<ActionResult>;
    open: (page: Page, who: 'maker' | 'auditor') => Promise<void>;
    reverse: (id: number, type: number) => Promise<Preview>;
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
      env: {
        CAIWU_PORT: '0',
        CAIWU_TOKEN: 'e2e-token',
        CAIWU_DEV: '1',
        CAIWU_WEB_DIST: path.resolve('apps/web/dist'),
      },
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
        reverse: (id, type) =>
          callApi<Preview>(
            http,
            'm.voucher-book.preview.reverse',
            {
              action: 'reverse',
              selection: { ids: [id] },
              date: '2026-02-01',
              voucherTypeId: type,
            },
            { token: maker },
          ),
        open: async (page, who) => {
          const session = await callApi<{ token: string; user: unknown; book: unknown }>(
            http,
            'core.auth.login',
            {
              bookId: book.info.id,
              userCode: who === 'maker' ? 'admin' : 'auditor',
              password: who === 'maker' ? 'admin' : 'review',
            },
          );
          await page.goto(`http://127.0.0.1:${port}`);
          await page.evaluate(
            (data) => sessionStorage.setItem('caiwu.session', JSON.stringify(data)),
            { ...session, bookId: book.info.id },
          );
          await page.goto(`http://127.0.0.1:${port}/m/voucher-book`);
        },
        commit: (token, who = 'auditor', mappings = []) =>
          callApi<ActionResult>(
            http,
            'm.voucher-book.commit',
            { token, confirmed: true, cashflowMappings: mappings },
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
  expect(deletion.rows[0]!.reasons.join()).toContain('其他业务生成');
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

test('w_pzedit_fc 贷方正数流出红冲后可经真实 HTTP 异人审核，无来源改表', async ({ joint }) => {
  const original = await joint.save(
    await joint.input([{ credit: 12345, flow: 'CF02' }], { debit: 12345 }),
  );
  const plan = await joint.reverse(original.id, original.voucherTypeId);
  expect(plan.reversalCashflow![0]!.direction).toBe('inflow');
  await expect(joint.commit(plan.token, 'maker')).rejects.toThrow(/尚未选择/);
  const result = await joint.commit(plan.token, 'maker', [
    { lineNo: 1, itemId: plan.reversalCashflow![0]!.options[0]!.id },
  ]);
  const audit = await joint.preview(result.createdIds[0]!);
  expect(audit.rows[0]!.reasons).toEqual([]);
  expect(audit.eligibleCount).toBe(1);
  await joint.commit(audit.token);
  expect((await joint.get(result.createdIds[0]!)).status).toBe('audited');
  expect(await joint.get(original.id)).toEqual(original);
});

for (const c of cases) {
  test(`w_pzedit_fc HTTP逐行映射：${c.name}反向后异人审核及来源版本重校验`, async ({ joint }) => {
    const original = await joint.save(
      await joint.input([{ debit: c.debit, credit: c.credit, flow: c.flow }], c.opposite),
    );
    const plan = await joint.reverse(original.id, original.voucherTypeId);
    const row = plan.reversalCashflow![0]!;
    expect(row.direction).toBe(c.flow === 'CF01' ? 'outflow' : 'inflow');
    const count = await joint.count();
    await expect(
      joint.commit(plan.token, 'maker', [
        { lineNo: 1, itemId: original.lines[0]!.dimensions.cashflow! },
      ]),
    ).rejects.toThrow(/方向冲突/);
    expect(await joint.count()).toBe(count);
    const result = await joint.commit(plan.token, 'maker', [
      { lineNo: 1, itemId: row.options[0]!.id },
    ]);
    expect(
      await joint.commit(plan.token, 'maker', [{ lineNo: 1, itemId: row.options[0]!.id }]),
    ).toEqual(result);
    const audit = await joint.preview(result.createdIds[0]!);
    expect(audit.rows[0]!.warnings).toEqual([]);
    expect(audit.eligibleCount).toBe(1);
    await joint.commit(audit.token);
    expect((await joint.get(result.createdIds[0]!)).status).toBe('audited');
    expect(await joint.get(original.id)).toEqual(original);
    expect(await joint.count()).toBe(count + 1);
    const stale = await joint.reverse(original.id, original.voucherTypeId);
    const changed = structuredClone(
      await joint.input([{ debit: c.debit, credit: c.credit, flow: c.flow }], c.opposite),
    );
    changed.note = '来源并发修改';
    await joint.save(changed, { id: original.id, expectedRevision: original.revision });
    await expect(
      joint.commit(stale.token, 'maker', [{ lineNo: 1, itemId: row.options[0]!.id }]),
    ).rejects.toThrow(/已变更/);
    expect(await joint.count()).toBe(count + 1);
  });
}

test('w_pzedit_fc 普通按钮红冲→取消不写→逐行选项目→本人拒绝→异人审核完整闭环', async ({
  joint,
  page,
}) => {
  const original = await joint.save(
    await joint.input([{ credit: 12345, flow: 'CF02' }], { debit: 12345 }),
  );
  const count = await joint.count();
  await joint.open(page, 'maker');
  const sourceRow = page
    .getByRole('row')
    .filter({ hasText: original.displayNo })
    .filter({ hasText: original.summary });
  await sourceRow.getByRole('checkbox').check();
  const start = async () => {
    await page.getByRole('button', { name: '红字冲销', exact: true }).click();
    const setting = page.getByRole('dialog', { name: '红字冲销设置', exact: true });
    await setting.getByLabel('目标日期', { exact: true }).fill('2026-02-01');
    await setting.getByRole('button', { name: '生成预览', exact: true }).click();
    return page.getByRole('dialog', { name: '红字冲销预览', exact: true });
  };
  let dialog = await start();
  await expect(dialog.getByRole('button', { name: '确认执行', exact: true })).toBeDisabled();
  const choose = async () => {
    await dialog.getByLabel('第1行红冲现金流量项目', { exact: true }).click();
    await expect(
      page.locator('.ant-select-item-option-content').filter({ hasText: 'CF02' }),
    ).toHaveCount(0);
    await page.locator('.ant-select-item-option-content').filter({ hasText: 'CF01' }).click();
  };
  await choose();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(await joint.count()).toBe(count);
  expect(await joint.get(original.id)).toEqual(original);
  dialog = await start();
  await expect(dialog.getByRole('button', { name: '确认执行', exact: true })).toBeDisabled();
  await choose();
  await dialog.getByRole('button', { name: '确认执行', exact: true }).click();
  await expect(page.getByText('成功 1 张，跳过 0 张', { exact: true })).toBeVisible();
  const reverseRow = page.getByRole('row').filter({ hasText: `冲销 #${original.id}` });
  await reverseRow.getByRole('checkbox').check();
  await page.getByRole('button', { name: '审核 F4', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '审核预览', exact: true });
  await expect(dialog).toContainText('制单人与审核人相同');
  await expect(dialog.getByRole('button', { name: '确认执行', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await joint.open(page, 'auditor');
  await page
    .getByRole('row')
    .filter({ hasText: `冲销 #${original.id}` })
    .getByRole('checkbox')
    .check();
  await page.getByRole('button', { name: '审核 F4', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '审核预览', exact: true });
  await expect(dialog).toContainText('可处理 1 张，跳过 0 张');
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await dialog.getByRole('button', { name: '确认执行', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: `冲销 #${original.id}` })).toContainText(
    '已审核',
  );
  expect(await joint.get(original.id)).toEqual(original);
  expect(await joint.count()).toBe(count + 1);
});

test('w_pzedit_fc HTTP内部转移红冲仍精确配平，遗留内部差额不允许生成', async ({ joint }) => {
  for (const amount of [1, -1, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) {
    const original = await joint.save(
      await joint.input([
        { debit: amount, flow: 'CFI' },
        { account: '100201', credit: amount, flow: 'CFI' },
      ]),
    );
    const plan = await joint.reverse(original.id, original.voucherTypeId);
    expect(plan.reversalCashflow!.map((r) => r.direction)).toEqual(['internal', 'internal']);
    const r = await joint.commit(plan.token, 'maker');
    const reversed = await joint.get(r.createdIds[0]!);
    expect(reversed.debitTotal).toBe(-amount);
    expect(reversed.lines.map((l) => l.dimensions.cashflow)).toEqual(
      original.lines.map((l) => l.dimensions.cashflow),
    );
    const audit = await joint.preview(reversed.id);
    expect(audit.eligibleCount).toBe(1);
    await joint.commit(audit.token);
    expect(await joint.get(original.id)).toEqual(original);
  }
  const count = await joint.count();
  for (const invalid of joint.legacyInternal)
    await expect(joint.reverse(invalid.id, invalid.voucherTypeId)).rejects.toThrow(
      /内部现金流入流出未配平/,
    );
  expect(await joint.count()).toBe(count);
});
