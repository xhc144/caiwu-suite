import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import periodCloseServer from '../server';
import { call, errorData, rule, snapshot, zeroOpening } from './helpers';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [periodCloseServer] });
  await zeroOpening(app);
});
afterEach(async () => app.close());

async function setup() {
  const api = call(app);
  await seedVouchers(app.svc, [
    {
      date: '2026-01-05',
      status: 'posted',
      lines: [
        { account: '4001', debit: 101 },
        { account: '1001', credit: 101 },
      ],
    },
  ]);
  const id = async (code: string) => (await app.svc.accounts.require(code)).id;
  for (const [code, order, source, target, ratio] of [
    ['A', 1, '4001', '4103', '50'],
    ['B', 2, '4103', '4104', '100'],
    ['C', 3, '4103', '1601', '100'],
  ] as const) {
    await api.saveRule({
      data: await rule(app, {
        code,
        name: `合成结转${code}`,
        kind: 'custom',
        order,
        targetAccountId: await id(target),
        sources: [{ accountId: await id(source), mode: 'balance', ratio }],
      }),
    });
  }
  return api;
}

async function executeCurrent(
  api: ReturnType<typeof call>,
  batch: { id: string; revision: number },
) {
  const preview = await api.transferBatchPreview({ id: batch.id });
  expect(preview.error).toBeNull();
  return api.executeTransferBatch({
    id: batch.id,
    revision: batch.revision,
    previewToken: preview.preview!.previewToken,
    confirmed: true,
  });
}

