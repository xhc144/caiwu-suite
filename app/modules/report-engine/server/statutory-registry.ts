import { BusinessError, type BookInfo, type ProductId } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import type { StatutoryPrintJob, StatutoryProfile } from '../shared';
import {
  enterpriseRegistration,
  prepareEnterprise,
  verifyEnterprise,
  generateEnterprise,
  readEnterpriseSources,
} from '../templates/enterprise/statutory.server';
import { parseEnterpriseConfiguration, type EnterpriseResult } from '../templates/enterprise/model';
import { createEnterpriseDraft } from '../templates/enterprise/mapping';
import { enterpriseWorkbookBase64 } from '../templates/enterprise/output.server';
import { enterprisePrintHtml } from '../templates/enterprise/output';
import { smallBusinessAdapter } from './statutory-small-business';
import { nonprofitAdapter } from './statutory-nonprofit';
import { statutoryPrintJob } from './statutory-print';

type Configuration = StatutoryProfile['configuration'];
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
  async editor(svc, period, scope, raw) {
    const configuration = raw
      ? { ...parseEnterpriseConfiguration(raw), period, scope }
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
    return { configuration, source: await readEnterpriseSources(svc, configuration) };
  },
  async prepare(svc, configuration) {
    return prepareEnterprise(svc, parseEnterpriseConfiguration(configuration));
  },
  verify: (svc, p, period) =>
    verifyEnterprise(svc, parseEnterpriseConfiguration(p.configuration), p.sourceDigest, period),
  generate: (svc, p, period, confirmUnposted) =>
    generateEnterprise(svc, {
      configuration: parseEnterpriseConfiguration(p.configuration),
      sourceDigest: p.sourceDigest,
      period,
      confirmUnposted,
    }),
  workbook: (result) => enterpriseWorkbookBase64(result as EnterpriseResult),
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
