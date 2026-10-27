import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, seedVouchers, type TestApp } from '@caiwu/testkit';
import periodCloseServer from '../server';
import { audited, call, errorData, generateAll, rule, snapshot, zeroOpening } from './helpers';

let app: TestApp;
beforeEach(async () => {
  app = await createTestApp({ modules: [periodCloseServer] });
});
afterEach(async () => app.close());

describe('过账与结账', () => {
  it('w_zw_jz：实际保存期初是前置，opening_stored=1 不代表已录入；显式零允许', async () => {
    const api = call(app);
    const { voucher } = await audited(app);
    expect((await app.svc.periods.years())[0]!.opening_stored).toBe(1);
    const before = snapshot(app);
    expect((await errorData(api.post({ from: 202601, to: 202601 }))).actions?.[0]?.to).toBe(
      '/m/opening?year=2026',
    );
    expect(snapshot(app)).toBe(before);
    await zeroOpening(app);
    expect((await api.post({ from: 202601, to: 202601 })).count).toBe(1);
    expect((await app.svc.vouchers.get(voucher.id))!.status).toBe('posted');
  });
  it('w_zw_jz/_pl：年初与启用前累计分别校验，差一分也阻止', async () => {
    const api = call(app);
    await audited(app);
    const id = (await app.svc.accounts.require('1001')).id;
    await app.svc.opening.upsert({ year: 2026, accountId: id, balance: 1 });
    expect((await errorData(api.post({ from: 202601, to: 202601 }))).message).toContain('0.01');
    await app.svc.opening.upsert({ year: 2026, accountId: id, balance: 0, ytdDebit: 1 });
    expect((await app.svc.ledger.trialBalance(202601, 202601)).balanced).toBe(true);
    expect((await errorData(api.post({ from: 202601, to: 202601 }))).message).toContain(
      '累计差额 0.01',
    );
  });
  it('w_zw_jz/_pl：只过已审核，草稿/待审核/作废逐项跳过；无候选中文返回', async () => {
    const api = call(app);
    await zeroOpening(app);
    await audited(app);
    const [pending, draft, voided] = await seedVouchers(
      app.svc,
      ['pending', 'draft', 'audited'].map((status) => ({
        date: '2026-01-06',
        status: status as 'pending' | 'draft' | 'audited',
        lines: [
          { account: '1001', debit: 10 },
          { account: '4001', credit: 10 },
        ],
      })),
    );
    await app.svc.vouchers.setVoided(voided!.id, true);
    const out = await api.post({ from: 202601, to: 202601 });
    expect(out.count).toBe(1);
    expect(out.skipped.map((v) => v.reason)).toEqual(
      expect.arrayContaining(['草稿不进入正式账', '待审核，请其他操作员审核', '已作废']),
    );
    expect((await app.svc.vouchers.get(pending!.id))!.status).toBe('pending');
    expect((await app.svc.vouchers.get(draft!.id))!.number).toBeNull();
    expect((await api.post({ from: 202601, to: 202601 })).message).toBe('没有需要过账的凭证');
  });
  it('w_zw_fgz / w_zw_jz_pl：范围必填合法、期间存在开放、上年未年结阻止', async () => {
    const api = call(app);
    await zeroOpening(app);
    await expect(api.post({ from: 202600, to: 202601 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect((await errorData(api.unpost({ from: 202602, to: 202601, confirmed: true }))).code).toBe(
      'PERIOD_CLOSE_RANGE',
    );
    expect((await errorData(api.post({ from: 202701, to: 202701 }))).code).toBe(
      'PERIOD_CLOSE_PERIOD_MISSING',
    );
    await app.svc.periods.ensureYear(2027, { openingStored: true });
    await app.svc.opening.upsert({
      year: 2027,
      accountId: (await app.svc.accounts.require('1001')).id,
      balance: 0,
    });
    expect((await errorData(api.post({ from: 202701, to: 202701 }))).message).toContain(
      '上年度年结',
    );
    await app.svc.periods.setStatus(202601, 'closed');
    expect(
      (await errorData(api.unpost({ from: 202601, to: 202601, confirmed: true }))).details?.periods,
    ).toEqual([202601]);
    expect((await errorData(api.post({ from: 202601, to: 202601 }))).code).toBe(
      'PERIOD_CLOSE_CLOSED',
    );
  });
  it('w_zw_jz → w_zw_ydjz → w_zw_fz → w_zw_qxfz：真实异人审核闭环及核心期间保护', async () => {
    const api = call(app);
    await zeroOpening(app);
    const { reviewerSvc } = await audited(app);
    await api.saveRule({ data: await rule(app) });
    await api.post({ from: 202601, to: 202601 });
    const { result, input } = await generateAll(app);
    const generated = result.generated[0]!.id;
    const v = (await app.svc.vouchers.get(generated))!;
    expect(v.status).toBe('pending');
    expect(v.closingKind).toBe('pnl');
    expect(v.createdBy.id).not.toBe(reviewerSvc.user.id);
    expect(v.source).toMatchObject({ module: 'period-close', type: 'closing', id: '202601:1' });
    expect(v.debitTotal).toBe(v.creditTotal);
    expect((await api.generate(input)).generated[0]!.id).toBe(generated);
    expect((await errorData(api.close({ period: 202601, confirmed: true }))).code).toBe(
      'PERIOD_CLOSE_CHECK_FAILED',
    );
    await reviewerSvc.vouchers.changeStatus({ ids: [generated], to: 'audited' });
    await api.post({ from: 202601, to: 202601 });
    expect((await api.check({ period: 202601 })).allPassed).toBe(true);
    const balances = await app.svc.ledger.balances({ periodFrom: 202601, periodTo: 202601 });
    const opening = await app.svc.opening.list(2026);
    await api.close({ period: 202601, confirmed: true });
    await expect(
      seedVouchers(app.svc, [
        {
          date: '2026-01-10',
          lines: [
            { account: '1001', debit: 1 },
            { account: '4001', credit: 1 },
          ],
        },
      ]),
    ).rejects.toThrow('已经结账');
    await api.reopen({ from: 202601, to: 202601, confirmed: true });
    expect(await app.svc.opening.list(2026)).toEqual(opening);
    expect(await app.svc.ledger.balances({ periodFrom: 202601, periodTo: 202601 })).toEqual(
      balances,
    );
  });
  it('w_zw_ydjz/_1：未过账对象可定位，草稿警示；未选/未确认/已结账阻止', async () => {
    const api = call(app);
    await zeroOpening(app);
    await api.saveRule({ data: await rule(app) });
    const { voucher } = await audited(app);
    expect(
      (await errorData(api.preview({ period: 202601, ruleIds: [1] }))).details?.vouchers,
    ).toEqual([{ id: voucher.id, displayNo: '记-0001', status: 'audited' }]);
    expect((await errorData(api.preview({ period: 202601, ruleIds: [] }))).code).toBe(
      'PERIOD_CLOSE_NO_SELECTION',
    );
    const before = snapshot(app);
    expect(
      (
        await errorData(
          api.generate({ period: 202601, ruleIds: [1], confirmed: false, previewToken: '' }),
        )
      ).code,
    ).toBe('PERIOD_CLOSE_CONFIRM');
    expect(snapshot(app)).toBe(before);
    await api.post({ from: 202601, to: 202601 });
    const [draft] = await seedVouchers(app.svc, [
      { date: '2026-01-08', status: 'draft', lines: [] },
    ]);
    expect((await api.preview({ period: 202601, ruleIds: [1] })).drafts[0]!.id).toBe(draft!.id);
    await app.svc.periods.setStatus(202601, 'closed');
    expect((await errorData(api.preview({ period: 202601, ruleIds: [1] }))).code).toBe(
      'PERIOD_CLOSED',
    );
  });
  it('w_zw_fz：不跳月、未过账及断号均阻止，作废占号，草稿无号', async () => {
    const api = call(app);
    await zeroOpening(app);
    expect((await errorData(api.close({ period: 202602, confirmed: true }))).message).toContain(
      '结账顺序',
    );
    const [a, b, c] = await seedVouchers(
      app.svc,
      [1, 2, 3].map(() => ({
        date: '2026-01-10',
        lines: [
          { account: '1001', debit: 1 },
          { account: '4001', credit: 1 },
        ],
      })),
    );
    await app.svc.vouchers.setVoided(a!.id, true);
    await app.svc.vouchers.delete(b!.id);
    let check = await api.check({ period: 202601 });
    expect(check.gaps).toEqual([{ period: 202601, type: '记', from: 2, to: 2 }]);
    expect((await errorData(api.close({ period: 202601, confirmed: true }))).message).toContain(
      '未过账',
    );
    await app.svc.vouchers.changeStatus({ ids: [c!.id], to: 'audited' });
    await api.post({ from: 202601, to: 202601 });
    expect((await errorData(api.close({ period: 202601, confirmed: true }))).details?.gaps).toEqual(
      check.gaps,
    );
    await expect(api.renumberPreview({ period: 202601 })).rejects.toThrow(/不是待审核/);
    await app.svc.vouchers.changeStatus({ ids: [c!.id], to: 'audited' });
    await app.svc.vouchers.changeStatus({ ids: [c!.id], to: 'pending' });
    const preview = await api.renumberPreview({ period: 202601 });
    expect(preview.changes).toMatchObject([{ id: c!.id, oldNumber: 3, number: 2 }]);
    const before = snapshot(app);
    await expect(
      api.renumber({
        period: 202601,
        previewToken: preview.previewToken,
        confirmed: true,
        confirmText: '取消',
      }),
    ).rejects.toThrow();
    expect(snapshot(app)).toBe(before);
    await api.renumber({
      period: 202601,
      previewToken: preview.previewToken,
      confirmed: true,
      confirmText: '影响已打印凭证和账册，编号不可直接恢复',
    });
    await app.svc.vouchers.changeStatus({ ids: [c!.id], to: 'audited' });
    await api.post({ from: 202601, to: 202601 });
    check = await api.check({ period: 202601 });
    expect(check.gaps).toEqual([]);
    await api.close({ period: 202601, confirmed: true });
    expect((await app.svc.periods.require(202601)).status).toBe('closed');
  });
  it('w_zw_fz：损益未转必须显式越过并记日志，草稿必须另行确认', async () => {
    const api = call(app);
    await zeroOpening(app);
    await audited(app);
    await api.post({ from: 202601, to: 202601 });
    expect((await errorData(api.close({ period: 202601, confirmed: true }))).code).toBe(
      'PERIOD_CLOSE_PNL_CONFIRM',
    );
    await seedVouchers(app.svc, [{ date: '2026-01-20', status: 'draft', lines: [] }]);
    expect(
      (await errorData(api.close({ period: 202601, confirmed: true, allowUntransferredPnl: true })))
        .code,
    ).toBe('PERIOD_CLOSE_DRAFT_CONFIRM');
    await api.close({
      period: 202601,
      confirmed: true,
      allowUntransferredPnl: true,
      acknowledgeDrafts: true,
    });
    expect((await api.check({ period: 202601 })).items.find((i) => i.id === 'pnl')!.pass).toBe(
      false,
    );
    expect(
      (await app.svc.log.list()).find((l) => l.action === 'period-close.close')!.summary,
    ).toContain('明确确认损益未结转');
  });
  it('w_zw_qxfz：从最近已结逐月反结到启用月，同年手工期初不删', async () => {
    const api = call(app);
    await zeroOpening(app);
    const opening = await app.svc.opening.list(2026);
    for (const period of [202601, 202602, 202603]) await api.close({ period, confirmed: true });
    const before = snapshot(app);
    expect((await errorData(api.reopen({ from: 202601, to: 202602, confirmed: true }))).code).toBe(
      'PERIOD_CLOSE_REOPEN_ORDER',
    );
    expect(snapshot(app)).toBe(before);
    await api.reopen({ from: 202601, to: 202603, confirmed: true });
    expect(await app.svc.opening.list(2026)).toEqual(opening);
    expect((await app.svc.periods.list()).every((p) => p.status === 'open')).toBe(true);
    await expect(api.reopen({ from: 202512, to: 202601, confirmed: true })).rejects.toThrow();
  });
  it('w_zw_ydjz_ts：一键在真实审核检查点停止且逐项鉴权，恢复后不重生', async () => {
    const api = call(app);
    await zeroOpening(app);
    const { reviewerSvc } = await audited(app);
    await api.saveRule({ data: await rule(app) });
    const restricted = call(
      app,
      await app.addUser('poster', { permissions: ['period-close.post'] }),
    );
    const before = snapshot(app);
    expect(
      (await errorData(restricted.workflow({ period: 202601, ruleIds: [1], confirmed: true })))
        .code,
    ).toBe('FORBIDDEN');
    expect(snapshot(app)).toBe(before);
    expect((await api.workflow({ period: 202601, ruleIds: [1], confirmed: true })).stage).toBe(
      '确认结转预览',
    );
    const { result } = await generateAll(app);
    const id = result.generated[0]!.id;
    expect((await api.workflow({ period: 202601, ruleIds: [1], confirmed: true })).stage).toBe(
      '审核检查点',
    );
    expect((await app.svc.vouchers.get(id))!.status).toBe('pending');
    await reviewerSvc.vouchers.changeStatus({ ids: [id], to: 'audited' });
    expect((await api.workflow({ period: 202601, ruleIds: [1], confirmed: true })).stage).toBe(
      '已结账',
    );
    expect((await api.workflow({ period: 202601, ruleIds: [1], confirmed: true })).stage).toBe(
      '已结账',
    );
    expect((await app.svc.vouchers.list({ sourceModule: 'period-close' })).total).toBe(1);
  });
  it('w_zw_fgz/ydjz：先2月结转后1月结转或反过账必须阻止，规则/来源删除受依赖保护', async () => {
    const api = call(app);
    await zeroOpening(app);
    await api.saveRule({ data: await rule(app) });
    await seedVouchers(app.svc, [
      {
        date: '2026-01-05',
        status: 'posted',
        lines: [
          { account: '1001', debit: 1000 },
          { account: '6001', credit: 1000 },
        ],
      },
    ]);
    const { result } = await generateAll(app, 202602);
    await app.svc.vouchers.changeStatus({ ids: [result.generated[0]!.id], to: 'audited' });
    await api.post({ from: 202602, to: 202602 });
    const before = snapshot(app);
    expect((await errorData(api.preview({ period: 202601, ruleIds: [1] }))).code).toBe(
      'PERIOD_CLOSE_LATER_TRANSFER',
    );
    expect((await errorData(api.unpost({ from: 202601, to: 202601, confirmed: true }))).code).toBe(
      'PERIOD_CLOSE_LATER_TRANSFER',
    );
    expect(
      (await errorData(api.saveRule({ data: await rule(app), id: 1, revision: 1 }))).code,
    ).toBe('PERIOD_CLOSE_RULE_USED');
    expect(
      (await errorData(api.deleteGenerated({ period: 202602, ruleId: 1, confirmed: true }))).code,
    ).toBe('PERIOD_CLOSE_TRANSFER_LOCKED');
    expect(snapshot(app)).toBe(before);
  });
  it('w_zw_jz：结转基数变化后过账整体回滚，不能把过期凭证过账', async () => {
    const api = call(app);
    await zeroOpening(app);
    await api.saveRule({ data: await rule(app) });
    await audited(app);
    await api.post({ from: 202601, to: 202601 });
    const { result } = await generateAll(app);
    await app.svc.vouchers.changeStatus({ ids: [result.generated[0]!.id], to: 'audited' });
    await seedVouchers(app.svc, [
      {
        date: '2026-01-10',
        status: 'audited',
        lines: [
          { account: '1001', debit: 1 },
          { account: '6001', credit: 1 },
        ],
      },
    ]);
    const before = snapshot(app);
    expect((await errorData(api.post({ from: 202601, to: 202601 }))).code).toBe(
      'PERIOD_CLOSE_STALE_TRANSFER',
    );
    expect(snapshot(app)).toBe(before);
  });
});

it('w_zw_jz：大额正负期初相抵仍精确到分，不用浮点中间和掩盖差额', async () => {
  const api = call(app);
  const entries = [
    ['1001', 9007199254740991],
    ['100201', 1],
    ['4001', -9007199254740991],
  ] as const;
  for (const [code, balance] of entries)
    await app.svc.opening.upsert({
      year: 2026,
      accountId: (await app.svc.accounts.require(code)).id,
      balance,
    });
  expect((await errorData(api.post({ from: 202601, to: 202601 }))).message).toContain(
    '余额差额 0.01',
  );
});
