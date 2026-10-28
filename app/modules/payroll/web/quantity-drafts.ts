import { useCallback, useRef, useState } from 'react';
import { quantityText } from '../quantity';

export function useQuantityDrafts() {
  const current = useRef<Record<string, string>>({});
  const [, render] = useState(0);
  const clear = useCallback(() => {
    current.current = {};
    render((version) => version + 1);
  }, []);
  const observe = (key: string, text: string) => {
    current.current = { ...current.current, [key]: text };
    render((version) => version + 1);
  };
  const invalidFor = (keys: readonly string[]) =>
    Object.fromEntries(
      keys.flatMap((key) => {
        const raw = current.current[key];
        return raw?.trim() && quantityText(raw) === null ? [[key, raw]] : [];
      }),
    ) as Record<string, string>;
  return {
    clear,
    observe,
    text: (key: string) => current.current[key],
    invalidFor,
    validate: (keys: readonly string[]) => Object.keys(invalidFor(keys)).length === 0,
  };
}
