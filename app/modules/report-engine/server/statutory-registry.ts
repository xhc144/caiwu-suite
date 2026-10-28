import { BusinessError, zDate, zPeriod, type BookInfo, type ProductId } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import type { StatutoryPrintJob, StatutoryProfile } from '../shared';
import {
  enterpriseRegistration,
  prepareEnterprise,
  verifyEnterprise,
  generateEnterprise,
  readEnterpriseSources,
} from '../templates/enterprise/statutory.server';
import {
  parseEnterpriseConfiguration,
  EnterpriseConfigSchema,
  type EnterpriseConfig,
  type EnterpriseResult,
} from '../templates/enterprise/model';
import { createEnterpriseDraft } from '../templates/enterprise/mapping';
import { enterpriseWorkbookBase64 } from '../templates/enterprise/output.server';
import { enterprisePrintHtml } from '../templates/enterprise/output';
import { smallBusinessAdapter } from './statutory-small-business';
import { nonprofitAdapter } from './statutory-nonprofit';
import { statutoryPrintJob } from './statutory-print';

type Configuration = StatutoryProfile['configuration'];

/** 编辑过程允许日期、金额和选择项暂未填好；字段层级及数据类型仍沿用模板定义。 */
function draftShape(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodObject)
    return z
      .object(
        Object.fromEntries(
          Object.entries(schema.shape as Record<string, z.ZodType>).map(([key, value]) => [
            key,
            draftShape(value),
          ]),
        ),
      )
      .strict();
  if (schema instanceof z.ZodArray)
    return z.array(draftShape(schema.element as z.ZodType)).max(200000);
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault)
    return draftShape(schema.unwrap() as z.ZodType).optional();
  if (schema instanceof z.ZodNullable) return draftShape(schema.unwrap() as z.ZodType).nullable();
  if (schema instanceof z.ZodString || schema instanceof z.ZodEnum) return z.string().max(100000);
  if (schema instanceof z.ZodNumber) return z.number();
  if (schema instanceof z.ZodBoolean) return z.boolean();
  return schema;
}
const enterpriseDraftOptions = z
  .object({
    enterpriseDraft: z
      .object({ configuration: draftShape(EnterpriseConfigSchema), sourcePeriod: zPeriod })
      .strict(),
  })
  .strict();

/** 模板输出器保留完整四表能力，公共入口只交付用户当前选中的报表。 */
async function enterpriseSelectedWorkbook(result: EnterpriseResult, key: string) {
  const descriptor = enterpriseRegistration.descriptors.find((d) => d.key === key);
  if (!descriptor) statutoryProblem('所选企业报表项目不存在');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Uint8Array.from(Buffer.from(await enterpriseWorkbookBase64(result), 'base64')).buffer,
  );
  for (const sheet of [...workbook.worksheets])
    if (!sheet.getCell('A1').text.startsWith(`${descriptor.name} · `))
      workbook.removeWorksheet(sheet.id);
  if (!workbook.worksheets.length) statutoryProblem('成功结果中没有所选企业报表');
  return Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
}

/** 换期只重读目标期来源，返回未经裁剪的完整编辑草稿。 */
async function enterpriseEditor(
  svc: CoreServices,
  period: number,
  scope: EnterpriseConfig['scope'],
  raw: Configuration | undefined,
  _reportKey: string,
  options?: unknown,
) {
  const previous = raw ? parseEnterpriseConfiguration(raw) : undefined;
  const draft = options === undefined ? undefined : enterpriseDraftOptions.safeParse(options);
  if (draft && !draft.success)
    statutoryProblem('未保存的企业报表草稿格式不正确，请返回配置页核实字段后重试');
  const base: EnterpriseConfig = previous
    ? { ...previous, period, scope }
    : createEnterpriseDraft(
        period,
        scope,
        {
          entityClass: 'unlisted',
          financial: '',
          revenue: '',
          lease: '',
          cas30_2026: null,
          source: '',
          version: '1',
        },
        await svc.accounts.list(),
      );
  // 读取来源只需要真实账套及目标期间；不能用严格配置解析抹掉正在输入的草稿。
  const source = await readEnterpriseSources(svc, { ...base, period, scope });
  const live = draft?.success ? draft.data.enterpriseDraft : undefined;
  const configuration = {
    ...base,
    ...(live?.configuration as Partial<EnterpriseConfig> | undefined),
    period,
    scope,
  };
  // 编辑器只接收完整草稿；目标期投影不得经组件回传覆盖未来配置。
  return { configuration, source };
}

