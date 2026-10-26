import { Spin } from 'antd';
import { Suspense, use, type ComponentType, type ReactNode } from 'react';
import type { EntryPages } from '@caiwu/web-kit';
import { entryPageProvider, loadWebModule } from '../modules';

/** 入口页面：有模块提供就用模块的，否则用壳自带的 fallback。 */
export function EntryPage({
  kind,
  devMode,
  fallback,
  props = {},
}: {
  kind: keyof EntryPages;
  devMode: boolean;
  fallback: ReactNode;
  props?: Record<string, unknown>;
}) {
  const provider = entryPageProvider(kind, devMode);
  if (!provider) return <>{fallback}</>;
  return (
    <Suspense fallback={<Spin style={{ margin: 48 }} />}>
      <ModuleEntry id={provider.id} kind={kind} fallback={fallback} props={props} />
    </Suspense>
  );
}

function ModuleEntry({
  id,
  kind,
  fallback,
  props,
}: {
  id: string;
  kind: keyof EntryPages;
  fallback: ReactNode;
  props: Record<string, unknown>;
}) {
  const mod = use(loadWebModule(id));
  const Comp = mod?.entryPages?.[kind] as ComponentType<Record<string, unknown>> | undefined;
  return Comp ? <Comp {...props} /> : <>{fallback}</>;
}
