import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export class RequestActivity {
  readonly #listeners = new Set<() => void>();
  readonly #requests = new Map<symbol, { timer: ReturnType<typeof setTimeout>; slow: boolean }>();
  #state = { pending: 0, slow: 0 };
  readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  readonly snapshot = () => this.#state;
  #publish() {
    this.#state = {
      pending: this.#requests.size,
      slow: [...this.#requests.values()].filter((r) => r.slow).length,
    };
    for (const listener of this.#listeners) listener();
  }
  start() {
    const id = Symbol();
    const entry = {
      slow: false,
      timer: setTimeout(() => {
        entry.slow = true;
        this.#publish();
      }, 300),
    };
    this.#requests.set(id, entry);
    this.#publish();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      clearTimeout(entry.timer);
      this.#requests.delete(id);
      this.#publish();
    };
  }
}
export const requestActivity = new RequestActivity();
export function useRequestActivity() {
  return useSyncExternalStore(requestActivity.subscribe, requestActivity.snapshot);
}

/** Duplicate clicks share the same in-flight submission; the server still performs every business validation. */
export function useSubmission() {
  const [isSubmitting, setSubmitting] = useState(false);
  const pending = useRef<Promise<unknown> | null>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const submit = useCallback(<T>(run: () => Promise<T>): Promise<T> => {
    if (pending.current) return pending.current as Promise<T>;
    setSubmitting(true);
    const result = Promise.resolve()
      .then(run)
      .finally(() => {
        pending.current = null;
        if (mounted.current) setSubmitting(false);
      });
    pending.current = result;
    return result;
  }, []);
  return { isSubmitting, submit };
}
