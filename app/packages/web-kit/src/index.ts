// @caiwu/web-kit：前端的接口客户端、登录状态、提示、标签页、快捷键、模块定义。
export { appToken, coreApi, moduleApi, queryClient, trpcClient } from './client';
export {
  sessionStore,
  useSession,
  useRequiredSession,
  usePermission,
  type SessionState,
} from './session';
export {
  NotifyBridge,
  getBusinessError,
  showError,
  showBusinessMessage,
  notify,
  modalApi,
} from './notify';
export { TabContext, useTab, usePageTitle, type TabContextValue } from './tabs';
export { useHotkey, matchHotkey, parseHotkey, type HotkeyOptions } from './hotkeys';
export { defineWebModule, type WebModule, type WebRoute, type EntryPages } from './web-module';
export {
  useAccounts,
  useDimensionItems,
  usePeriods,
  useCurrentPeriod,
  useVoucherTypes,
  useBootstrap,
} from './hooks';
export { moduleRoute } from '@caiwu/core';

export * from './unsaved';
export { SessionCommitBoundary } from './session-commit';

export * from './loading';

export { resetWebModuleRoutes } from './web-module';
