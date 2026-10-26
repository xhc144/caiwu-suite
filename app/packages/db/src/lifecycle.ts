import { AsyncLocalStorage } from 'node:async_hooks';

export type GateError = (reason: 'busy' | 'timeout' | 'revoked') => Error;
type LeaseScope = { active: boolean; exclusive?: boolean; release?: () => void };
const requestScope = new AsyncLocalStorage<{
  active: boolean;
  leases: Map<ResourceGate, LeaseScope>;
}>();

/** 请求内额外打开的目标账套也保留至请求结束，覆盖跨账套备份/复制的 await。 */
export async function withRequestLeases<T>(fn: () => Promise<T>): Promise<T> {
  const parent = requestScope.getStore();
  if (parent?.active) return fn();
  if (parent) throw new Error('请求租约已结束，后台任务必须显式取得新租约');
  const scope = { active: true, leases: new Map<ResourceGate, LeaseScope>() };
  try {
    return await requestScope.run(scope, fn);
  } finally {
    scope.active = false;
    for (const lease of scope.leases.values()) {
      lease.active = false;
      lease.release?.();
    }
  }
}

/** 异步租约必须覆盖整个任务；脱离请求的后台任务须自行 run() 并等待完成。 */
export class ResourceGate {
  readonly #scope = new AsyncLocalStorage<LeaseScope>();
  readonly #idle = new Set<() => void>();
  #active = 0;
  #busy = false;
  #blocked = false;
  constructor(public error: GateError = (reason) => new Error(`资源暂不可用：${reason}`)) {}

  get busy(): boolean {
    return this.#busy || this.#blocked;
  }

  #current(): LeaseScope | undefined {
    return this.#scope.getStore() ?? requestScope.getStore()?.leases.get(this);
  }

  retainForRequest(): void {
    const request = requestScope.getStore();
    if (!request) return;
    if (this.#scope.getStore()?.active) {
      this.assertAvailable();
      return;
    }
    if (!request.active) throw this.error('revoked');
    this.assertAvailable();
    if (!this.#current()) request.leases.set(this, { active: true, release: this.enter() });
  }

  assertAvailable(): void {
    const scope = this.#current();
    if (scope && !scope.active) throw this.error('revoked');
    if (this.#blocked || (this.#busy && !scope?.active)) throw this.error('busy');
  }

  enter(): () => void {
    this.assertAvailable();
    if (this.#current()?.active) return () => {};
    return this.#acquire();
  }

  #acquire(): () => void {
    this.#active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.#active === 0) for (const resolve of this.#idle) resolve();
    };
  }

  /** 显式后台任务取得独立租约，不能把结束的请求/svc 直接带入后台继续用。 */
  async runFresh<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#blocked || (this.#busy && !this.#current()?.active)) throw this.error('busy');
    const release = this.#acquire();
    const scope = { active: true, release };
    try {
      return await this.#scope.run(scope, fn);
    } finally {
      scope.active = false;
      release();
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    this.assertAvailable();
    if (this.#current()?.active) return fn();
    const release = this.enter();
    const scope = { active: true, release };
    try {
      return await this.#scope.run(scope, fn);
    } finally {
      scope.active = false;
      release();
    }
  }

  /** 不确定连接是否已关闭时保持拒绝状态；不能以超时为由提前重开。 */
  block(): void {
    this.#blocked = true;
  }

  /**
   * 同步关门，再排空。当前请求升级后旧 svc 永久失效，回调外不得再用它。
   * 超时通知调用者并 abort；未结束的回调仍持有门，直到真实结束才释放。
   */
  exclusive<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs = 30_000): Promise<T> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      return Promise.reject(new Error('超时必须为正数'));
    if (this.busy) return Promise.reject(this.error('busy'));
    const parent = this.#current();
    if (parent && !parent.active) return Promise.reject(this.error('revoked'));
    if (parent?.exclusive) return Promise.reject(this.error('busy'));
    this.#busy = true;
    if (parent?.active) {
      parent.active = false;
      parent.release?.();
    }
    const controller = new AbortController();
    const timeout = this.error('timeout');
    let rejectTimeout!: (e: Error) => void;
    const expired = new Promise<never>((_, reject) => {
      rejectTimeout = reject;
    });
    const timer = setTimeout(() => {
      controller.abort(timeout);
      rejectTimeout(timeout);
    }, timeoutMs);
    const operation = (async () => {
      try {
        if (this.#active > 0)
          await new Promise<void>((resolve, reject) => {
            const done = () => {
              cleanup();
              resolve();
            };
            const abort = () => {
              cleanup();
              reject(timeout);
            };
            const cleanup = () => {
              this.#idle.delete(done);
              controller.signal.removeEventListener('abort', abort);
            };
            this.#idle.add(done);
            controller.signal.addEventListener('abort', abort, { once: true });
          });
        controller.signal.throwIfAborted();
        const scope = { active: true, exclusive: true };
        try {
          return await this.#scope.run(scope, () => fn(controller.signal));
        } finally {
          scope.active = false;
        }
      } finally {
        clearTimeout(timer);
        this.#busy = false;
      }
    })();
    return Promise.race([operation, expired]);
  }
}
