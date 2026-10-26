import type { AppRuntime } from '@caiwu/server-kit';
import { AutomaticBackupController, type Clock } from './controller';
import { automaticBinding, waitForJobs } from './service';
import { fail } from './files';

type Runtime = {
  controller: AutomaticBackupController;
  clock: Clock;
  signal: AbortSignal;
  cancel: AbortController;
  seen: Set<string>;
  timer?: unknown;
  discovering?: Promise<void>;
  stopping: boolean;
  discoveryFailure: string | null;
};
const runtimes = new WeakMap<AppRuntime, Runtime>();
const systemClock: Clock = {
  now: Date.now,
  set: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    timer.unref();
    return timer;
  },
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};
const message = (error: unknown) => (error instanceof Error ? error.message : '自动备份失败');

async function attach(app: AppRuntime, runtime: Runtime, id: string, onStart: boolean) {
  const status = runtime.controller.status(id);
  if (status.attached) {
    // 维护期间读取设置可能暂时失败；下一次扫描补回定时，不依赖页面重开。
    if (!status.nextAt && !status.running) await runtime.controller.reconfigure(id);
    return;
  }
  const first = !runtime.seen.has(id);
  runtime.seen.add(id);
  await runtime.controller.attach(
    id,
    {
      settings: () => automaticBinding(app, id, runtime.signal).settings(),
      backup: () => automaticBinding(app, id, runtime.signal).backup(),
    },
    onStart && first,
  );
}
async function discover(app: AppRuntime, runtime: Runtime, onStart: boolean) {
  if (runtime.discovering) return runtime.discovering;
  runtime.discovering = (async () => {
    try {
      for (const book of await app.bookStore.list()) {
        runtime.signal.throwIfAborted();
        if (runtime.stopping && onStart) break;
        await attach(app, runtime, book.id, onStart);
      }
      runtime.discoveryFailure = null;
    } catch (error) {
      runtime.discoveryFailure = message(error);
      runtime.signal.throwIfAborted();
    }
  })().finally(() => {
    runtime.discovering = undefined;
  });
  return runtime.discovering;
}
function scheduleDiscovery(app: AppRuntime, runtime: Runtime) {
  if (runtime.stopping || runtime.signal.aborted) return;
  runtime.timer = runtime.clock.set(() => {
    runtime.timer = undefined;
    void discover(app, runtime, true)
      .catch((error: unknown) => {
        runtime.discoveryFailure = message(error);
      })
      .finally(() => scheduleDiscovery(app, runtime));
  }, 60_000);
}
/** 新建/恢复账套最多一分钟内被发现；已有账套在接受请求前完成启动备份尝试。 */
export async function startAutomaticBackups(
  app: AppRuntime,
  signal: AbortSignal,
  clock = systemClock,
) {
  if (runtimes.has(app)) return;
  const cancel = new AbortController();
  const runtime: Runtime = {
    controller: new AutomaticBackupController(clock),
    clock,
    signal: AbortSignal.any([signal, cancel.signal]),
    cancel,
    seen: new Set(),
    stopping: false,
    discoveryFailure: null,
  };
  runtimes.set(app, runtime);
  await discover(app, runtime, true);
  scheduleDiscovery(app, runtime);
}
export function automaticStatus(app: AppRuntime, id: string) {
  const runtime = runtimes.get(app);
  const status = runtime?.controller.status(id);
  return {
    nextAt: status?.nextAt ?? null,
    automaticFailure: status?.lastFailure ?? runtime?.discoveryFailure ?? null,
    automaticRunning: status?.running ?? false,
    runtimeStatus: !runtime
      ? '自动备份运行时未启动'
      : runtime.stopping
        ? '自动备份正在停止'
        : status?.attached
          ? '启动 / 正常退出 / 定时自动备份已接入'
          : '自动备份运行时已启动；账套将在一分钟内接入',
  };
}
export async function reconfigureAutomaticBackups(app: AppRuntime, id: string) {
  const runtime = runtimes.get(app);
  if (!runtime || runtime.stopping) return;
  // 保存配置不触发一次额外的启动备份，但立即应用定时和停用设置。
  await attach(app, runtime, id, false);
  await runtime.controller.reconfigure(id);
}
export async function beforeAutomaticBookClose(app: AppRuntime, id: string) {
  await runtimes.get(app)?.controller.detach(id);
}
export async function stopAutomaticBackups(app: AppRuntime, signal: AbortSignal) {
  const runtime = runtimes.get(app);
  if (!runtime) return;
  runtime.stopping = true;
  const abort = () => runtime.cancel.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  try {
    if (runtime.timer != null) runtime.clock.clear(runtime.timer);
    await runtime.discovering;
    // 退出前也接入在最后一次扫描后新建的账套；不重复执行启动备份。
    await discover(app, runtime, false);
    await waitForJobs(app, undefined, signal);
    const failures = await runtime.controller.shutdown();
    signal.throwIfAborted();
    if (runtime.discoveryFailure || failures.length)
      throw fail(
        'AUTOMATIC_EXIT',
        '自动备份未完成，不能安全退出',
        [runtime.discoveryFailure, ...failures.map((f) => `${f.bookId}：${f.reason}`)]
          .filter(Boolean)
          .join('；'),
      );
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
