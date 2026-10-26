import { SettingsSchema, type BackupSettings } from '../shared';

type Result = { status: string; reason: string };
export type AutomaticBackupBinding = {
  settings: () => Promise<BackupSettings>;
  /** 必须等待完整备份、真实校验及轮替结束后返回。 */
  backup: (kind: 'automatic') => Promise<Result>;
};
export type Clock = {
  now: () => number;
  set: (fn: () => void, ms: number) => unknown;
  clear: (id: unknown) => void;
};
type Entry = {
  binding: AutomaticBackupBinding;
  timer?: unknown;
  running?: Promise<void>;
  lastSuccess: string | null;
  lastFailure: string | null;
  nextAt: string | null;
  stopped: boolean;
  generation: number;
};
const systemClock: Clock = {
  now: Date.now,
  set: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    timer.unref();
    return timer;
  },
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};
/** 运行时控制器；每个账套串行执行，调度不依赖页面存活。 */
export class AutomaticBackupController {
  readonly #clock: Clock;
  readonly #books = new Map<string, Entry>();
  #shutdown: Promise<{ bookId: string; reason: string }[]> | undefined;
  constructor(clock: Clock = systemClock) {
    this.#clock = clock;
  }
  status(id: string) {
    const s = this.#books.get(id);
    return s
      ? {
          lastSuccess: s.lastSuccess,
          lastFailure: s.lastFailure,
          nextAt: s.nextAt,
          running: !!s.running,
          attached: !s.stopped,
        }
      : { lastSuccess: null, lastFailure: null, nextAt: null, running: false, attached: false };
  }
  async attach(id: string, binding: AutomaticBackupBinding, runOnStart = true) {
    if (this.#shutdown) throw new Error('自动备份控制器正在退出，不能再接入账套');
    if (this.#books.has(id)) return;
    const s: Entry = {
      binding,
      lastSuccess: null,
      lastFailure: null,
      nextAt: null,
      stopped: false,
      generation: 0,
    };
    this.#books.set(id, s);
    try {
      const config = SettingsSchema.parse(await binding.settings());
      if (runOnStart && config.enabled && config.onStart) await this.run(id);
    } catch (e) {
      s.lastFailure = this.#message(e);
    }
    await this.#schedule(id);
  }
  #message(e: unknown) {
    return e instanceof Error ? e.message : '自动备份失败';
  }
  async run(id: string) {
    const s = this.#books.get(id);
    if (!s || s.stopped) return;
    if (s.running) return s.running;
    s.running = (async () => {
      try {
        const config = SettingsSchema.parse(await s.binding.settings());
        if (!config.enabled) return;
        const result = await s.binding.backup('automatic');
        if (result.status !== 'valid') throw new Error(result.reason || '自动备份未完成');
        s.lastSuccess = new Date(this.#clock.now()).toISOString();
        s.lastFailure = null;
      } catch (e) {
        s.lastFailure = this.#message(e);
      }
    })();
    try {
      await s.running;
    } finally {
      s.running = undefined;
    }
  }
  async #schedule(id: string) {
    const s = this.#books.get(id);
    if (!s || s.stopped) return;
    const generation = ++s.generation;
    if (s.timer != null) this.#clock.clear(s.timer);
    s.timer = undefined;
    s.nextAt = null;
    try {
      const config = SettingsSchema.parse(await s.binding.settings());
      if (s.stopped || s.generation !== generation || !config.enabled) return;
      const ms = config.intervalMinutes * 60_000;
      s.nextAt = new Date(this.#clock.now() + ms).toISOString();
      s.timer = this.#clock.set(() => {
        s.timer = undefined;
        s.nextAt = null;
        void this.run(id).then(() => {
          if (s.generation === generation) return this.#schedule(id);
        });
      }, ms);
    } catch (e) {
      s.lastFailure = this.#message(e);
    }
  }
  async reconfigure(id: string) {
    await this.#schedule(id);
  }
  async detach(id: string) {
    const s = this.#books.get(id);
    if (!s) return;
    s.stopped = true;
    s.generation++;
    s.nextAt = null;
    if (s.timer != null) this.#clock.clear(s.timer);
    await s.running;
    this.#books.delete(id);
  }
  shutdown() {
    if (!this.#shutdown) this.#shutdown = this.#stop();
    return this.#shutdown;
  }
  async #stop() {
    const failures: { bookId: string; reason: string }[] = [];
    // 先阻止全部账套的后续定时任务，再等待已有任务。
    for (const s of this.#books.values()) {
      s.stopped = true;
      s.generation++;
      s.nextAt = null;
      if (s.timer != null) this.#clock.clear(s.timer);
    }
    for (const [id, s] of this.#books) {
      await s.running;
      try {
        const config = SettingsSchema.parse(await s.binding.settings());
        if (config.enabled && config.onExit) {
          const result = await s.binding.backup('automatic');
          if (result.status !== 'valid') throw new Error(result.reason || '退出备份未完成');
          s.lastSuccess = new Date(this.#clock.now()).toISOString();
          s.lastFailure = null;
        }
      } catch (e) {
        s.lastFailure = this.#message(e);
        failures.push({ bookId: id, reason: s.lastFailure });
      }
    }
    return failures;
  }
}
