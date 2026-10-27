import { useLayoutEffect, useRef } from 'react';
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
  register(page: UnsavedPage) {
    const id = Symbol();
    this.pages.set(id, page);
    return {
      update: (next: UnsavedPage) => {
        const previous = this.pages.get(id);
        if (previous && previous.dirty === next.dirty && previous.version === next.version)
          Object.assign(previous, next);
        else this.pages.set(id, next);
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
      if (!pages.length) return true;
      const choice = await confirm(pages);
      if (choice === 'cancel') return false;
      try {
        for (const page of pages) {
          if (!this.dirty(bookId, keys).includes(page)) return false;
          if (choice === 'save' && (await page.save()) === false) return false;
        }
        // New edits or newly registered dirty pages invalidate the leave decision.
        if (this.dirty(bookId, keys).some((p) => !pages.includes(p))) return false;
        if (choice === 'discard') for (const page of pages) await page.discard?.();
        return true;
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
  const tab = useTab();
  const session = useRequiredSession();
  const latest = useRef(input);
  latest.current = input;
  const registration = useRef<ReturnType<UnsavedRegistry['register']> | null>(null);
  useLayoutEffect(() => {
    const entry = unsavedPages.register({
      ...latest.current,
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
    registration.current?.update({ ...input, bookId: session.bookId, tabKey: tab.key });
  }, [input, session.bookId, tab.key]);
}
