import type { CoreServices } from '@caiwu/core/server';
import { seedVouchers, type VoucherSpec } from '@caiwu/testkit';
import {
  buildPurchaseReclassificationComparatives,
  type PurchaseBindings,
  type PurchaseDateBindings,
} from '../../templates/enterprise/purchase-reclassification';

const current = (reason: string) => ({ state: 'current' as const, reason });
const excluded = (reason: string, destination: string) => ({
  state: 'excluded' as const,
  reason,
  destination,
});
const operating = () => current('该日期合成采购合同属于已确认的正常营业周期内材料及服务结算');

export function purchaseBindings(): PurchaseBindings {
  const items = (): PurchaseDateBindings['items'] => [
    { account: '190101', partner: 'S001', debit: operating(), credit: operating() },
    { account: '190101', partner: 'S002', debit: operating(), credit: operating() },
    { account: '190102', partner: 'S001', debit: operating(), credit: operating() },
    { account: '290101', partner: 'S001', debit: operating(), credit: operating() },
    { account: '290101', partner: 'S002', debit: operating(), credit: operating() },
    { account: '290102', partner: 'S001', debit: operating(), credit: operating() },
    { account: '290102', partner: 'S002', debit: operating(), credit: operating() },
  ];
  const now = items();
  now[1]!.credit = excluded(
    '本期对应设备价款，核定在正常营业周期外且一年以后清偿',
    '其他非流动负债，另行配置',
  );
  now[3]!.credit = excluded(
    '本期合同已明确展期至正常营业周期外且一年以后清偿',
    '长期应付款，另行配置',
  );
  now[4]!.debit = excluded(
    '本期借方为正常营业周期外且一年以后交付的设备订金',
    '其他非流动资产，另行配置',
  );
  const prior = items();
  prior[0]!.debit = excluded(
    '上年末为正常营业周期外且一年以后交付的设备预付，次年已更改采购标的',
    '其他非流动资产，另行配置',
  );
  prior[2]!.credit = excluded(
    '上年末该笔设备采购款在正常营业周期外且一年以后清偿',
    '其他非流动负债，另行配置',
  );
  prior[6]!.credit = excluded(
    '上年末合同明确在正常营业周期外且一年以后清偿，本期协议已变更',
    '长期应付款，另行配置',
  );
  return {
    period: 202601,
    current: { prepayments: ['1901'], payables: ['290101', '290102'], items: now },
    previous: { prepayments: ['190101', '190102'], payables: ['2901'], items: prior },
  };
}

/** 全部编码及期限依据均为本合成账套自定义，不是官方科目表或真实合同。 */
export async function seedPurchaseFixture(svc: CoreServices) {
  await svc.periods.ensureYear(2026);
  for (const [root, categoryId, direction] of [
    ['1901', 'asset', 'debit'],
    ['2901', 'liability', 'credit'],
  ] as const) {
    for (const code of [root, `${root}01`, `${root}02`])
      await svc.accounts.create(
        {
          code,
          name: `合成采购来源${code}`,
          categoryId,
          direction,
          isPartner: true,
          dimensions: [{ type: 'partner' }],
        },
        [4, 2, 2],
      );
  }
  await svc.dimensions.create({ type: 'partner', code: 'S002', name: '合成第二供应商' });
  const balances = [
    // 账户、往来、2025-12变动、2026-01变动；借正贷负，单位为整数分。
    ['190101', 'S001', 10000, -2000],
    ['190101', 'S002', -3000, 1000],
    ['190102', 'S001', -2000, 5000],
    ['290101', 'S001', -12000, 3000],
    ['290101', 'S002', 4000, -1000],
    ['290102', 'S001', 1500, 500],
    ['290102', 'S002', -6000, 2000],
  ] as const;
  const specs: VoucherSpec[] = [];
  for (const [account, partner, prior, movement] of balances)
    for (const [date, signed] of [
      ['2025-12-15', prior],
      ['2026-01-15', movement],
    ] as const)
      specs.push({
        date,
        status: 'posted',
        lines:
          signed > 0
            ? [
                { account, debit: signed, dims: { partner } },
                { account: '4001', credit: signed },
              ]
            : [
                { account, credit: -signed, dims: { partner } },
                { account: '4001', debit: -signed },
              ],
      });
  await seedVouchers(svc, specs);
}

export async function purchaseTemplate(svc: CoreServices, bindings = purchaseBindings()) {
  return buildPurchaseReclassificationComparatives(
    bindings,
    await svc.accounts.list(),
    await svc.dimensions.items('partner'),
  );
}
