import { lazy } from 'react';
import type { ModuleManifest, ProductId } from '@caiwu/core';
import { moduleAvailableIn } from '@caiwu/core';
import type { EntryPages, WebModule } from '@caiwu/web-kit';
import { BookPickerWithTemplateCreation } from './template-creation';

// 自动发现模块：每个 modules/<id>/manifest.ts（立即加载，用于导航）和 modules/<id>/web/index.tsx（打开时才加载）。
// 新增模块不需要改这里。以 _ 开头的目录忽略。
const manifestFiles = import.meta.glob<ModuleManifest>('../../../modules/*/manifest.ts', {
  eager: true,
  import: 'default',
});
const webFiles = import.meta.glob<WebModule>('../../../modules/*/web/index.tsx', {
  import: 'default',
});

const dirOf = (file: string) =>
  file.split('/').at(-2) === 'web' ? file.split('/').at(-3)! : file.split('/').at(-2)!;

export const allManifests: ModuleManifest[] = Object.entries(manifestFiles)
  .filter(([file]) => !dirOf(file).startsWith('_'))
  .map(([file, m]) => {
    if (dirOf(file) !== m.id)
      console.error(`modules/${dirOf(file)} 的模块 id 是 ${m.id}，必须与目录名一致`);
    return m;
  })
  .sort((a, b) => a.id.localeCompare(b.id));

const webLoaders = new Map(Object.entries(webFiles).map(([file, load]) => [dirOf(file), load]));

export function visibleModules(product: ProductId | null, devMode: boolean): ModuleManifest[] {
  return allManifests.filter(
    (m) => (devMode || !m.devOnly) && (!product || moduleAvailableIn(m, product)),
  );
}

const cache = new Map<string, Promise<WebModule | null>>();

/** 按需加载模块的前端部分；模块没有前端时返回 null。 */
export function loadWebModule(id: string): Promise<WebModule | null> {
  let p = cache.get(id);
  if (!p) {
    const loader = webLoaders.get(id);
    p = loader
      ? loader()
          .then((module) =>
            id === 'books'
              ? {
                  ...module,
                  entryPages: { ...module.entryPages, bookPicker: BookPickerWithTemplateCreation },
                }
              : id === 'example'
                ? {
                    ...module,
                    routes: [
                      ...module.routes,
                      ...['a', 'b', ':slot'].map((path) => ({
                        path: `/shared/${path}`,
                        title: path === 'b' ? '乙编辑页' : '甲编辑页',
                        component: lazy(() => import('./testing/UnsavedFixture')),
                      })),
                    ],
                  }
                : module,
          )
          .catch((error: unknown) => {
            cache.delete(id);
            throw error;
          })
      : Promise.resolve(null);
    cache.set(id, p);
  }
  return p;
}

/** 提供某个入口页面的模块（按 id 排序取第一个），没有则返回 null（用壳自带的）。 */
export function entryPageProvider(kind: keyof EntryPages, devMode: boolean): ModuleManifest | null {
  return allManifests.find((m) => (devMode || !m.devOnly) && m.entryPages.includes(kind)) ?? null;
}
