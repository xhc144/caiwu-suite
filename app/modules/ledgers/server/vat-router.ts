import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import { VatMappingChangeSchema } from '../vat-shared';
import { vatService } from './vat';

const m = moduleKit(manifest);
export const vatRouter = m.router({
  mapping: m.procedure
    .meta({ permission: 'ledgers.view' })
    .query(({ ctx }) => vatService(ctx.svc).mapping()),
  saveMapping: m.procedure
    .meta({ permission: 'ledgers.config.edit' })
    .input(VatMappingChangeSchema)
    .mutation(({ ctx, input }) => vatService(ctx.svc).saveMapping(input)),
});
