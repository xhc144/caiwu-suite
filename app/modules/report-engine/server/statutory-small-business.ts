import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CoreServices } from '@caiwu/core/server';
import {
  ConfigurationSchema,
  initialConfiguration,
  initialDetails,
  resolveRoles,
  rowKey,
} from '../templates/small-business/configuration';
import { source, type Amount } from '../templates/small-business/statements';
import {
  smallBusinessDescriptor,
  saveConfiguration,
  smallBusinessConfigurationData,
  prepareSmallBusiness,
  assertSmallBusinessOutput,
  type PreparedSmallBusiness,
} from '../templates/small-business/statutory.server';
import { statementWorkbook, statementPrintJob } from '../templates/small-business/output';
import type { StatutoryAdapter } from './statutory-registry';
import { statutoryProblem } from './statutory-registry';
import type { StatutoryProfile } from '../shared';

export const SmallPublicConfigurationSchema = z
  .object({
    period: z.number().int(),
    scope: z.enum(['month', 'annual']),
    value: ConfigurationSchema,
  })
  .strict();
const nativeKey = 'statutory.small-business.configuration';
type SmallConfiguration = z.infer<typeof ConfigurationSchema>;
/** 旧制度接口仍通过settings访问配置；这里只投影当前profile，不读写第二份账套参数。 */
function projectConfiguration(
  svc: CoreServices,
  configuration: SmallConfiguration,
  saved?: (value: SmallConfiguration) => void,
): CoreServices {
  return {
    ...svc,
    settings: {
      ...svc.settings,
      async get<T>(key: string, fallback: T): Promise<T> {
        return key === nativeKey ? (configuration as T) : svc.settings.get(key, fallback);
      },
      async set<T>(key: string, value: T) {
        if (key !== nativeKey || !saved) statutoryProblem('报表配置只能通过公共保存入口修改');
        saved(ConfigurationSchema.parse(value));
      },
    },
  };
}
/** 核源不借用generate权限；完整读取本年、比较年、期初和凭证版本。 */
async function sourceDigest(svc: CoreServices, c: z.infer<typeof SmallPublicConfigurationSchema>) {
  const book = await svc.book.info();
  if (c.value.bookId !== book.id) statutoryProblem('配置属于另一账套，请重新配置');
  const from = Math.max(book.startPeriod, (Math.floor(c.period / 100) - 1) * 100 + 1);
  const entries = await svc.ledger.entries({
    periodFrom: from,
    periodTo: c.period,
    includeUnposted: false,
    limit: 200000,
  });
  if (entries.length >= 200000) statutoryProblem('明细达到读取上限，无法保证报表来源完整');
  const periods = await svc.periods.list();
  const balances = [];
  for (const period of periods.filter((p) => p.period >= from && p.period <= c.period))
    balances.push([
      period.period,
      await svc.ledger.balances({
        periodFrom: period.period,
        periodTo: period.period,
        rollup: false,
        includeZero: true,
        groupBy: ['partner', 'project', 'department', 'person'],
      }),
    ]);
  const vouchers = [];
  for (let offset = 0; ; offset += 10000) {
    const page = await svc.vouchers.list({
      periodFrom: from,
      periodTo: c.period,
      offset,
      limit: 10000,
    });
    vouchers.push(...page.items);
    if (vouchers.length >= page.total) break;
    if (!page.items.length) statutoryProblem('凭证来源分页不完整，请重新读取');
  }
  const openings = await Promise.all(
    [
      ...new Set(
        periods.filter((p) => p.period <= c.period).map((p) => Math.floor(p.period / 100)),
      ),
    ].map((year) => svc.opening.list(year)),
  );
  return createHash('sha256')
    .update(
      JSON.stringify({
        book,
        configuration: c,
        accounts: await svc.accounts.list({ includeDisabled: true }),
        categories: await svc.accounts.categories(),
        periods,
        entries,
        balances,
        vouchers,
        openings,
      }),
    )
    .digest('hex');
}
const mode = (scope: string) => (scope === 'annual' ? ('annual' as const) : ('monthly' as const));
function selected(result: unknown, key: string) {
  const prepared = result as PreparedSmallBusiness;
  assertSmallBusinessOutput(prepared);
  const statement = prepared.statements.find((s) => s.code === key);
  if (!statement) statutoryProblem('成功结果中没有所选报表');
  return { prepared, statement };
}
export const smallBusinessAdapter: StatutoryAdapter = {
  definitionId: smallBusinessDescriptor.id,
  definitionRevision: smallBusinessDescriptor.version,
  name: smallBusinessDescriptor.name,
  regime: smallBusinessDescriptor.regime,
  products: ['qingsong', 'chengben'],
  descriptors: smallBusinessDescriptor.reports.map((r) => ({
    ...r,
    key: r.code,
    annualOnly: false,
  })),
  async editor(svc, period, scope, raw) {
    let value: SmallConfiguration;
    if (raw) value = SmallPublicConfigurationSchema.parse(raw).value;
    else {
      value = initialConfiguration((await svc.book.info()).id);
      value.details = initialDetails(await svc.accounts.list({ includeDisabled: true }), value);
    }
    const configuration = {
      period,
      scope: scope === 'annual' ? ('annual' as const) : ('month' as const),
      value,
    };
    return {
      configuration,
      source: {
        ...(await smallBusinessConfigurationData(
          projectConfiguration(svc, value),
          period,
          mode(scope),
        )),
        periods: await svc.periods.list(),
      },
    };
  },
  async prepare(svc, raw) {
    const c = SmallPublicConfigurationSchema.parse(raw);
    if (c.scope === 'annual' && c.period % 100 !== 12) statutoryProblem('年报必须选择十二月');
    await svc.periods.require(c.period);
    let value = c.value;
    await saveConfiguration(
      projectConfiguration(svc, value, (next) => {
        value = next;
      }),
      c.value,
      c.value.revision,
    );
    const configuration = { ...c, value };
    return { configuration, sourceDigest: await sourceDigest(svc, configuration) };
  },
  async verify(svc, p, period) {
    const c = SmallPublicConfigurationSchema.parse(p.configuration);
    if (c.period !== period) statutoryProblem('报告期间与已确认配置不同，请重新确认');
    if ((await sourceDigest(svc, c)) !== p.sourceDigest)
      statutoryProblem('账务、科目或来源已变化，请核实后重新保存确认');
  },
  async generate(svc, p, period, confirmUnposted) {
    const c = SmallPublicConfigurationSchema.parse(p.configuration);
    const from =
      c.scope === 'annual'
        ? (Math.floor(period / 100) - 1) * 100 + 1
        : Math.floor(period / 100) * 100 + 1;
    const pending = await svc.vouchers.list({
      periodFrom: from,
      periodTo: period,
      statuses: ['draft', 'pending', 'audited'],
      limit: 1,
    });
    if (pending.total && !confirmUnposted)
      return { kind: 'confirmation', count: pending.total, from, to: period };
    const result = await prepareSmallBusiness(projectConfiguration(svc, c.value), {
      period,
      mode: mode(c.scope),
      confirmUnposted,
    });
    assertSmallBusinessOutput(result);
    // 只补已计算减项的来源和展示数据，不改制度金额公式。
    const balance = result.statements[0];
    if (balance.returnedInvestment?.some(Boolean)) {
      const data = await smallBusinessConfigurationData(
        projectConfiguration(svc, c.value),
        period,
        mode(c.scope),
      );
      const roles = resolveRoles(data.accounts, c.value);
      const amounts = [0, 1].map((column) => {
        const at = column === 0 ? period : (Math.floor(period / 100) - 1) * 100 + 12;
        const from = column === 0 ? period : Math.floor(period / 100) * 100 + 1;
        const sources = data.analysisRows
          .filter((a) => a.period === at && roles.get(a.row.accountCode) === 'returnedCapital')
          .flatMap((a) => {
            const fact = c.value.facts.find((f) => f.period === at && f.key === rowKey(a.row));
            return (fact?.allocations ?? [])
              .filter((p) => p.role === 'returnedCapital')
              .map((p) => source(a.row, p.amount, from, from));
          });
        const value = balance.returnedInvestment![column]!;
        if (sources.reduce((sum, s) => sum + BigInt(s.amount), 0n) !== BigInt(value))
          statutoryProblem('已归还投资减项缺少完整明细来源，请核实后重新生成');
        return { value, formula: '已归还投资：真实借方明细', sources };
      }) as [Amount, Amount];
      (
        balance as typeof balance & { returnedInvestmentAmounts: [Amount, Amount] }
      ).returnedInvestmentAmounts = amounts;
    }
    return { kind: 'generated', result, unpostedCount: result.unpostedCount };
  },
  workbook: async (result, key) => {
    const { prepared, statement } = selected(result, key);
    return statementWorkbook(prepared, statement);
  },
  print: (result, key) => {
    const { prepared, statement } = selected(result, key);
    return statementPrintJob(prepared, statement);
  },
};
export type SmallPublicSource = Awaited<ReturnType<typeof smallBusinessConfigurationData>> & {
  periods: { period: number }[];
};
export type SmallPublicConfiguration = z.infer<typeof SmallPublicConfigurationSchema>;
export type SmallProfile = StatutoryProfile;