describe('w_zw_ydjz_1_bak：失败后选择继续其余结转', () => {
  it('保存失败只回滚本项，恢复后明确跳过失败项，后项按实际成功余额重新预览', async () => {
    const api = await setup();
    const batch = await api.startTransferBatch({
      period: 202601,
      ruleIds: [3, 1, 2],
      confirmed: true,
    });
    expect(batch.state.plan.map((r) => r.code)).toEqual(['A', 'B', 'C']);
    const first = await executeCurrent(api, batch);
    expect(first.state.results).toMatchObject([{ ruleId: 1, status: 'generated' }]);
    const voucher = (await app.svc.vouchers.get(first.state.results[0]!.voucherId!))!;
    expect(voucher).toMatchObject({ debitTotal: 51, creditTotal: 51, status: 'pending' });
    const raw = app.runtime.bookStore.open(app.book.id).raw;
    raw.exec(
      "CREATE TRIGGER period_close_batch_test_fail BEFORE INSERT ON period_close_run WHEN NEW.rule_id = 2 BEGIN SELECT RAISE(ABORT,'合成保存失败'); END",
    );
    const failed = await executeCurrent(api, first);
    expect(failed.state.status).toBe('failed');
    expect(failed.state.cursor).toBe(1);
    expect(failed.state.error).toMatchObject({ code: 'PERIOD_CLOSE_BATCH_GENERATION_FAILED' });
    expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).total).toBe(1);
    expect(await app.svc.vouchers.get(voucher.id)).toEqual(voucher);
    expect(await api.transferBatch({ period: 202601 })).toEqual(failed);
    const continued = await api.decideTransferBatch({
      id: failed.id,
      revision: failed.revision,
      decision: 'skip',
      confirmed: true,
    });
    expect(continued.state.results).toMatchObject([
      { ruleId: 1, status: 'generated' },
      { ruleId: 2, status: 'skipped', voucherId: null },
    ]);
    const next = await api.transferBatchPreview({ id: continued.id });
    expect(next.preview!.items[0]).toMatchObject({ code: 'C', debit: 51, credit: 51 });
    const completed = await executeCurrent(api, continued);
    expect(completed.state.status).toBe('completed');
    expect(completed.state.results.map((r) => r.status)).toEqual([
      'generated',
      'skipped',
      'generated',
    ]);
    const generated = (await app.svc.vouchers.list({ sourceModule: 'period-close' })).items;
    expect(generated).toHaveLength(2);
    expect(generated.every((v) => v.debitTotal === v.creditTotal)).toBe(true);
    const logs = await app.svc.log.list();
    expect(logs.some((l) => l.action === 'period-close.batch.failed')).toBe(true);
    expect(logs.some((l) => l.action === 'period-close.batch.skip')).toBe(true);
  });

  it('修复失败原因后重试，已完成前项不重复，随后为零的结转不生成空凭证', async () => {
    const api = await setup();
    let batch = await api.startTransferBatch({
      period: 202601,
      ruleIds: [1, 2, 3],
      confirmed: true,
    });
    batch = await executeCurrent(api, batch);
    const raw = app.runtime.bookStore.open(app.book.id).raw;
    raw.exec(
      "CREATE TRIGGER period_close_batch_retry BEFORE INSERT ON period_close_run WHEN NEW.rule_id = 2 BEGIN SELECT RAISE(ABORT,'合成暂时失败'); END",
    );
    batch = await executeCurrent(api, batch);
    expect(batch.state.status).toBe('failed');
    raw.exec('DROP TRIGGER period_close_batch_retry');
    batch = await api.decideTransferBatch({
      id: batch.id,
      revision: batch.revision,
      decision: 'retry',
      confirmed: true,
    });
    expect(batch.state.status).toBe('active');
    batch = await executeCurrent(api, batch);
    expect(batch.state.cursor).toBe(2);
    const preview = await api.transferBatchPreview({ id: batch.id });
    expect(preview.preview!.items[0]!.zero).toBe(true);
    batch = await executeCurrent(api, batch);
    expect(batch.state.status).toBe('completed');
    expect(batch.state.results.map((r) => r.status)).toEqual(['generated', 'generated', 'zero']);
    expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).total).toBe(2);
  });

  it('已完成项保留，后项配置在预览中失败可直接跳过，停止后不再执行', async () => {
    const api = await setup();
    const definitions = await api.rules();
    const second = definitions.find((r) => r.id === 2)!;
    await api.saveRule({
      id: second.id,
      revision: second.revision,
      data: {
        ...second,
        targetAccountId: (await app.svc.accounts.require('1403')).id,
      },
    });
    let batch = await api.startTransferBatch({
      period: 202601,
      ruleIds: [1, 2, 3],
      confirmed: true,
    });
    batch = await executeCurrent(api, batch);
    expect(batch.state.status).toBe('failed');
    expect(batch.state.error!.code).toBe('PERIOD_CLOSE_TARGET_SEMANTICS');
    batch = await api.decideTransferBatch({
      id: batch.id,
      revision: batch.revision,
      decision: 'skip',
      confirmed: true,
    });
    expect(batch.state.cursor).toBe(2);
    batch = await api.decideTransferBatch({
      id: batch.id,
      revision: batch.revision,
      decision: 'stop',
      confirmed: true,
    });
    expect(batch.state.status).toBe('stopped');
    const before = snapshot(app);
    expect(
      (
        await errorData(
          api.executeTransferBatch({
            id: batch.id,
            revision: batch.revision,
            previewToken: 'none',
            confirmed: true,
          }),
        )
      ).code,
    ).toBe('PERIOD_CLOSE_BATCH_STATE');
    expect(snapshot(app)).toBe(before);
    expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).total).toBe(1);
  });

  it('并发提交同项只有一次成功，旧版本和变更后的预览均不能再次写入', async () => {
    const api = await setup();
    const batch = await api.startTransferBatch({ period: 202601, ruleIds: [1], confirmed: true });
    const preview = await api.transferBatchPreview({ id: batch.id });
    const input = {
      id: batch.id,
      revision: batch.revision,
      previewToken: preview.preview!.previewToken,
      confirmed: true,
    };
    const results = await Promise.allSettled([
      api.executeTransferBatch(input),
      api.executeTransferBatch(input),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).total).toBe(1);
    expect((await errorData(api.executeTransferBatch(input))).code).toBe(
      'PERIOD_CLOSE_BATCH_STALE',
    );
  });

  it('期末基数变化使旧预览失效，取消和未失败时跳过不修改数据', async () => {
    const api = await setup();
    const batch = await api.startTransferBatch({ period: 202601, ruleIds: [1], confirmed: true });
    const preview = await api.transferBatchPreview({ id: batch.id });
    const input = {
      id: batch.id,
      revision: batch.revision,
      previewToken: preview.preview!.previewToken,
      confirmed: true,
    };
    const beforeCancel = snapshot(app);
    await expect(api.executeTransferBatch({ ...input, confirmed: false })).rejects.toThrow();
    await expect(
      api.decideTransferBatch({
        id: batch.id,
        revision: batch.revision,
        decision: 'stop',
        confirmed: false,
      }),
    ).rejects.toThrow();
    expect(
      (
        await errorData(
          api.decideTransferBatch({
            id: batch.id,
            revision: batch.revision,
            decision: 'skip',
            confirmed: true,
          }),
        )
      ).code,
    ).toBe('PERIOD_CLOSE_BATCH_STATE');
    expect(snapshot(app)).toBe(beforeCancel);
    await seedVouchers(app.svc, [
      {
        date: '2026-01-06',
        status: 'posted',
        lines: [
          { account: '4001', debit: 100 },
          { account: '1001', credit: 100 },
        ],
      },
    ]);
    const before = snapshot(app);
    expect((await errorData(api.executeTransferBatch(input))).code).toBe(
      'PERIOD_CLOSE_PREVIEW_CHANGED',
    );
    expect(snapshot(app)).toBe(before);
    expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).total).toBe(0);
  });

  it('按操作员隔离恢复，缺权限直调写入被拒，关闭期间不能继续生成', async () => {
    const api = await setup();
    const batch = await api.startTransferBatch({ period: 202601, ruleIds: [1], confirmed: true });
    const preview = await api.transferBatchPreview({ id: batch.id });
    const viewer = call(
      app,
      await app.addUser('batch-viewer', { permissions: ['period-close.view'] }),
    );
    expect(await viewer.transferBatch({ period: 202601 })).toBeNull();
    expect((await errorData(viewer.transferBatchPreview({ id: batch.id }))).code).toBe(
      'PERIOD_CLOSE_BATCH_NOT_FOUND',
    );
    const before = snapshot(app);
    for (const action of [
      () => viewer.startTransferBatch({ period: 202601, ruleIds: [1], confirmed: true }),
      () =>
        viewer.executeTransferBatch({
          id: batch.id,
          revision: batch.revision,
          previewToken: preview.preview!.previewToken,
          confirmed: true,
        }),
      () =>
        viewer.decideTransferBatch({
          id: batch.id,
          revision: batch.revision,
          decision: 'stop',
          confirmed: true,
        }),
    ])
      expect((await errorData(action())).code).toBe('FORBIDDEN');
    expect(snapshot(app)).toBe(before);
    await app.svc.periods.setStatus(202601, 'closed');
    const output = await api.executeTransferBatch({
      id: batch.id,
      revision: batch.revision,
      previewToken: preview.preview!.previewToken,
      confirmed: true,
    });
    expect(output.state.status).toBe('failed');
    expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).total).toBe(0);
  });

  it('手工编号账套可明确输入号码，号码冲突仅回滚本项，改号重试不丢前序业务', async () => {
    const api = await setup();
    await app.svc.voucherPolicy.set({
      numbering: 'manual',
      renumberAfterDelete: false,
      allowModifyOthers: true,
    });
    let batch = await api.startTransferBatch({ period: 202601, ruleIds: [1], confirmed: true });
    let preview = await api.transferBatchPreview({ id: batch.id });
    expect(preview.preview!.numbering).toBe('manual');
    const original = (await app.svc.vouchers.list()).items;
    batch = await api.executeTransferBatch({
      id: batch.id,
      revision: batch.revision,
      previewToken: preview.preview!.previewToken,
      confirmed: true,
      number: 1,
    });
    expect(batch.state.status).toBe('failed');
    expect((await app.svc.vouchers.list()).items).toEqual(original);
    expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).total).toBe(0);
    batch = await api.decideTransferBatch({
      id: batch.id,
      revision: batch.revision,
      decision: 'retry',
      confirmed: true,
    });
    preview = await api.transferBatchPreview({ id: batch.id });
    batch = await api.executeTransferBatch({
      id: batch.id,
      revision: batch.revision,
      previewToken: preview.preview!.previewToken,
      confirmed: true,
      number: 12,
    });
    expect(batch.state.status).toBe('completed');
    const generated = (await app.svc.vouchers.list({ sourceModule: 'period-close' })).items;
    expect(generated).toMatchObject([
      { number: 12, debitTotal: 51, creditTotal: 51, status: 'pending' },
    ]);
  });

  it('未生成项被外部改成缺换算后，可明确重新检查记为失败，再跳过并继续', async () => {
    const api = await setup();
    let batch = await api.startTransferBatch({
      period: 202601,
      ruleIds: [1, 2, 3],
      confirmed: true,
    });
    batch = await executeCurrent(api, batch);
    expect(batch.state.status).toBe('active');
    const second = (await api.rules()).find((r) => r.id === 2)!;
    await api.saveRule({
      id: second.id,
      revision: second.revision,
      data: { ...second, targetAccountId: (await app.svc.accounts.require('1403')).id },
    });
    const invalid = await api.transferBatchPreview({ id: batch.id });
    expect(invalid.batch.state.status).toBe('active');
    expect(invalid.error!.code).toBe('PERIOD_CLOSE_TARGET_SEMANTICS');
    batch = await api.decideTransferBatch({
      id: batch.id,
      revision: batch.revision,
      decision: 'retry',
      confirmed: true,
    });
    expect(batch.state.status).toBe('failed');
    batch = await api.decideTransferBatch({
      id: batch.id,
      revision: batch.revision,
      decision: 'skip',
      confirmed: true,
    });
    const preview = await api.transferBatchPreview({ id: batch.id });
    expect(preview.preview!.items[0]).toMatchObject({ code: 'C', debit: 51, credit: 51 });
    batch = await executeCurrent(api, batch);
    expect(batch.state.status).toBe('completed');
    expect(batch.state.results.map((r) => r.status)).toEqual(['generated', 'skipped', 'generated']);
  });

  it('前序零转出在外部数据变化后必须重新核对，不能静默当作已完成继续生成', async () => {
    const api = await setup();
    let batch = await api.startTransferBatch({ period: 202601, ruleIds: [2, 3], confirmed: true });
    batch = await executeCurrent(api, batch);
    expect(batch.state.results).toMatchObject([{ ruleId: 2, status: 'zero' }]);
    await seedVouchers(app.svc, [
      {
        date: '2026-01-06',
        status: 'posted',
        lines: [
          { account: '4103', debit: 100 },
          { account: '1001', credit: 100 },
        ],
      },
    ]);
    const changed = await api.transferBatchPreview({ id: batch.id });
    expect(changed.preview).toBeNull();
    expect(changed.error!.code).toBe('PERIOD_CLOSE_BATCH_BASIS_CHANGED');
    expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).total).toBe(0);
  });

  it('同页删除前序成功凭证后不能重模拟替代实际凭证并继续生成后项', async () => {
    const api = await setup();
    let batch = await api.startTransferBatch({ period: 202601, ruleIds: [1, 2], confirmed: true });
    batch = await executeCurrent(api, batch);
    const beforeDelete = await api.transferBatchPreview({ id: batch.id });
    expect(beforeDelete.preview!.items[0]).toMatchObject({ code: 'B', debit: 51 });
    await api.deleteGenerated({ period: 202601, ruleId: 1, confirmed: true });
    expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).total).toBe(0);
    const invalid = await api.transferBatchPreview({ id: batch.id });
    expect(invalid.preview).toBeNull();
    expect(invalid.error!.code).toBe('PERIOD_CLOSE_BATCH_SOURCE_CHANGED');
    batch = await api.executeTransferBatch({
      id: batch.id,
      revision: batch.revision,
      previewToken: beforeDelete.preview!.previewToken,
      confirmed: true,
    });
    expect(batch.state.status).toBe('failed');
    expect(batch.state.error!.code).toBe('PERIOD_CLOSE_BATCH_SOURCE_CHANGED');
    expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).total).toBe(0);
  });
});
