import { moduleApi, queryClient } from '@caiwu/web-kit';
import type { inferRouterInputs } from '@trpc/server';
import type { ReportRouter } from '../server/router';

export const api = moduleApi<ReportRouter>('report-engine');

/** 保留同一查询缓存和错误处理；完整编辑草稿使用现有鉴权客户端以 POST 读取。 */
export function statutoryEditorOptions(
  input: inferRouterInputs<ReportRouter>['statutory']['editor'],
) {
  const options = api.statutory.editor.queryOptions(input);
  if (input.options === undefined) return options;
  return {
    ...options,
    queryFn: () =>
      queryClient
        .getMutationCache()
        .build(queryClient, api.statutory.editorDraft.mutationOptions({ meta: { silent: true } }))
        .execute(input),
  };
}
