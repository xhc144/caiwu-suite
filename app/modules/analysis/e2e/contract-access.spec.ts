import { createCoreServices } from '@caiwu/core/server';
import { E2E_APP_TOKEN, callApi, loginWithNewBook } from '@caiwu/testkit/e2e';
import { seedVouchers } from '@caiwu/testkit';
import { test, expect } from './fixture';

test('w_ht_pz P1：真实受限用户枚举来源凭证，候选与关联响应不泄漏摘要、金额或分录数量', async ({
  page,
  isolated,
}) => {
  const { bookId, token } = await loginWithNewBook(page, isolated.request);
  let accountId = 0;
  let partnerId = 0;
  let manualId = 0;
  const sources: { id: number; lineId: number }[] = [];
  const secret = '仅来源模块可读的私密工资资产摘要';
  const secretAmount = 7654321;
  await isolated.seed(bookId, async (svc) => {
    accountId = (
      await svc.accounts.create(
        {
          code: '100203',
          name: '合同银行',
          isBank: true,
          dimensions: [{ type: 'partner', required: true }],
        },
        [4, 2, 2],
      )
    ).id;
    partnerId = (await svc.dimensions.getByCode('partner', 'C001'))!.id;
    for (const [index, moduleId] of ['payroll', 'fixed-assets', 'unknown-source'].entries()) {
      const owner = createCoreServices({ ...svc.ctx, moduleId });
      const voucher = await owner.vouchers.create({
        voucherTypeId: (await svc.reference.voucherTypes())[0]!.id,
        date: '2026-01-15',
        source: { type: 'batch', id: `private-${index}` },
        lines: [
          { accountId, dimensions: { partner: partnerId }, debit: secretAmount, summary: secret },
          ...Array.from({ length: index }, () => ({
            accountId,
            dimensions: { partner: partnerId },
            credit: 1,
            summary: secret,
          })),
          {
            accountId: (await svc.accounts.require('6001')).id,
            credit: secretAmount - index,
            summary: secret,
          },
        ],
      });
      await owner.vouchers.changeStatus({ ids: [voucher.id], to: 'audited' });
      await owner.vouchers.changeStatus({ ids: [voucher.id], to: 'posted' });
      sources.push({ id: voucher.id, lineId: voucher.lines[0]!.id });
    }
    manualId = (
      await seedVouchers(svc, [
        {
          date: '2026-01-15',
          status: 'posted',
          lines: [
            { account: '100203', debit: 100, dims: { partner: 'C001' } },
            { account: '6001', credit: 100 },
          ],
        },
      ])
    )[0]!.id;
    for (const [code, permissions] of [
      ['limited', ['analysis.contract.view', 'analysis.contract.link']],
      ['viewer', ['analysis.contract.view']],
      [
        'source-reader',
        [
          'analysis.contract.view',
          'analysis.contract.link',
          'payroll.salary.view',
          'fixed-assets.view',
        ],
      ],
    ] as const)
      await svc.users.create({
        code,
        name: code,
        password: 'test-pass',
        permissions: [...permissions],
      });
  });
  const row = await callApi<{ id: number; revision: number }>(
    isolated.request,
    'm.analysis.contracts.save',
    {
      expectedRevision: 0,
      code: 'ACCESS',
      name: '读取边界测试合同',
      accountId,
      partnerId,
      signedDate: '2026-01-01',
      kind: 'receipt',
      amount: 10000,
      opening: 0,
    },
    { token, method: 'POST' },
  );
  const reviewed = await callApi<{ revision: number }>(
    isolated.request,
    'm.analysis.contracts.review',
    { id: row.id, expectedRevision: row.revision, reviewed: true },
    { token, method: 'POST' },
  );
  const login = async (userCode: string) => {
    const session = await callApi<{ token: string; user: { permissions: string[] } }>(
      isolated.request,
      'core.auth.login',
      {
        bookId,
        userCode,
        password: 'test-pass',
      },
    );
    if (userCode === 'limited')
      expect(session.user.permissions).toEqual([
        'analysis.contract.link',
        'analysis.contract.view',
      ]);
    if (userCode === 'source-reader')
      expect(session.user.permissions).toEqual(
        expect.arrayContaining(['payroll.salary.view', 'fixed-assets.view']),
      );
    return session.token;
  };
  const limited = await login('limited');
  const viewer = await login('viewer');
  const sourceReader = await login('source-reader');
  const requestCandidates = async (auth: string, voucherId: number) => {
    const response = await isolated.request.get(
      `/trpc/m.analysis.contracts.candidates?input=${encodeURIComponent(JSON.stringify({ id: row.id, voucherId }))}`,
      { headers: { 'x-caiwu-token': E2E_APP_TOKEN, authorization: `Bearer ${auth}` } },
    );
    return { response, body: await response.json() };
  };
  let denied: unknown;
  for (const auth of [limited, sourceReader, token])
    for (const source of [...sources, { id: 999999, lineId: 999999 }]) {
      const { response, body } = await requestCandidates(auth, source.id);
      expect(response.ok()).toBe(false);
      expect(body.result).toBeUndefined();
      expect(body.error.data.business.code).toBe('ANALYSIS_CONTRACT_VOUCHER_READ_DENIED');
      denied ??= body.error.data.business;
      expect(body.error.data.business).toEqual(denied);
      const text = JSON.stringify(body);
      for (const field of [
        secret,
        String(secretAmount),
        'accountCode',
        'summary',
        'debit',
        'credit',
        'displayNo',
        'lines',
        'lineCount',
        'source_module',
        'source_type',
        'source_id',
      ])
        expect(text).not.toContain(field);
      const link = await isolated.request.post('/trpc/m.analysis.contracts.link', {
        headers: { 'x-caiwu-token': E2E_APP_TOKEN, authorization: `Bearer ${auth}` },
        data: {
          id: row.id,
          expectedRevision: reviewed.revision,
          voucherId: source.id,
          lineId: source.lineId,
        },
      });
      expect(link.ok()).toBe(false);
      expect((await link.json()).error.data.business).toEqual(denied);
    }
  expect((await requestCandidates(viewer, manualId)).response.status()).toBe(403);
  const allowed = await requestCandidates(limited, manualId);
  expect(allowed.response.ok()).toBe(true);
  expect(allowed.body.result.data.lines).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ accountCode: '100203', debit: 100, reason: null }),
    ]),
  );
  const unchanged = await callApi<{ revision: number; lines: unknown[] }>(
    isolated.request,
    'm.analysis.contracts.get',
    { id: row.id },
    { token, method: 'GET' },
  );
  expect(unchanged).toMatchObject({ revision: reviewed.revision, lines: [] });
});
