import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CoreServices } from '@caiwu/core/server';
import {
  ConfigurationSchema,
  RequestSchema,
  type StatementRequest,
} from '../templates/nonprofit/model';
import {
  nonprofitCatalogue,
  nonprofitConfigurationDraft,
  validateConfiguration,
  generateNonprofit,
  verifyNonprofitBinding,
  type NonprofitGeneration,
} from '../templates/nonprofit/statutory.server';
import { readNonprofitSources } from '../templates/nonprofit/sources.server';
import { statementSnapshot } from '../templates/nonprofit/layout';
import { nonprofitWorkbookBase64 } from '../templates/nonprofit/export.server';
import { nonprofitPrintHtml } from '../templates/nonprofit/print';
import type { StatutoryAdapter } from './statutory-registry';
import { statutoryProblem } from './statutory-registry';
import { statutoryPrintJob } from './statutory-print';

export const NonprofitPublicConfigurationSchema = z
  .object({
    period: z.number().int(),
    scope: z.enum(['month', 'yearToDate', 'annual']),
    request: RequestSchema.optional(),
    current: ConfigurationSchema,
    previous: ConfigurationSchema.optional(),
  })
  .strict();
export type NonprofitPublicConfiguration = z.infer<typeof NonprofitPublicConfigurationSchema>;
export function nonprofitRequest(
  period: number,
  scope: string,
  key: string,
  override?: unknown,
): StatementRequest {
  const request = RequestSchema.parse(
    override ?? {
      code: key,
      from: scope === 'month' ? period : Math.floor(period / 100) * 100 + 1,
      to: period,
      kind: scope === 'annual' ? 'annual' : scope === 'month' ? 'month' : 'interim',
      comparison: Math.floor(period / 100) >= 2027,
      includeUnposted: false,
    },
  );
  if (
    request.code !== key ||
    request.to !== period ||
    (scope === 'annual') !== (request.kind === 'annual')
  )
    statutoryProblem('报表项目、报告期间与比较口径不一致，请重新选择');
  return request;
}
async function sources(svc: CoreServices, c: NonprofitPublicConfiguration, key: string) {
  const request = nonprofitRequest(c.period, c.scope, key, c.request);
  const current = await readNonprofitSources(svc, request, c.current);
  const previous = c.previous
    ? await readNonprofitSources(
        svc,
        {
          ...request,
          from: request.from - 100,
          to: request.to - 100,
          comparison: false,
        },
        c.previous,
      )
    : undefined;
  return { request, current, previous };
}
async function binding(svc: CoreServices, c: NonprofitPublicConfiguration, key: string) {
  const data = await sources(svc, c, key);
  validateConfiguration(c.current, data.current);
  if (c.previous && data.previous) validateConfiguration(c.previous, data.previous);
  return {
    data,
    sourceDigest: createHash('sha256')
      .update(JSON.stringify({ configuration: c, ...data }))
      .digest('hex'),
  };
}
function layout(result: unknown) {
  const generated = result as NonprofitGeneration;
  return statementSnapshot(generated.statement, {
    reportId: 0,
    revision: 1,
    generatedAt: '',
    id: 0,
  });
}
export const nonprofitAdapter: StatutoryAdapter = {
  definitionId: nonprofitCatalogue.id,
  definitionRevision: nonprofitCatalogue.version,
  name: '民间非营利组织会计制度（2026）',
  regime: nonprofitCatalogue.regime,
  products: ['minfei', 'qingsong', 'chengben'],
  applicable: nonprofitCatalogue.applicable,
  descriptors: nonprofitCatalogue.reports.map((r) => ({
    code: r.code,
    key: r.code,
    name: r.name,
    annualOnly: r.code === '403',
  })),
  async editor(svc, period, scope, raw, key, options) {
    const value = raw as NonprofitPublicConfiguration | undefined;
    const request = nonprofitRequest(
      period,
      scope,
      key,
      options ??
        (value?.request?.to === period && value.scope === scope ? value.request : undefined),
    );
    const savedCurrent =
      value?.current?.year === Math.floor(period / 100) ? value.current : undefined;
    const current = await readNonprofitSources(svc, request, savedCurrent);
    const previousRequest = {
      ...request,
      from: request.from - 100,
      to: request.to - 100,
      comparison: false,
    };
    const savedPrevious =
      value?.previous?.year === Math.floor(previousRequest.to / 100) ? value.previous : undefined;
    const previous =
      period >= 202701 && key !== '401'
        ? await readNonprofitSources(svc, previousRequest, savedPrevious)
        : undefined;
    return {
      configuration: {
        period,
        scope,
        request,
        current:
          value?.current && value.current.year === Math.floor(period / 100)
            ? value.current
            : nonprofitConfigurationDraft(current),
        ...(previous ? { previous: savedPrevious ?? nonprofitConfigurationDraft(previous) } : {}),
      },
      source: { request, current, previous, previousRequest, periods: await svc.periods.list() },
    };
  },
  async prepare(svc, raw, key) {
    const configuration = NonprofitPublicConfigurationSchema.parse(raw);
    return { configuration, sourceDigest: (await binding(svc, configuration, key)).sourceDigest };
  },
  async verify(svc, p, period, result) {
    const c = NonprofitPublicConfigurationSchema.parse(p.configuration);
    if (c.period !== period) statutoryProblem('报告期间与已确认配置不同，请重新确认');
    if ((await binding(svc, c, p.reportKey)).sourceDigest !== p.sourceDigest)
      statutoryProblem('账务、科目或来源已变化，请核实后重新保存确认');
    if (result)
      await verifyNonprofitBinding(
        svc,
        nonprofitRequest(period, c.scope, p.reportKey, c.request),
        c.current,
        result as NonprofitGeneration,
        c.previous,
      );
  },
  async generate(svc, p, period, confirmUnposted) {
    const c = NonprofitPublicConfigurationSchema.parse(p.configuration);
    const from = Math.floor(period / 100) * 100 + 1;
    const pending = await svc.vouchers.list({
      periodFrom: c.previous ? from - 100 : from,
      periodTo: period,
      statuses: ['draft', 'pending', 'audited'],
      limit: 1,
    });
    if (pending.total && !confirmUnposted)
      return {
        kind: 'confirmation',
        count: pending.total,
        from: c.previous ? from - 100 : from,
        to: period,
      };
    const result = await generateNonprofit(
      svc,
      nonprofitRequest(period, c.scope, p.reportKey, c.request),
      c.current,
      c.previous,
    );
    return { kind: 'generated', result, unpostedCount: pending.total };
  },
  workbook: (result) => nonprofitWorkbookBase64(layout(result)),
  print: (result) =>
    statutoryPrintJob(
      (result as NonprofitGeneration).statement.name,
      nonprofitPrintHtml(layout(result)),
    ),
};
export type NonprofitPublicSource = Awaited<ReturnType<typeof sources>> & {
  periods: { period: number }[];
  previousRequest: StatementRequest;
};