/** 只用于目标期计算。完整配置仍用于编辑及持久化；失效引用不得冒充未来分录。 */
async function enterpriseProjection(svc: CoreServices, configuration: EnterpriseConfig) {
  const period = configuration.period;
  const periods = await svc.periods.list();
  const sourcePeriod = Math.max(period, ...periods.map((item) => item.period));
  const future = new Set<number>();
  if (
    period < sourcePeriod &&
    [
      configuration.cashAllocations,
      configuration.equityEvents,
      configuration.oci,
      configuration.discontinued,
    ].some((items) => items.length)
  ) {
    const entries = await svc.ledger.entries({
      periodFrom: Math.min(
        ...periods.filter((item) => item.period > period).map((item) => item.period),
      ),
      periodTo: sourcePeriod,
      includeUnposted: false,
      limit: 200000,
    });
    if (entries.length >= 200000)
      statutoryProblem('分录达到读取上限，无法核实历史报告日分类；请先核实来源范围');
    for (const entry of entries)
      if (entry.status === 'posted' && entry.period > period) future.add(entry.lineId);
  }
  const later = (value: unknown) => zPeriod.safeParse(value).success && Number(value) > period;
  const byDate = <T extends { period: number }>(items: T[]) =>
    items.filter((item) => !later(item.period));
  const byLine = <T extends { lineId: number }>(items: T[]) =>
    items.filter((item) => !future.has(item.lineId));
  return {
    ...configuration,
    facts: byDate(configuration.facts),
    absentRoles: byDate(configuration.absentRoles),
    cashPolicies: byDate(configuration.cashPolicies),
    contractNetAllocations: byDate(configuration.contractNetAllocations),
    cashScopeChanges: byDate(configuration.cashScopeChanges),
    adjustments: byDate(configuration.adjustments),
    cashAllocations: byLine(configuration.cashAllocations),
    equityEvents: byLine(configuration.equityEvents),
    oci: byLine(configuration.oci),
    discontinued: byLine(configuration.discontinued),
    eps: configuration.eps.filter((item) => !later(item.to)),
    shares: configuration.shares.filter(
      (item) =>
        !zDate.safeParse(item.from).success ||
        Number(item.from.slice(0, 7).replace('-', '')) <= period,
    ),
  };
}
/** 每个制度只注册真实可运行实现；新增制度同时提供相同的事务和输出能力。 */
export type StatutoryAdapter = {
  definitionId: string;
  definitionRevision: number;
  name: string;
  regime: string;
  products: readonly ProductId[];
  applicable?(book: BookInfo): boolean;
  descriptors: readonly { key: string; code: string; name: string; annualOnly: boolean }[];
  editor(
    svc: CoreServices,
    period: number,
    scope: 'month' | 'yearToDate' | 'annual',
    configuration: Configuration | undefined,
    reportKey: string,
    options?: unknown,
  ): Promise<{ configuration: Configuration; source: unknown }>;
  prepare(
    svc: CoreServices,
    configuration: Configuration,
    reportKey: string,
  ): Promise<{ configuration: Configuration; sourceDigest: string }>;
  verify(
    svc: CoreServices,
    profile: StatutoryProfile,
    period: number,
    result?: unknown,
  ): Promise<unknown>;
  generate(
    svc: CoreServices,
    profile: StatutoryProfile,
    period: number,
    confirmUnposted: boolean,
  ): Promise<
    | { kind: 'confirmation'; count: number; from: number; to: number }
    | { kind: 'generated'; result: unknown; unpostedCount: number }
  >;
  workbook(result: unknown, key: string): Promise<string>;
  print(result: unknown, key: string): StatutoryPrintJob;
};
const enterprise: StatutoryAdapter = {
  definitionId: enterpriseRegistration.format,
  definitionRevision: 1,
  name: '企业会计准则（2019年一般企业报表）',
  ...enterpriseRegistration,
  editor: enterpriseEditor,
  async prepare(svc, configuration) {
    const complete = parseEnterpriseConfiguration(configuration);
    const prepared = await prepareEnterprise(svc, await enterpriseProjection(svc, complete));
    return { ...prepared, configuration: complete };
  },
  verify: async (svc, p, period) =>
    verifyEnterprise(
      svc,
      await enterpriseProjection(svc, parseEnterpriseConfiguration(p.configuration)),
      p.sourceDigest,
      period,
    ),
  generate: async (svc, p, period, confirmUnposted) =>
    generateEnterprise(svc, {
      configuration: await enterpriseProjection(svc, parseEnterpriseConfiguration(p.configuration)),
      sourceDigest: p.sourceDigest,
      period,
      confirmUnposted,
    }),
  workbook: (result, key) => enterpriseSelectedWorkbook(result as EnterpriseResult, key),
  print: (result, key) =>
    statutoryPrintJob(
      '企业财务报表',
      enterprisePrintHtml(
        result as EnterpriseResult,
        key as 'balance' | 'profit' | 'cashflow' | 'equity',
      ),
    ),
};
export const statutoryRegistry: readonly StatutoryAdapter[] = [
  enterprise,
  smallBusinessAdapter,
  nonprofitAdapter,
];
export function statutoryProblem(message: string): never {
  throw new BusinessError({
    code: 'REPORT_STATUTORY',
    message,
    hint: '请回报表管理核实制度、期间和分类资料后重试；上次成功结果保留。',
    actions: [{ label: '报表管理', to: '/m/report-engine' }],
  });
}
export async function requireStatutory(
  svc: CoreServices,
  identity: { definitionId: string; definitionRevision: number; reportKey: string },
) {
  const adapter = statutoryRegistry.find((a) => a.definitionId === identity.definitionId);
  if (!adapter || adapter.definitionRevision !== identity.definitionRevision)
    statutoryProblem('所选法定报表定义不存在或版本已变化，请重新选择');
  const book = await svc.book.info();
  if (
    adapter.regime !== book.regime ||
    !adapter.products.includes(book.product) ||
    (adapter.applicable && !adapter.applicable(book))
  )
    statutoryProblem('所选法定报表不适用于当前账套制度或产品');
  const descriptor = adapter.descriptors.find((d) => d.key === identity.reportKey);
  if (!descriptor) statutoryProblem('所选报表项目不存在');
  return { adapter, descriptor, book };
}
