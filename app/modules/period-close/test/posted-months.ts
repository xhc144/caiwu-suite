import { createCoreServices } from '@caiwu/core/server';
import { seedVouchers, type TestApp } from '@caiwu/testkit';
import periodCloseServer from '../server';

/** 两月真实结转：本月生成、异人审核并过账后，才准备下月业务。 */
export async function seedPostedMonths(app: TestApp) {
  const api = app.call(periodCloseServer);
  const reviewerUser = await app.svc.users.create({
    code: 'monthly-reviewer',
    name: '月结审核员',
    password: '',
    permissions: [],
  });
  const reviewer = createCoreServices({ ...app.svc.ctx, user: reviewerUser });
  await api.saveRule({
    data: {
      code: 'MONTHLY',
      name: '两月自定义结转',
      kind: 'custom',
      voucherTypeId: (await app.svc.reference.voucherTypes())[0]!.id,
      summary: '本月余额结转',
      order: 1,
      enabled: true,
      targetAccountId: (await app.svc.accounts.require('4103')).id,
      sources: [
        { accountId: (await app.svc.accounts.require('4001')).id, mode: 'balance', ratio: '100' },
      ],
    },
  });
  const ruleId = (await api.rules())[0]!.id;
  const originals: number[] = [];
  const generated: number[] = [];
  for (const month of [1, 2]) {
    const vouchers = await seedVouchers(app.svc, [
      {
        date: `2026-0${month}-05`,
        status: 'posted',
        lines: [
          { account: '4001', debit: 100 },
          { account: '4103', credit: 100 },
        ],
      },
    ]);
    originals.push(vouchers[0]!.id);
    const period = 202600 + month;
    const preview = await api.preview({ period, ruleIds: [ruleId] });
    const result = await api.generate({
      period,
      ruleIds: [ruleId],
      confirmed: true,
      previewToken: preview.previewToken,
    });
    const id = result.generated[0]!.id;
    generated.push(id);
    await reviewer.vouchers.changeStatus({ ids: [id], to: 'audited' });
    await api.post({ from: period, to: period });
  }
  return { ruleId, originals, generated, reviewerId: reviewerUser.id };
}
