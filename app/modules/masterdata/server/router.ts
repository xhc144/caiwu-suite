import { z } from 'zod';
import { zId, zPeriod } from '@caiwu/core';
import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import {
  AccountInputSchema,
  BatchSchema,
  DimensionInputSchema,
  DimensionTypeSchema,
  ExcelInputSchema,
  ReferenceInputSchema,
  ReferenceKindSchema,
  SchemeSchema,
  SearchSchema,
} from '../shared';
import { masterdataService } from './service';
import { referenceService } from './reference';
import { excelService } from './excel';

const m = moduleKit(manifest);
const view = m.procedure.meta({ permission: 'masterdata.view' });
const account = m.procedure.meta({ permission: 'masterdata.accounts.edit' });
const dimension = m.procedure.meta({ permission: 'masterdata.dimensions.edit' });
const reference = m.procedure.meta({ permission: 'masterdata.reference.edit' });
const removeSchema = z.object({ id: zId, confirmed: z.boolean() });
export const masterdataRouter = m.router({
  info: view.query(async ({ ctx }) => ({
    book: await ctx.svc.book.info(),
    categories: await ctx.svc.accounts.categories(),
    currencies: await ctx.svc.reference.currencies(),
  })),
  accounts: m.router({
    list: view
      .input(SearchSchema)
      .query(({ ctx, input }) => masterdataService(ctx.svc).accounts(input.keyword, input.locate)),
    preview: account
      .input(AccountInputSchema)
      .query(({ ctx, input }) => masterdataService(ctx.svc).prepareAccount(input)),
    save: account
      .input(AccountInputSchema)
      .mutation(({ ctx, input }) => masterdataService(ctx.svc).saveAccount(input)),
    deleteImpact: account
      .input(z.object({ id: zId }))
      .query(({ ctx, input }) => masterdataService(ctx.svc).accountDeleteImpact(input.id)),
    remove: account
      .input(removeSchema)
      .mutation(({ ctx, input }) =>
        masterdataService(ctx.svc).removeAccount(input.id, input.confirmed),
      ),
    rebuild: account.mutation(({ ctx }) =>
      ctx.svc.tx((tsvc) => masterdataService(tsvc).rebuildAccounts()),
    ),
    batchPreview: account
      .input(BatchSchema)
      .mutation(({ ctx, input }) =>
        masterdataService(ctx.svc).batchPreview(input.parentId, input.start, input.names),
      ),
    batch: account
      .input(BatchSchema)
      .mutation(({ ctx, input }) =>
        masterdataService(ctx.svc).batch(
          input.parentId,
          input.start,
          input.names,
          input.confirmations,
        ),
      ),
    moneyRoots: view.query(({ ctx }) => masterdataService(ctx.svc).moneyRoots()),
    confirmMoneyRoot: account
      .input(
        z.object({
          accountId: zId,
          kind: z.enum(['cash', 'bank', 'other']),
          confirmed: z.boolean(),
        }),
      )
      .mutation(({ ctx, input }) =>
        masterdataService(ctx.svc).setMoneyRoot(input.accountId, input.kind, input.confirmed),
      ),
  }),
  dimensions: m.router({
    list: view
      .input(
        z.object({
          type: DimensionTypeSchema,
          keyword: z.string().default(''),
          locate: z.boolean().default(false),
        }),
      )
      .query(({ ctx, input }) =>
        masterdataService(ctx.svc).dimensions(input.type, input.keyword, input.locate),
      ),
    scheme: view
      .input(z.object({ type: DimensionTypeSchema }))
      .query(({ ctx, input }) => masterdataService(ctx.svc).dimensionScheme(input.type)),
    setScheme: dimension
      .input(z.object({ type: DimensionTypeSchema, scheme: SchemeSchema }))
      .mutation(({ ctx, input }) =>
        masterdataService(ctx.svc).setDimensionScheme(input.type, input.scheme),
      ),
    save: dimension
      .input(DimensionInputSchema)
      .mutation(({ ctx, input }) => masterdataService(ctx.svc).saveDimension(input)),
    remove: dimension
      .input(removeSchema)
      .mutation(({ ctx, input }) =>
        masterdataService(ctx.svc).removeDimension(input.id, input.confirmed),
      ),
  }),
  reference: m.router({
    list: view
      .input(z.object({ kind: ReferenceKindSchema }))
      .query(({ ctx, input }) => referenceService(ctx.svc).list(input.kind)),
    save: reference
      .input(ReferenceInputSchema)
      .mutation(({ ctx, input }) => referenceService(ctx.svc).save(input)),
    remove: reference
      .input(
        z.object({ kind: ReferenceKindSchema, id: zId, code: z.string(), confirmed: z.boolean() }),
      )
      .mutation(({ ctx, input }) =>
        referenceService(ctx.svc).remove(input.kind, input.id, input.code, input.confirmed),
      ),
    rates: view
      .input(z.object({ currency: z.string() }))
      .query(({ ctx, input }) => referenceService(ctx.svc).rates(input.currency)),
    applicableRate: view
      .input(z.object({ currency: z.string(), period: zPeriod }))
      .query(({ ctx, input }) => ctx.svc.reference.exchangeRate(input.currency, input.period)),
    saveRate: reference
      .input(
        z.object({
          currency: z.string(),
          period: z.number().int(),
          rate: z.string().max(60),
          accountId: zId.nullable(),
        }),
      )
      .mutation(({ ctx, input }) =>
        referenceService(ctx.svc).saveRate(
          input.currency,
          input.period,
          input.rate,
          input.accountId,
        ),
      ),
  }),
  excel: m.router({
    export: view
      .input(
        z.object({
          kind: z.enum(['accounts', 'dimensions', 'reference']),
          type: DimensionTypeSchema.optional(),
          referenceKind: ReferenceKindSchema.optional(),
        }),
      )
      .query(({ ctx, input }) =>
        excelService(ctx.svc).export(input.kind, input.type, input.referenceKind),
      ),
    preview: m.procedure
      .meta({ permission: 'masterdata.import' })
      .input(ExcelInputSchema)
      .mutation(({ ctx, input }) => {
        ctx.svc.permissions.require(
          input.kind === 'accounts'
            ? 'masterdata.accounts.edit'
            : input.kind === 'dimensions'
              ? 'masterdata.dimensions.edit'
              : 'masterdata.reference.edit',
        );
        return excelService(ctx.svc).process(input, false);
      }),
    commit: m.procedure
      .meta({ permission: 'masterdata.import' })
      .input(ExcelInputSchema)
      .mutation(({ ctx, input }) => {
        ctx.svc.permissions.require(
          input.kind === 'accounts'
            ? 'masterdata.accounts.edit'
            : input.kind === 'dimensions'
              ? 'masterdata.dimensions.edit'
              : 'masterdata.reference.edit',
        );
        return excelService(ctx.svc).process(input, true);
      }),
  }),
});
export type MasterdataRouter = typeof masterdataRouter;
