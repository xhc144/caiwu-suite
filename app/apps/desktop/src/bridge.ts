/** 仅新增命名空间，不重声明共享包拥有的 window.caiwuDesktop。 */
export interface DesktopHost {
  dataDirectory: {
    get(): Promise<{ path: string; overridden: boolean }>;
    choose(): Promise<string | null>;
  };
  files: {
    open(): Promise<string | null>;
    save(defaultName: string): Promise<string | null>;
    directory(): Promise<string | null>;
  };
}

declare global {
  interface Window {
    caiwuDesktopHost?: DesktopHost;
  }
}
