import { z } from 'zod';
import { zId } from '@caiwu/core';
import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import { MemoInputSchema, MemoListFilterSchema } from '../shared';
import { memoService } from './service';

const m = moduleKit(manifest);

// 读接口按需声明 permission；写接口（mutation）必须声明，否则启动时报错。
export const exampleRouter = m.router({
  memos: m.router({
    list: m.procedure
      .meta({ permission: 'example.memo.view' })
      .input(MemoListFilterSchema)
      .query(({ ctx, input }) => memoService(ctx.svc).list(input)),
    create: m.procedure
      .meta({ permission: 'example.memo.edit' })
      .input(MemoInputSchema)
      .mutation(({ ctx, input }) => memoService(ctx.svc).create(input)),
    update: m.procedure
      .meta({ permission: 'example.memo.edit' })
      .input(z.object({ id: zId, data: MemoInputSchema }))
      .mutation(({ ctx, input }) => memoService(ctx.svc).update(input.id, input.data)),
    remove: m.procedure
      .meta({ permission: 'example.memo.edit' })
      .input(z.object({ id: zId }))
      .mutation(({ ctx, input }) => memoService(ctx.svc).remove(input.id)),
    generateVoucher: m.procedure
      .meta({ permission: 'example.memo.voucher' })
      .input(z.object({ id: zId }))
      .mutation(({ ctx, input }) => memoService(ctx.svc).generateVoucher(input.id)),
    deleteVoucher: m.procedure
      .meta({ permission: 'example.memo.voucher' })
      .input(z.object({ id: zId }))
      .mutation(({ ctx, input }) => memoService(ctx.svc).deleteVoucher(input.id)),
  }),
});

export type ExampleRouter = typeof exampleRouter;
