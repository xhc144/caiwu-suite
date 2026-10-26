import { createContext, useContext, useEffect } from 'react';

/** 每个标签页里的页面都在这个上下文里。隐藏的标签页 active = false。 */
export interface TabContextValue {
  key: string;
  active: boolean;
  setTitle(title: string): void;
  close(): void;
}

export const TabContext = createContext<TabContextValue>({
  key: 'standalone',
  active: true,
  setTitle: () => {},
  close: () => {},
});

export function useTab(): TabContextValue {
  return useContext(TabContext);
}

/** 修改当前标签页的标题，例如打开凭证后显示 "凭证 记-0012"。 */
export function usePageTitle(title: string | null | undefined) {
  const tab = useTab();
  useEffect(() => {
    if (title) tab.setTitle(title);
  }, [title, tab]);
}
