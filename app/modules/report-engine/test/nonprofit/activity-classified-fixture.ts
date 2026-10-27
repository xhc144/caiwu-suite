import type { CoreServices } from '@caiwu/core/server';
import { seedVouchers, voucherInputFromSpec } from '@caiwu/testkit';
import type { ActivityClassifiedMapping } from '../../templates/nonprofit/activity-classified';
import { activityFixtureChart, activityFixtureMapping } from './activity-fixture';
import { nonprofitTestServer } from './fixture';

const roots = Object.values(activityFixtureMapping().groups).map((g) => g.accounts[0]!);
export const classifiedChart = {
  ...activityFixtureChart,
  id: 'test-nonprofit-classified',
  accounts: [
    ...activityFixtureChart.accounts,
    ...roots.flatMap((root, index) =>
      root === '4101' || root === '5101'
        ? []
        : ['01', '02'].map((suffix) => ({
            code: `${root}${suffix}`,
            name: `虚构业务${suffix}`,
            category: index < 8 ? 'revenue' : 'expense',
          })),
    ),
  ],
};
export const classifiedServer = { ...nonprofitTestServer, templates: [classifiedChart] };

export function classifiedMapping(period = 202602): ActivityClassifiedMapping {
  const totals = activityFixtureMapping(period);
  return {
    totals,
    recognitions: [],
    groups: Object.fromEntries(
      Object.entries(totals.groups).map(([id, group]) => {
        const root = group.accounts[0]!;
        return [
          id,
          {
            unrestricted: [
              {
                account: `${root}01`,
                exclusiveResource: true,
                evidence: {
                  authority: 'assetProvider',
                  issuer: `虚构外部资源提供者U-${id}`,
                  sourceReference: `虚构协议U-${id}（2026年1–2月有效，无追加限制）`,
                  resourceReference: `U-${id}批次；${root}01仅核算本批次取得及使用`,
                  specificClause: '逐项核对协议全部条款：资产使用未设置时间限制或用途限制',
                  conclusion: 'noExternalRestriction',
                },
              },
            ],
            restricted: [
              {
                account: `${root}02`,
                exclusiveResource: true,
                evidence: {
                  authority: 'assetProvider',
                  issuer: `虚构外部资源提供者R-${id}`,
                  sourceReference: `虚构协议R-${id}（2026年1–2月有效，无解除变更）`,
                  resourceReference: `R-${id}批次；${root}02仅核算本批次取得及使用`,
                  specificClause: '提供者约定仅用于受助学生学费，比组织章程要求具体；无时间限制',
                  purpose: { description: '受助学生学费专用' },
                },
                recognitionReference: `虚构R-${id}批次取得或学费支出明细，逐笔关联${root}02；退回沿用原批次`,
              },
            ],
          },
        ];
      }),
    ) as ActivityClassifiedMapping['groups'],
  };
}

/** 仅供本合成科目表：01批次明确为U，02批次明确为R。读真实凭证身份与金额，
 * 分类事实来自造数约定；不调用生产profile或其自动推断，也不用于真实账套。 */
export async function confirmClassifiedFixture(
  svc: CoreServices,
  mapping = classifiedMapping(),
): Promise<ActivityClassifiedMapping> {
  const confirmed = structuredClone(mapping);
  confirmed.recognitions = [];
  const rows = await svc.db
    .selectFrom('voucher_line as l')
    .innerJoin('voucher as v', 'v.id', 'l.voucher_id')
    .innerJoin('account as a', 'a.id', 'l.account_id')
    .select(['l.id', 'l.voucher_id', 'v.revision', 'l.period', 'a.code', 'l.debit', 'l.credit'])
    .where('v.status', '=', 'posted')
    .where('v.voided', '=', 0)
    .where('l.period', '>=', Math.floor(mapping.totals.period / 100) * 100 + 1)
    .where('l.period', '<=', mapping.totals.period)
    .where((eb) => eb.or([eb('v.closing_kind', 'is', null), eb('v.closing_kind', '!=', 'pnl')]))
    .orderBy('l.id')
    .execute();
  for (const e of rows) {
    const index = roots.findIndex((root) => e.code === `${root}01` || e.code === `${root}02`);
    if (index === -1) continue; // 1122往来对方不属于本夹具收入费用。
    const id = Object.keys(confirmed.groups)[index] as keyof typeof confirmed.groups;
    const classification = e.code.endsWith('01') ? 'unrestricted' : 'restricted';
    const leaf = confirmed.groups[id][classification][0]!;
    confirmed.recognitions.push({
      voucherId: e.voucher_id,
      lineId: e.id,
      revision: e.revision,
      period: e.period,
      account: e.code,
      debit: e.debit,
      credit: e.credit,
      classification,
      resourceReference: leaf.evidence.resourceReference,
      sourceReference: leaf.evidence.sourceReference,
      classificationBasis:
        'recognitionReference' in leaf
          ? {
              exclusiveResource: true,
              evidence: structuredClone(leaf.evidence),
              recognitionReference: leaf.recognitionReference,
            }
          : { exclusiveResource: true, evidence: structuredClone(leaf.evidence) },
    });
  }
  return confirmed;
}

