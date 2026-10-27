import { useLayoutEffect, useReducer, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useTab } from './tabs';
import { useRequiredSession } from './session';

export type UnsavedPage = {
  bookId: string;
  tabKey: string;
  title: string;
  dirty: boolean;
  version?: string | number;
  save: () => Promise<boolean | void>;
  discard?: () => Promise<void> | void;
};
export type LeaveChoice = 'save' | 'discard' | 'cancel';
export class UnsavedRegistry {
  readonly pages = new Map<symbol, UnsavedPage>();
  private confirmation?: Promise<boolean>;
  private confirmationKey?: string;
  private unversionedUpdates = new WeakMap<UnsavedPage, number>();
  register(page: UnsavedPage) {
    const id = Symbol();
    this.pages.set(id, page);
    return {
      update: (next: UnsavedPage) => {
        const previous = this.pages.get(id);
        if (previous && previous.dirty === next.dirty && previous.version === next.version) {
          if (next.dirty && next.version === undefined)
            this.unversionedUpdates.set(previous, (this.unversionedUpdates.get(previous) ?? 0) + 1);
          Object.assign(previous, next);
        } else this.pages.set(id, next);
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
    confirm: (pages: readonly UnsavedPage[]) => Promise<LeaveChoice>,
  ): Promise<boolean> {
    const key = JSON.stringify([bookId, keys ? [...keys].sort() : null]);
    if (this.confirmation)
      return this.confirmationKey === key ? this.confirmation : Promise.resolve(false);
    this.confirmationKey = key;
    this.confirmation = (async () => {
      const pages = this.dirty(bookId, keys);
      const versions = new Map(pages.map((page) => [page, page.version]));
      const updates = new Map(pages.map((page) => [page, this.unversionedUpdates.get(page) ?? 0]));
      if (!pages.length) return true;
      const choice = await confirm(pages);
      if (choice === 'cancel') return false;
      const changed = () =>
        this.dirty(bookId, keys).some(
          (page) =>
            !versions.has(page) ||
            versions.get(page) !== page.version ||
            (page.version === undefined &&
              updates.get(page) !== (this.unversionedUpdates.get(page) ?? 0)),
        );
      try {
        if (changed()) return false;
        for (const page of pages) {
          // A clean page may have advanced its version while the dialog was open.
          if (!this.dirty(bookId, keys).includes(page)) continue;
          if (choice === 'save') {
            if ((await page.save()) === false) return false;
            // Success describes the saved snapshot, not edits made during that save.
            // This also protects callers that omit the optional content version.
            if (this.dirty(bookId, keys).includes(page)) return false;
          } else await page.discard?.();
          if (changed()) return false;
        }
        return choice === 'discard' || this.dirty(bookId, keys).length === 0;
      } catch {
        return false;
      }
    })().finally(() => {
      this.confirmation = undefined;
      this.confirmationKey = undefined;
    });
    return this.confirmation;
  }
}
export const unsavedPages = new UnsavedRegistry();
export function useUnsavedChanges(input: {
  dirty: boolean;
  title: string;
  version?: string | number;
  save: () => Promise<boolean | void>;
  discard?: () => Promise<void> | void;
}) {
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  const tab = useTab();
  const session = useRequiredSession();
  const latest = useRef(input);
  latest.current = input;
  const registration = useRef<ReturnType<UnsavedRegistry['register']> | null>(null);
  useLayoutEffect(() => {
    const entry = unsavedPages.register({
      ...latest.current,
      save: async () => {
        const result = await latest.current.save();
        flushSync(() => refresh());
        return result;
      },
      discard: async () => {
        await latest.current.discard?.();
        flushSync(() => refresh());
      },
      bookId: session.bookId,
      tabKey: tab.key,
    });
    registration.current = entry;
    return () => {
      entry.unregister();
      registration.current = null;
    };
  }, [session.bookId, tab.key]);
  useLayoutEffect(() => {
    registration.current?.update({
      ...input,
      save: async () => {
        const result = await latest.current.save();
        flushSync(() => refresh());
        return result;
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
