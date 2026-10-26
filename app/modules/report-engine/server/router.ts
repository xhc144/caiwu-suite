import { z } from 'zod';
import { zId, zPeriod } from '@caiwu/core';
import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import { GenerateSchema, HeaderSchema, IdentitySchema, ReportTemplateSchema } from '../shared';
import { reportService } from './service';
import { parseFormula } from './formula';
import { workbookBase64 } from './export';

const m = moduleKit(manifest);
const selection = z
  .object({ id: zId, period: zPeriod, includeUnposted: z.boolean().default(false) })
  .strict();
export const reportRouter = m.router({
  list: m.procedure
    .meta({ permission: 'report-engine.view' })
    .input(
      z
        .object({ keyword: z.string().max(80).default('') })
        .strict()
        .default({ keyword: '' }),
    )
    .query(({ ctx, input }) => reportService(ctx.svc).list(input.keyword)),
  get: m.procedure
    .meta({ permission: 'report-engine.view' })
    .input(z.object({ id: zId }).strict())
    .query(({ ctx, input }) => reportService(ctx.svc).get(input.id)),
  create: m.procedure
    .meta({ permission: 'report-engine.edit' })
    .input(HeaderSchema)
    .mutation(({ ctx, input }) => reportService(ctx.svc).create(input)),
  copy: m.procedure
    .meta({ permission: 'report-engine.edit' })
    .input(
      z.object({ sourceId: zId, ...HeaderSchema.pick({ code: true, name: true }).shape }).strict(),
    )
    .mutation(({ ctx, input }) =>
      reportService(ctx.svc).copy(input.sourceId, { code: input.code, name: input.name }),
    ),
  save: m.procedure
    .meta({ permission: 'report-engine.edit' })
    .input(IdentitySchema.extend({ template: ReportTemplateSchema }).strict())
    .mutation(({ ctx, input }) =>
      reportService(ctx.svc).save(input.id, input.expectedRevision, input.template),
    ),
  remove: m.procedure
    .meta({ permission: 'report-engine.edit' })
    .input(IdentitySchema.extend({ confirmed: z.boolean() }).strict())
    .mutation(({ ctx, input }) =>
      reportService(ctx.svc).remove(input.id, input.expectedRevision, input.confirmed),
    ),
  importTemplate: m.procedure
    .meta({ permission: 'report-engine.edit' })
    .input(ReportTemplateSchema)
    .mutation(({ ctx, input }) => reportService(ctx.svc).importTemplate(input)),
  exportTemplate: m.procedure
    .meta({ permission: 'report-engine.export' })
    .input(z.object({ id: zId }).strict())
    .query(async ({ ctx, input }) => (await reportService(ctx.svc).get(input.id)).template),
  validateFormula: m.procedure
    .meta({ permission: 'report-engine.view' })
    .input(z.object({ source: z.string().max(2000) }).strict())
    .query(({ input }) => {
      try {
        parseFormula(input.source);
        return { valid: true, message: '语法校验通过；实际引用与单位将在生成时校验' };
      } catch (e) {
        return { valid: false, message: e instanceof Error ? e.message : '公式不正确' };
      }
    }),
  generate: m.procedure
    .meta({ permission: 'report-engine.generate' })
    .input(GenerateSchema)
    .mutation(({ ctx, input }) => reportService(ctx.svc).generate(input)),
  snapshot: m.procedure
    .meta({ permission: 'report-engine.view' })
    .input(selection)
    .query(({ ctx, input }) =>
      reportService(ctx.svc).snapshot(input.id, input.period, input.includeUnposted),
    ),
  exportResult: m.procedure
    .meta({ permission: 'report-engine.export' })
    .input(selection)
    .query(async ({ ctx, input }) => {
      const snapshot = await reportService(ctx.svc).snapshot(
        input.id,
        input.period,
        input.includeUnposted,
      );
      return snapshot ? { snapshot, base64: await workbookBase64(snapshot) } : null;
    }),
});
export type ReportRouter = typeof reportRouter;
