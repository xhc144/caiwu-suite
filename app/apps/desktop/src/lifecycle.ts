import type { EventEmitter } from 'node:events';
import type { LogEvent } from './log';

export type ServiceChild = {
  events: EventEmitter;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  requestStop: () => void;
  forceStop: () => void;
};

/** 不依赖 Electron；计时器、流和退出监听的所有权集中在一次服务会话内。 */
export class ServiceSession {
  #child: ServiceChild | null = null;
  #alive = false;
  #stopping = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #detach: (() => void) | undefined;
  #cancelStart: (() => void) | undefined;
  #stopPromise: Promise<void> | undefined;

  constructor(
    private readonly log: (event: LogEvent, error?: unknown) => void,
    private readonly unexpectedExit: () => void,
  ) {}

  get running(): boolean {
    return this.#alive && !this.#stopping;
  }

  start(spawn: () => ServiceChild, token: string, timeout = 30_000): Promise<number> {
    if (this.#child) return Promise.reject(new Error('本地服务已经启动'));
    this.log('service-start');
    try {
      this.#child = spawn();
      this.#alive = true;
    } catch (error) {
      this.log('service-failed', error);
      return Promise.reject(new Error('无法启动本地服务，请检查安装文件是否完整后重试'));
    }
    const child = this.#child;
    return new Promise<number>((resolve, reject) => {
      let ready = false;
      let settled = false;
      let buffer = '';
      let stderrSeen = false;
      const settle = (error?: Error, port?: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(this.#timer);
        this.#timer = undefined;
        this.#cancelStart = undefined;
        if (error) reject(error);
        else resolve(port!);
      };
      const fail = (message: string) => {
        this.log('service-failed');
        settle(new Error(message));
        // 失败后仍由 stop 等待真实退出，再交给界面重试，防止端口/孤儿进程残留。
        void this.stop().catch(() => this.log('service-stop-failed'));
      };
      const stdout = (data: Buffer) => {
        if (settled) return;
        buffer += data.toString();
        if (buffer.length > 16_384) {
          fail('本地服务返回了无效的启动信息，请重试或重新安装');
          return;
        }
        let end: number;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end).trim();
          buffer = buffer.slice(end + 1);
          if (!line.startsWith('CAIWU_READY ')) continue;
          try {
            const value = JSON.parse(line.slice(12)) as { port: number; token: string };
            if (
              value.token !== token ||
              !Number.isInteger(value.port) ||
              value.port < 1 ||
              value.port > 65535
            ) {
              throw new Error();
            }
            ready = true;
            buffer = '';
            this.log('service-ready');
            settle(undefined, value.port);
          } catch {
            fail('本地服务返回了无效的启动信息，请重试或重新安装');
          }
        }
      };
      const stderr = () => {
        if (!stderrSeen) this.log('service-stderr');
        stderrSeen = true;
      };
      const exit = () => {
        if (!this.#alive) return;
        this.#alive = false;
        this.log('service-exit');
        this.#detach?.();
        if (!settled) settle(new Error('本地服务在准备完成前退出，请检查数据目录权限或重新安装'));
        else if (ready && !this.#stopping) this.unexpectedExit();
      };
      const error = () => {
        // 发送关闭消息自身也可能触发 error；停止期间不能重入 stop 的 Promise 初始化。
        if (this.#stopping) return;
        fail('本地服务进程启动失败，请检查安装文件和数据目录权限后重试');
      };
      this.#detach = () => {
        child.stdout?.off('data', stdout);
        child.stderr?.off('data', stderr);
        child.events.off('exit', exit);
        child.events.off('close', exit);
        child.events.off('error', error);
        clearTimeout(this.#timer);
        this.#timer = undefined;
      };
      this.#cancelStart = () => settle(new Error('已取消本地服务启动'));
      child.stdout?.on('data', stdout);
      child.stderr?.on('data', stderr);
      child.events.on('exit', exit);
      child.events.on('close', exit);
      child.events.on('error', error);
      this.#timer = setTimeout(
        () => fail('本地服务 30 秒内没有准备完成，请重试或检查数据目录'),
        timeout,
      );
    });
  }

  stop(graceMs = 5000, forceMs = 3000): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#stopping = true;
    this.#cancelStart?.();
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const child = this.#child;
    if (!child || !this.#alive) {
      this.#detach?.();
      return Promise.resolve();
    }
    this.log('service-stop');
    this.#stopPromise = new Promise<void>((resolve, reject) => {
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      let finished = false;
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(graceTimer);
        clearTimeout(forceTimer);
        child.events.off('exit', exited);
        child.events.off('close', exited);
        this.#detach?.();
        if (error) reject(error);
        else resolve();
      };
      const exited = () => finish();
      child.events.once('exit', exited);
      child.events.once('close', exited);
      const graceTimer = setTimeout(() => {
        this.log('service-force-stop');
        forceTimer = setTimeout(
          () => finish(new Error('本地服务尚未退出，请关闭占用进程后重试')),
          forceMs,
        );
        try {
          child.forceStop();
        } catch {
          finish(new Error('无法终止本地服务，请关闭占用进程后重试'));
        }
      }, graceMs);
      try {
        child.requestStop();
      } catch {
        // 仍等待退出或强制终止的计时器，不把发送失败当作退出完成。
      }
    });
    return this.#stopPromise;
  }
}

export function wakeWindow(
  win: {
    isMinimized: () => boolean;
    restore: () => void;
    show: () => void;
    focus: () => void;
  } | null,
): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Electron 的 will-prevent-unload 仅在页面确实阻止卸载时触发。 */
export function allowUnload(event: { preventDefault: () => void }, confirmDiscard: () => boolean) {
  const discard = confirmDiscard();
  if (discard) event.preventDefault();
  return discard;
}
