import { z } from 'zod';
import { zId } from '@caiwu/core';
import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import { EntrySchema, SaveSchema, TemplateSchema, pasteFields } from '../shared';
import { entryService } from './service';
const m = moduleKit(manifest);
const view = m.procedure.meta({ permission: 'voucher-entry.view' });
export const entryRouter = m.router({
  bootstrap: view.query(({ ctx }) => entryService(ctx.svc).bootstrap()),
  get: view
    .input(z.object({ id: zId }))
    .query(({ ctx, input }) => entryService(ctx.svc).get(input.id)),
  reviewCheck: view
    .input(z.object({ id: zId }))
    .query(({ ctx, input }) => entryService(ctx.svc).reviewCheck(input.id)),
  neighbors: view
    .input(z.object({ id: zId }))
    .query(({ ctx, input }) => entryService(ctx.svc).neighbors(input.id)),
  context: view
    .input(z.object({ accountId: zId, date: EntrySchema.shape.date }))
    .query(({ ctx, input }) => entryService(ctx.svc).context(input.accountId, input.date)),
  numberHint: view
    .input(z.object({ date: EntrySchema.shape.date, type: zId }))
    .query(({ ctx, input }) => entryService(ctx.svc).numberHint(input.date, input.type)),
  buffer: view
    .input(z.object({ key: z.string() }))
    .query(({ ctx, input }) => entryService(ctx.svc).buffer(input.key)),
  save: m.procedure
    .meta({ permission: 'voucher-entry.edit' })
    .input(SaveSchema)
    .mutation(({ ctx, input }) => entryService(ctx.svc).save(input)),
  templates: view
    .input(z.object({ keyword: z.string().default('') }))
    .query(({ ctx, input }) => entryService(ctx.svc).templates(input.keyword)),
  template: view
    .input(z.object({ id: zId }))
    .query(({ ctx, input }) => entryService(ctx.svc).template(input.id)),
  saveTemplate: m.procedure
    .meta({ permission: 'voucher-entry.template' })
    .input(TemplateSchema)
    .mutation(({ ctx, input }) => entryService(ctx.svc).saveTemplate(input)),
  removeTemplate: m.procedure
    .meta({ permission: 'voucher-entry.template' })
    .input(z.object({ id: zId, revision: z.number().int().positive() }))
    .mutation(({ ctx, input }) => entryService(ctx.svc).removeTemplate(input.id, input.revision)),
  paste: m.procedure
    .meta({ permission: 'voucher-entry.view' })
    .input(
      z.object({
        text: z.string().max(500000),
        mapping: z.array(z.union([z.enum(pasteFields), z.literal('')])).max(50),
      }),
    )
    .mutation(({ ctx, input }) => entryService(ctx.svc).paste(input.text, input.mapping)),
});
export type EntryRouter = typeof entryRouter;
