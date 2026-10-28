import { useLayoutEffect, useReducer, useRef, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { useTab } from './tabs';
import { sessionStore, useRequiredSession } from './session';

export type UnsavedSaveResult = boolean | void | { sessionRevoked: true };
export type UnsavedSaveContext = {
  readonly bookId: string;
  readonly phase: 'save' | 'session';
  /** Call immediately around the session-revoking request, after any async validation. */
  commit(action: () => Promise<UnsavedSaveResult>): Promise<UnsavedSaveResult>;
  /** Navigation/cache teardown runs only after every page has been handled successfully. */
  afterLeave(action: () => Promise<void> | void): void;
};
export type UnsavedSave = (context?: UnsavedSaveContext) => Promise<UnsavedSaveResult>;
export type LeaveResult = {
  allowed: boolean;
  sessionRevoked: boolean;
  error?: unknown;
};
export type UnsavedPage = {
  bookId: string;
  tabKey: string;
  title: string;
  dirty: boolean;
  version?: string | number;
  /** Session-revoking saves must run after all other dirty pages in this book. */
  savePhase?: 'session';
  save: UnsavedSave;
  discard?: () => Promise<void> | void;
};
export type LeaveChoice = 'save' | 'discard' | 'cancel';
export type ConfirmLeave = (pages: readonly UnsavedPage[]) => Promise<LeaveChoice>;
type PendingLeave = { key: string; promise: Promise<LeaveResult>; saving: boolean };
export class UnsavedRegistry {
  readonly pages = new Map<symbol, UnsavedPage>();
  private confirmations = new Map<string, PendingLeave>();
  private sessionCommits = new Set<string>();
  private commitListeners = new Set<() => void>();
  private unversionedUpdates = new WeakMap<UnsavedPage, number>();
  private settlements = new WeakMap<UnsavedPage, () => void>();
  isSessionCommitPending = (bookId: string): boolean => this.sessionCommits.has(bookId);
  subscribeSessionCommits = (listener: () => void): (() => void) => {
    this.commitListeners.add(listener);
    return () => {
      this.commitListeners.delete(listener);
    };
  };
  private setSessionCommitPending(bookId: string, pending: boolean) {
    // The renderer must apply inert and its event gate before the request starts.
    flushSync(() => {
      if (pending) this.sessionCommits.add(bookId);
      else this.sessionCommits.delete(bookId);
      for (const listener of this.commitListeners) listener();
    });
  }
  register(page: UnsavedPage, settle?: () => void) {
    const id = Symbol();
    this.pages.set(id, page);
    if (settle) this.settlements.set(page, settle);
    return {
      update: (next: UnsavedPage) => {
        const previous = this.pages.get(id);
        if (previous && previous.dirty === next.dirty && previous.version === next.version) {
          if (next.dirty && next.version === undefined)
            this.unversionedUpdates.set(previous, (this.unversionedUpdates.get(previous) ?? 0) + 1);
          Object.assign(previous, next);
        } else {
          this.pages.set(id, next);
          if (settle) this.settlements.set(next, settle);
        }
      },
      unregister: () => this.pages.delete(id),
    };
  }
  dirty(bookId: string, keys?: readonly string[]) {
    return [...this.pages.values()].filter(
      (p) => p.bookId === bookId && p.dirty && (!keys || keys.includes(p.tabKey)),
    );
  }
  leave(
    bookId: string,
    keys: readonly string[] | undefined,
    confirm: ConfirmLeave,
  ): Promise<boolean> {
    return this.leaveWithResult(bookId, keys, confirm).then((result) => result.allowed);
  }
  leaveWithResult(
    bookId: string,
    keys: readonly string[] | undefined,
    confirm: ConfirmLeave,
  ): Promise<LeaveResult> {
    const key = JSON.stringify([bookId, keys ? [...keys].sort() : null]);
    return this.coordinate(key, bookId, keys, confirm);
  }
  /** Direct submit uses the same ordering as closing/switching. Inside save(context),
   * call context.commit instead of recursively requesting another leave. */
  saveSessionChange(
    bookId: string,
    tabKey: string,
    confirm: ConfirmLeave,
    save: UnsavedSave,
  ): Promise<LeaveResult> {
    return this.coordinate(
      JSON.stringify([bookId, tabKey, 'session']),
      bookId,
      undefined,
      confirm,
      {
        tabKey,
        save,
      },
    );
  }
  private coordinate(
    key: string,
    bookId: string,
    keys: readonly string[] | undefined,
    confirm: ConfirmLeave,
    direct?: { tabKey: string; save: UnsavedSave },
  ): Promise<LeaveResult> {
    // A save callback awaiting its own leave promise deadlocks. Only duplicate
    // confirmation requests may join; callbacks receive an explicit context.
    const existing = this.confirmations.get(bookId);
    if (existing)
      return existing.key === key && !existing.saving
        ? existing.promise
        : Promise.resolve({ allowed: false, sessionRevoked: false });
    // An asynchronous afterLeave still owns the old session until it finishes.
    if (this.isSessionCommitPending(bookId))
      return Promise.resolve({ allowed: false, sessionRevoked: false });
    let complete!: (outcome: LeaveResult) => void;
    const confirmation = new Promise<LeaveResult>((resolve) => {
      complete = resolve;
    });
    const operation: PendingLeave = { key, promise: confirmation, saving: false };
    let commitLocked = false;
    const startingSession = sessionStore.get();
    let sessionRevoked = false;
    const afterLeave: (() => Promise<void> | void)[] = [];
    const result = (allowed: boolean, error?: unknown): LeaveResult => ({
      allowed,
      sessionRevoked,
      ...(error === undefined ? {} : { error }),
    });
    const run = async (): Promise<LeaveResult> => {
      const selected = this.dirty(bookId, keys);
      const scope =
        direct || selected.some((page) => page.savePhase === 'session') ? undefined : keys;
      const pages = this.dirty(bookId, scope);
      if (!pages.length && !direct) return result(true);
      const versions = new Map(pages.map((page) => [page, page.version]));
      const updates = new Map(pages.map((page) => [page, this.unversionedUpdates.get(page) ?? 0]));
      const phases = new Map(pages.map((page) => [page, page.savePhase]));
      const sessionPages = pages.filter((page) => page.savePhase === 'session');
      const sessionPage = sessionPages[0];
      const confirmPages = direct ? pages.filter((page) => page !== sessionPage) : pages;
      const choice = confirmPages.length ? await confirm(confirmPages) : 'save';
      if (choice === 'cancel') return result(false);
      operation.saving = true;
      // Once one request revokes the token, a second such save cannot be made safely.
      if (
        (direct || choice === 'save') &&
        (sessionPages.length > 1 ||
          (direct && sessionPages.some((p) => p.tabKey !== direct.tabKey)))
      )
        return result(
          false,
          new Error('有多页修改需要重新登录，请保留一页修改，取消其他相关页面的修改后再试。'),
        );
      const changed = () =>
        this.dirty(bookId, scope).some(
          (page) =>
            !versions.has(page) ||
            versions.get(page) !== page.version ||
            phases.get(page) !== page.savePhase ||
            (page.version === undefined &&
              updates.get(page) !== (this.unversionedUpdates.get(page) ?? 0)),
        );
      const discarded = new Set<UnsavedPage>();
      const canCommit = () =>
        !changed() &&
        this.dirty(bookId, scope).every((page) => page === sessionPage || discarded.has(page));
      const savePage = async (save: UnsavedSave, phase: 'save' | 'session') => {
        let committed = false;
        let active = true;
        const context: UnsavedSaveContext = {
          bookId,
          phase,
          commit: async (action) => {
            if (!active || phase !== 'session' || committed || !canCommit()) return false;
            committed = true;
            commitLocked = true;
            this.setSessionCommitPending(bookId, true);
            // Applying the renderer gate may flush a pending content update.
            if (!canCommit()) return false;
            const saved = await action();
            if (typeof saved === 'object' && saved.sessionRevoked) sessionRevoked = true;
            return saved;
          },
          afterLeave: (action) => {
            if (!active || phase !== 'session') throw new Error('保存尚未完成，暂时不能重新登录。');
            afterLeave.push(action);
          },
        };
        try {
          const saved = await save(context);
          if (typeof saved === 'object' && saved.sessionRevoked) sessionRevoked = true;
          return saved !== false;
        } finally {
          active = false;
        }
      };
      if (changed()) return result(false);
      // Discarding a session page does not revoke the session. A direct submit
      // still commits its initiating page after the other pages are handled.
      const preparing =
        choice === 'discard' && !direct ? pages : pages.filter((p) => p !== sessionPage);
      for (const page of preparing) {
        if (!this.dirty(bookId, scope).includes(page)) continue;
        if (choice === 'save') {
          if (!(await savePage(page.save, 'save'))) return result(false);
          if (sessionRevoked)
            return result(false, new Error('此页保存后需要重新登录，无法继续保存其他页面。'));
          if (this.dirty(bookId, scope).includes(page)) return result(false);
        } else {
          await page.discard?.();
          discarded.add(page);
        }
        if (changed()) return result(false);
      }
      // Direct actions may differ from the page's registered save. Flush that
      // page's React state without substituting a different credential action.
      const finalSave = direct
        ? async (context?: UnsavedSaveContext) => {
            try {
              return await direct.save(context);
            } finally {
              if (sessionPage) this.settlements.get(sessionPage)?.();
            }
          }
        : choice === 'save'
          ? sessionPage?.save
          : undefined;
      if (finalSave && (direct || this.dirty(bookId, scope).includes(sessionPage!))) {
        if (!canCommit() || !(await savePage(finalSave, 'session'))) return result(false);
      }
      return result(!changed() && this.dirty(bookId, scope).every((page) => discarded.has(page)));
    };
    // Install the lock before invoking even a synchronous confirmation callback.
    this.confirmations.set(bookId, operation);
    void run()
      .catch((error: unknown) => result(false, error))
      .then(async (outcome) => {
        this.confirmations.delete(bookId);
        let finished = outcome;
        try {
          if (outcome.allowed && outcome.sessionRevoked) {
            for (const action of afterLeave) await action();
          }
        } catch (error) {
          finished = result(false, error);
        }
        try {
          // Only a clean workspace may be torn down after a failed redirect.
          if (
            finished.sessionRevoked &&
            !finished.allowed &&
            this.dirty(bookId).length === 0 &&
            startingSession?.bookId === bookId &&
            sessionStore.get()?.token === startingSession.token
          )
            sessionStore.set(null);
        } catch (error) {
          finished = result(false, finished.error ?? error);
        } finally {
          try {
            if (commitLocked) this.setSessionCommitPending(bookId, false);
          } finally {
            complete(finished);
          }
        }
      });
    return confirmation;
  }
}
export const unsavedPages = new UnsavedRegistry();
export function useSessionCommitPending(bookId: string): boolean {
  return useSyncExternalStore(
    unsavedPages.subscribeSessionCommits,
    () => unsavedPages.isSessionCommitPending(bookId),
    () => false,
  );
}
export function useUnsavedChanges(input: Omit<UnsavedPage, 'bookId' | 'tabKey'>) {
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  const tab = useTab();
  const session = useRequiredSession();
  const latest = useRef(input);
  latest.current = input;
  const registration = useRef<ReturnType<UnsavedRegistry['register']> | null>(null);
  useLayoutEffect(() => {
    const entry = unsavedPages.register(
      {
        ...latest.current,
        save: async (context) => {
          try {
            return await latest.current.save(context);
          } finally {
            flushSync(() => refresh());
          }
        },
        discard: async () => {
          await latest.current.discard?.();
          flushSync(() => refresh());
        },
        bookId: session.bookId,
        tabKey: tab.key,
      },
      () => flushSync(() => refresh()),
    );
    registration.current = entry;
    return () => {
      entry.unregister();
      registration.current = null;
    };
  }, [session.bookId, tab.key]);
  useLayoutEffect(() => {
    registration.current?.update({
      ...input,
      save: async (context) => {
        try {
          return await latest.current.save(context);
        } finally {
          flushSync(() => refresh());
        }
      },
      discard: async () => {
        await latest.current.discard?.();
        flushSync(() => refresh());
      },
      bookId: session.bookId,
      tabKey: tab.key,
    });
  }, [input, session.bookId, tab.key]);
}
