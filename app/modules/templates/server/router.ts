import { publicProcedure, t } from '@caiwu/server-kit';
import { TemplateBookInputSchema, TemplateCreationCheckSchema } from '../shared';
import {
  assertTemplateCreation,
  checkTemplateCreation,
  templateCreationPolicies,
} from '../creation-policy';
import { legacyTemplateCatalog } from '../legacy-catalog';

export const templatesRouter = t.router({
  creationPolicies: publicProcedure.query(() => templateCreationPolicies),
  originalCatalog: publicProcedure.query(({ ctx }) => {
    const ids = new Set(ctx.app.templates.list().map((t) => t.id));
    return legacyTemplateCatalog.map((entry) => ({
      ...entry,
      registered: entry.templateIds.filter((id) => ids.has(id)),
    }));
  }),
  checkCreation: publicProcedure.input(TemplateCreationCheckSchema).query(({ ctx, input }) => {
    ctx.app.templates.get(input.templateId);
    return checkTemplateCreation(input);
  }),
  // 与core新建账套一样在登录前调用；仅委托现有事务，不另写账套表或科目。
  createBook: publicProcedure
    .meta({ noPermission: true })
    .input(TemplateBookInputSchema)
    .mutation(({ ctx, input }) => {
      ctx.app.templates.get(input.templateId);
      assertTemplateCreation(input);
      return ctx.app.bookStore.create(input);
    }),
});

export type TemplatesRouter = typeof templatesRouter;