/** 独立手算：每行依次为本月非限定/限定、累计非限定/限定，单位分。
 * 1月第n项为1000n/2000n，2月为100n/200n。
 * 捐赠2月另退150/75、自定义转账冲减非限定25；投资收益非限定另损失1000；
 * 业务成本退120/60、自定义转账冲减非限定15；其他费用非限定退2000。 */
export const classifiedGolden: Readonly<Record<number, readonly [number, number, number, number]>> =
  {
    6: [-75, 125, 925, 2125],
    7: [200, 400, 2200, 4400],
    8: [300, 600, 3300, 6600],
    9: [400, 800, 4400, 8800],
    10: [500, 1000, 5500, 11000],
    11: [600, 1200, 6600, 13200],
    12: [-300, 1400, 6700, 15400],
    13: [800, 1600, 8800, 17600],
    14: [2425, 7125, 38425, 79125],
    16: [765, 1740, 9765, 19740],
    19: [1000, 2000, 11000, 22000],
    20: [1100, 2200, 12100, 24200],
    21: [1200, 2400, 13200, 26400],
    23: [1300, 2600, 14300, 28600],
    24: [1400, 2800, 15400, 30800],
    25: [-500, 3000, 14500, 33000],
    26: [6265, 16740, 90265, 184740],
  };

export async function seedClassifiedBook(svc: CoreServices) {
  // 不使用其他业务模块页面或接口，也不复用旧合计夹具的账务发生额。
  for (const [index, root] of roots.entries()) {
    const income = index < 8;
    for (const [date, factor] of [
      ['2026-01-05', 1000],
      ['2026-02-05', 100],
    ] as const)
      for (const [suffix, multiplier] of [
        ['01', 1],
        ['02', 2],
      ] as const) {
        const amount = (index + 1) * factor * multiplier;
        await seedVouchers(svc, [
          {
            date,
            status: 'posted',
            lines: income
              ? [
                  { account: '1122', debit: amount },
                  { account: `${root}${suffix}`, credit: amount },
                ]
              : [
                  { account: `${root}${suffix}`, debit: amount },
                  { account: '1122', credit: amount },
                ],
          },
        ]);
      }
  }
  await seedVouchers(svc, [
    {
      date: '2026-02-06',
      status: 'posted',
      lines: [
        { account: '410101', debit: 150 },
        { account: '410102', debit: 75 },
        { account: '1122', credit: 225 },
      ],
    },
    {
      date: '2026-02-07',
      status: 'posted',
      lines: [
        { account: '430501', debit: 1000 },
        { account: '1122', credit: 1000 },
      ],
    },
    {
      date: '2026-02-08',
      status: 'posted',
      lines: [
        { account: '1122', debit: 180 },
        { account: '510101', credit: 120 },
        { account: '510102', credit: 60 },
      ],
    },
    {
      date: '2026-02-09',
      status: 'posted',
      lines: [
        { account: '1122', debit: 2000 },
        { account: '540401', credit: 2000 },
      ],
    },
  ]);
  const custom = await svc.vouchers.create({
    ...(await voucherInputFromSpec(svc, {
      date: '2026-02-10',
      lines: [
        { account: '410101', debit: 25 },
        { account: '510101', credit: 15 },
        { account: '1122', credit: 10 },
      ],
    })),
    closingKind: 'period-close:classified-custom',
  });
  await svc.vouchers.changeStatus({ ids: [custom.id], to: 'audited' });
  await svc.vouchers.changeStatus({ ids: [custom.id], to: 'posted' });
}

export async function closeClassifiedPnl(svc: CoreServices) {
  const rows = await svc.ledger.balances({ periodFrom: 202601, periodTo: 202602, rollup: false });
  for (const [suffix, netAsset] of [
    ['01', '3101'],
    ['02', '3102'],
  ] as const) {
    const pnl = rows.filter((r) => roots.some((root) => r.accountCode === `${root}${suffix}`));
    const net = pnl.reduce((sum, r) => sum + r.closing, 0);
    const v = await svc.vouchers.create({
      ...(await voucherInputFromSpec(svc, {
        date: '2026-02-28',
        lines: [
          ...pnl.map((r) =>
            r.closing < 0
              ? { account: r.accountCode, debit: -r.closing }
              : { account: r.accountCode, credit: r.closing },
          ),
          ...(net > 0
            ? [{ account: netAsset, debit: net }]
            : [{ account: netAsset, credit: -net }]),
        ],
      })),
      closingKind: 'pnl',
    });
    await svc.vouchers.changeStatus({ ids: [v.id], to: 'audited' });
    await svc.vouchers.changeStatus({ ids: [v.id], to: 'posted' });
  }
}
