import type { AppRuntime, AuthedContext } from '@caiwu/server-kit';
import type { ResetProtection } from './reset';

/** 宿主使用可信登录上下文调用既有备份服务，不接受前端传入账套或操作员身份。 */
export type RuntimeResetProtection = (
  input: Parameters<ResetProtection>[0],
  context: AuthedContext & { app: AppRuntime },
) => ReturnType<ResetProtection>;

// 出纳不复制备份实现，也不访问其他模块的数据表。
const protections = new WeakMap<AppRuntime, RuntimeResetProtection>();
export function registerCashierResetProtection(
  app: AppRuntime,
  protect: RuntimeResetProtection,
): void {
  protections.set(app, protect);
}
export function resetProtectionFor(
  context: AuthedContext & { app: AppRuntime },
): ResetProtection | undefined {
  const protect = protections.get(context.app);
  return protect ? (input) => protect(input, context) : undefined;
}
