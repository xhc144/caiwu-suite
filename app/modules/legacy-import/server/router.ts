import { z } from 'zod';
import { moduleKit } from '@caiwu/server-kit';
import ExcelJS from 'exceljs';
import manifest from '../manifest';
import { FilesSchema, PrepareSchema, TABLES, TABLE_NAMES } from '../shared';
import { syntheticTables } from '../sample';
import { importService } from './service';

const m = moduleKit(manifest);
export const importRouter = m.router({
  template: m.procedure.meta({ permission: 'legacy-import.prepare' }).query(async () => {
    const workbook = new ExcelJS.Workbook();
    const tables = syntheticTables();
    for (const k of TABLES) workbook.addWorksheet(TABLE_NAMES[k]).addRows(tables[k]);
    return { base64: Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64') };
  }),
  list: m.procedure
    .meta({ permission: 'legacy-import.view' })
    .query(({ ctx }) => importService(ctx.svc).list()),
  get: m.procedure
    .meta({ permission: 'legacy-import.view' })
    .input(z.strictObject({ id: z.uuid() }))
    .query(({ ctx, input }) => importService(ctx.svc).get(input.id)),
  inspect: m.procedure
    .meta({ permission: 'legacy-import.prepare' })
    .input(FilesSchema)
    .mutation(({ ctx, input }) => importService(ctx.svc).inspect(input.files)),
  prepare: m.procedure
    .meta({ permission: 'legacy-import.prepare' })
    .input(PrepareSchema)
    .mutation(({ ctx, input }) => importService(ctx.svc).prepare(input)),
  execute: m.procedure
    .meta({ permission: 'legacy-import.execute' })
    .input(z.strictObject({ id: z.uuid(), confirmation: z.string().max(120) }))
    .mutation(({ ctx, input }) => importService(ctx.svc).execute(input)),
});
export type ImportRouter = typeof importRouter;
