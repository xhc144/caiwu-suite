import { ResourceGate, withRequestLeases } from '@caiwu/db';
import { BusinessError } from '@caiwu/core';
import type { BookMaintenancePlan, CoreServices, OpenBook } from '@caiwu/core/server';
import { withServiceScope, createCoreServices, loadServiceUser } from '@caiwu/core/server';
import type { AppRuntime } from './context';
import type { ServerModule } from './module';

export interface RuntimeHookContext {
  app: AppRuntime;
  signal: AbortSignal;
}
export interface BookCloseHookContext extends RuntimeHookContext {
  book: OpenBook;
  reason: 'close' | 'maintenance' | 'shutdown';
}
/** 显式注册才生效；hook 必须等待自己的后台任务并响应 signal，不能依赖页面存活。 */
export interface RuntimeHooks {
  start?: (ctx: RuntimeHookContext) => Promise<void>;
  beforeBookClose?: (ctx: BookCloseHookContext) => Promise<void>;
  stop?: (ctx: RuntimeHookContext) => Promise<void>;
}

export class RuntimeLifecycle {
  readonly #requests = new ResourceGate(
    () =>
      new BusinessError({
        code: 'RUNTIME_UNAVAILABLE',
        message: '服务正在启动、退出或处于失败状态，请稍后重试',
      }),
  );
  readonly #control = new ResourceGate(
    (reason) =>
      new BusinessError({
        code: reason === 'timeout' ? 'LIFECYCLE_TIMEOUT' : 'RUNTIME_UNAVAILABLE',
        message:
          reason === 'timeout'
            ? '生命周期任务超时，未结束任务继续保留占用'
            : '生命周期任务尚未结束',
      }),
  );
  #state: 'created' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed' = 'created';
  #startTask: Promise<void> | undefined;
  #stopTask: Promise<void> | undefined;
  readonly #entered: ServerModule[] = [];

  constructor(
    readonly app: AppRuntime,
    readonly timeoutMs = 30_000,
  ) {}
  get state() {
    return this.#state;
  }

  start(): Promise<void> {
    if (this.#startTask) return this.#startTask;
    if (this.#state !== 'created') return Promise.reject(this.#requests.error('busy'));
    this.#state = 'starting';
    this.#startTask = this.#control
      .exclusive(async (signal) => {
        try {
          for (const mod of this.app.modules.modules) {
            this.#entered.push(mod);
            await mod.lifecycle?.start?.({ app: this.app, signal });
            signal.throwIfAborted();
          }
          this.#state = 'ready';
        } catch (error) {
          this.#state = 'failed';
          throw error;
        }
      }, this.timeoutMs)
      .catch((error: unknown) => {
        this.#state = 'failed';
        throw error;
      });
    return this.#startTask;
  }

  async request<T>(fn: () => Promise<T>): Promise<T> {
    await this.start();
    if (this.#state !== 'ready') throw this.#requests.error('busy');
    return this.#requests.run(() => withRequestLeases(fn));
  }

  async beforeBookClose(
    book: OpenBook,
    signal: AbortSignal,
    reason: BookCloseHookContext['reason'],
  ): Promise<void> {
    for (const mod of [...this.#entered].reverse()) {
      await mod.lifecycle?.beforeBookClose?.({ app: this.app, book, signal, reason });
      signal.throwIfAborted();
    }
    // 普通缓存关闭保持旧调用兼容；维护/退出才要求重新登录。
    if (reason !== 'close') this.app.sessions.deleteForBook(book.id);
  }

  /** 先关请求门、排空，再等待模块停止和账套关闭；失败不释放目录，不虚报退出成功。 */
  stop(): Promise<void> {
    if (this.#stopTask) return this.#stopTask;
    if (this.#control.busy) return Promise.reject(this.#control.error('busy'));
    this.#state = 'stopping';
    this.#stopTask = this.#control
      .exclusive(async (signal) => {
        await this.#requests.exclusive(async () => {
          for (const mod of [...this.#entered].reverse()) {
            await mod.lifecycle?.stop?.({ app: this.app, signal });
            signal.throwIfAborted();
          }
          await this.app.bookStore.dispose();
          signal.throwIfAborted();
          this.#state = 'stopped';
        }, this.timeoutMs);
      }, this.timeoutMs)
      .catch((error: unknown) => {
        this.#state = 'failed';
        this.#stopTask = undefined;
        throw error;
      });
    return this.#stopTask;
  }

  /** 后台控制器显式取得按模块的系统服务租约；只能由受信任的服务端 hook 调用。 */
  withSystemBook<T>(
    moduleId: string,
    bookId: string,
    fn: (svc: CoreServices, book: OpenBook) => Promise<T>,
  ): Promise<T> {
    if (this.#state === 'failed' || this.#state === 'stopped') throw this.#requests.error('busy');
    if (!this.app.modules.lookup.manifest(moduleId)) throw new Error('系统服务必须绑定已登记模块');
    return withServiceScope(() =>
      this.app.bookStore.withBook(bookId, (book) =>
        fn(
          createCoreServices({
            db: book.db,
            user: { id: 0, code: 'system', name: '系统', isAdmin: true, permissions: new Set() },
            moduleId,
            now: this.app.now,
            modules: this.app.modules.lookup,
            providers: this.app.modules.providers,
          }),
          book,
        ),
      ),
    );
  }

  /**
   * 不新增公共路由。模块仍须声明 mutation 权限并在 authorize 中复核目标密码/确认计划。
   * 升级当前请求后旧 svc 不可再用；排空后撤销目标全部会话，成功或失败均须重新登录。
   */
  async maintainBook<T>(input: {
    token: string;
    bookId: string;
    permission: string;
    authorize: (svc: CoreServices) => Promise<void>;
    plan: Omit<BookMaintenancePlan<T>, 'onQuiesced'>;
  }): Promise<T | undefined> {
    if (this.#state !== 'ready') throw this.#requests.error('busy');
    if (!this.app.modules.lookup.permissionName(input.permission))
      throw new Error('维护权限必须已登记');
    const authorize = async () => {
      const session = this.app.sessions.get(input.token);
      if (!session)
        throw new BusinessError({ code: 'UNAUTHORIZED', message: '登录已失效，请重新登录' });
      await this.app.bookStore.withBook(session.bookId, async (book) => {
        const user = await loadServiceUser(book.db, session.userId);
        if (!user)
          throw new BusinessError({ code: 'UNAUTHORIZED', message: '操作员已失效，请重新登录' });
        const svc = createCoreServices({
          db: book.db,
          user,
          moduleId: null,
          now: this.app.now,
          modules: this.app.modules.lookup,
          providers: this.app.modules.providers,
        });
        svc.permissions.require(input.permission);
        await input.authorize(svc);
      });
      if (this.app.sessions.get(input.token) !== session)
        throw new BusinessError({ code: 'UNAUTHORIZED', message: '会话已撤销，请重新登录' });
    };
    await authorize();
    return this.app.bookStore.maintain(input.bookId, {
      ...input.plan,
      onQuiesced: async () => {
        await authorize();
        this.app.sessions.deleteForBook(input.bookId);
      },
    });
  }
}
