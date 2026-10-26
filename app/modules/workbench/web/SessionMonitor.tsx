import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export default function SessionMonitor() {
  useQuery({
    ...api.session.queryOptions(undefined, { trpc: { abortOnUnmount: true } }),
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    staleTime: 0,
    meta: { silent: true },
  });
  return null;
}
