import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import { QuerySchema, SettingsSchema } from '../shared';
import { balancesService } from './service';

const m = moduleKit(manifest);
export const balancesRouter = m.router({
  metadata: m.procedure
    .meta({ permission: 'balances.view' })
    .query(({ ctx }) => balancesService(ctx.svc).metadata()),
  query: m.procedure
    .meta({ permission: 'balances.view' })
    .input(QuerySchema)
    .query(({ ctx, input }) => balancesService(ctx.svc).query(input)),
  export: m.procedure
    .meta({ permission: 'balances.export' })
    .input(QuerySchema)
    .query(({ ctx, input }) => {
      ctx.svc.permissions.require('balances.view');
      return balancesService(ctx.svc).query(input);
    }),
  saveSettings: m.procedure
    .meta({ permission: 'balances.settings.edit' })
    .input(SettingsSchema)
    .mutation(({ ctx, input }) => balancesService(ctx.svc).saveSettings(input)),
});
export type BalancesRouter = typeof balancesRouter;
