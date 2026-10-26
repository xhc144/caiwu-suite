import type { EventEmitter } from 'node:events';
import type { LogEvent } from './log';

export type ServiceChild = {
  events: EventEmitter;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  requestStop: () => void;
  forceStop: () => void;
};

export type StopOutcome = 'refused' | 'terminated' | 'timeout' | 'forced' | 'unexpected';

export class ServiceStopError extends Error {
  constructor(
    readonly outcome: StopOutcome,
    readonly exitCode: number | null = null,
    readonly signal: string | null = null,
  ) {
    const messages: Record<StopOutcome, string> = {
      refused: `本地服务退出失败（退出码 ${exitCode}），备份或关账可能未完成`,
      terminated: '本地服务被信号终止，无法确认备份和关账完成',
      timeout: '等待本地服务正常退出超时，任务可能仍在完成，尚未强制终止',
      forced: '本地服务已被强制终止，不能视为保存或关账成功',
      unexpected: '本地服务意外退出，未确认正常保存和关账',
    };
    super(messages[outcome]);
  }
}

type ServiceExit = {
  code: number | null;
  signal: string | null;
  requested: boolean;
  forced: boolean;
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
  #stopRequested = false;
  #forced = false;
  #exit: ServiceExit | undefined;

  constructor(
    private readonly log: (event: LogEvent, error?: unknown) => void,
    private readonly unexpectedExit: () => void,
  ) {}

  get running(): boolean {
    return this.#alive && !this.#stopping;
  }

  get alive(): boolean {
    return this.#alive;
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
      const exit = (code: number | null, signal?: string | null) => {
        if (!this.#alive) return;
        this.#alive = false;
        this.#exit = {
          code: typeof code === 'number' ? code : null,
          signal: signal ?? null,
          requested: this.#stopRequested,
          forced: this.#forced,
        };
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

  #checkExit(): void {
    const result = this.#exit;
    if (!result) return; // spawn 尚未发生或失败，没有子进程需要关闭。
    let failure: ServiceStopError | undefined;
    if (result.forced) failure = new ServiceStopError('forced', result.code, result.signal);
    else if (result.signal)
      failure = new ServiceStopError('terminated', result.code, result.signal);
    else if (!result.requested) failure = new ServiceStopError('unexpected', result.code);
    else if (result.code !== 0) failure = new ServiceStopError('refused', result.code);
    if (failure) {
      this.log(`service-stop-${failure.outcome}`);
      throw failure;
    }
  }

  /** 共享 lifecycle 默认 30 秒；宿主允许其返回真实结果。超时只停止等待，不杀任务。 */
  stop(timeout = 35_000): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#stopping = true;
    this.#cancelStart?.();
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const child = this.#child;
    if (!child || !this.#alive) {
      this.#detach?.();
      return Promise.resolve().then(() => this.#checkExit());
    }
    this.log('service-stop');
    this.#stopPromise = this.#waitForExit(child, timeout)
      .then(() => {
        this.#checkExit();
        this.log('service-stop-completed');
      })
      .finally(() => {
        this.#stopPromise = undefined;
      });
    if (!this.#stopRequested) {
      this.#stopRequested = true;
      try {
        child.requestStop();
      } catch {
        // 消息发送失败不能算退出；继续等待真实退出或报告超时。
      }
    }
    return this.#stopPromise;
  }

  /** 只供用户明确选择的异常退出/测试清理；后续 stop 仍拒绝，绝不转换成成功。 */
  terminate(timeout = 3000): Promise<void> {
    if (!this.#child || !this.#alive) return Promise.resolve();
    this.#stopping = true;
    this.#forced = true;
    this.#cancelStart?.();
    this.log('service-force-stop');
    const waiting = this.#waitForExit(this.#child, timeout);
    try {
      this.#child.forceStop();
    } catch {
      // 仍等待退出证据；未退出会超时，不能声称已经终止。
    }
    return waiting;
  }

  #waitForExit(child: ServiceChild, timeout: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        child.events.off('exit', finish);
        child.events.off('close', finish);
        resolve();
      };
      const timer = setTimeout(() => {
        child.events.off('exit', finish);
        child.events.off('close', finish);
        this.log('service-stop-timeout');
        reject(new ServiceStopError('timeout'));
      }, timeout);
      child.events.once('exit', finish);
      child.events.once('close', finish);
    });
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
