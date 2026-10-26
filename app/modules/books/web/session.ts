import { coreApi, queryClient, sessionStore } from '@caiwu/web-kit';

export async function switchBook() {
  if (sessionStore.get())
    await queryClient
      .getMutationCache()
      .build(queryClient, coreApi.auth.logout.mutationOptions())
      .execute(undefined);
  await queryClient.cancelQueries();
  sessionStore.set(null);
  queryClient.clear();
  // 完整卸载壳和标签页，避免切回账套时保留旧页面内部状态。
  window.location.assign('/');
}
