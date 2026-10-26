import { z } from 'zod';
import { moduleKit } from '@caiwu/server-kit';
import manifest from '../manifest';
import { CopySchema, DeleteSchema, NamesSchema, TargetSchema } from '../shared';
import { booksService } from './service';

const m = moduleKit(manifest);
export const booksRouter = m.router({
  info: m.procedure.meta({ permission: 'books.view' }).query(({ ctx }) => ctx.svc.book.info()),
  diagnostics: m.procedure
    .meta({ permission: 'books.view' })
    .query(({ ctx }) => booksService(ctx.app, ctx.svc, ctx.session).diagnostics()),
  update: m.procedure
    .meta({ permission: 'books.edit' })
    .input(NamesSchema)
    .mutation(({ ctx, input }) => booksService(ctx.app, ctx.svc, ctx.session).update(input)),
  copy: m.procedure
    .meta({ permission: 'books.copy' })
    .input(CopySchema)
    .mutation(({ ctx, input }) => booksService(ctx.app, ctx.svc, ctx.session).copy(input)),
  prepareDelete: m.procedure
    .meta({ permission: 'books.delete' })
    .input(TargetSchema)
    .mutation(({ ctx, input }) => booksService(ctx.app, ctx.svc, ctx.session).prepareDelete(input)),
  cancelDelete: m.procedure
    .meta({ permission: 'books.delete' })
    .input(z.object({ ticket: z.uuid() }))
    .mutation(({ ctx, input }) =>
      booksService(ctx.app, ctx.svc, ctx.session).cancelDelete(input.ticket),
    ),
  remove: m.procedure
    .meta({ permission: 'books.delete' })
    .input(DeleteSchema)
    .mutation(({ ctx, input }) => booksService(ctx.app, ctx.svc, ctx.session).remove(input)),
});
export type BooksRouter = typeof booksRouter;
