import { randomBytes } from 'node:crypto';

export interface Session {
  token: string;
  bookId: string;
  userId: number;
  createdAt: number;
  lastSeenAt: number;
}

/** 登录会话（内存）。服务重启后需要重新登录。空闲 12 小时过期。 */
export class SessionStore {
  readonly #sessions = new Map<string, Session>();
  readonly #idleMs: number;

  constructor(opts: { idleMs?: number } = {}) {
    this.#idleMs = opts.idleMs ?? 12 * 3600_000;
  }

  create(bookId: string, userId: number): Session {
    const now = Date.now();
    const s = {
      token: randomBytes(24).toString('hex'),
      bookId,
      userId,
      createdAt: now,
      lastSeenAt: now,
    };
    this.#sessions.set(s.token, s);
    return s;
  }

  get(token: string | null | undefined): Session | null {
    if (!token) return null;
    const s = this.#sessions.get(token);
    if (!s) return null;
    if (Date.now() - s.lastSeenAt > this.#idleMs) {
      this.#sessions.delete(token);
      return null;
    }
    s.lastSeenAt = Date.now();
    return s;
  }

  delete(token: string): void {
    this.#sessions.delete(token);
  }

  /** 账套被删除、恢复时调用：该账套的所有会话失效。 */
  deleteForBook(bookId: string): void {
    for (const [k, s] of this.#sessions) if (s.bookId === bookId) this.#sessions.delete(k);
  }

  /** 用户被停用、改密时调用。 */
  deleteForUser(bookId: string, userId: number): void {
    for (const [k, s] of this.#sessions)
      if (s.bookId === bookId && s.userId === userId) this.#sessions.delete(k);
  }
}
