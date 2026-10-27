import type { UpdateStatus } from './updates';

/** 仅新增命名空间，不重声明共享包拥有的 window.caiwuDesktop。 */
export interface DesktopHost {
  updates: {
    status(): Promise<UpdateStatus>;
    check(): Promise<UpdateStatus>;
    download(): Promise<UpdateStatus>;
    /** 仅表示已请求关闭；未保存提示、服务关闭、备份仍可阻断安装。 */
    install(): Promise<boolean>;
  };
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
