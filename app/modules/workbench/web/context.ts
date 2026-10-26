import { useQuery } from '@tanstack/react-query';
import { coreApi, useBootstrap, useRequiredSession } from '@caiwu/web-kit';
import { menuEntries } from '../shared';

export function useWorkbenchContext() {
  const session = useRequiredSession();
  const boot = useBootstrap();
  const manifests = useQuery(coreApi.modules.list.queryOptions());
  const entries = menuEntries(
    manifests.data ?? [],
    session.user,
    session.book.product,
    boot?.devMode ?? false,
  );
  const scope = `${session.bookId}:${session.user.id}:${session.book.product}:${session.user.permissions.join(',')}`;
  return { session, boot, manifests, entries, scope };
}
