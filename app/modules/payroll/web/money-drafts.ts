import { useCallback, useRef, useState } from 'react';
import { parseMoney } from '@caiwu/core';
import type { MoneyInputDraftState } from '@caiwu/ui';

/** 工资编辑保留未能解析的原文；解析规则与公共金额输入完全一致。 */
export function validMoneyDraft(text: string, allowNegative = true) {
  if (!text.trim()) return true;
  try {
    const value = parseMoney(text);
    return value !== null && Number.isSafeInteger(value) && (allowNegative || value >= 0);
  } catch {
    return false;
  }
}

export function useMoneyDrafts() {
  const current = useRef<Record<string, MoneyInputDraftState>>({});
  const [, setStates] = useState<Record<string, MoneyInputDraftState>>({});
  const [resetKey, setResetKey] = useState(0);
  const publish = useCallback((next: Record<string, MoneyInputDraftState>) => {
    current.current = next;
    setStates(next);
  }, []);
  const observe = (key: string, state: MoneyInputDraftState | null) => {
    // null仅代表控件卸载；分页、筛选或模式切换后仍须恢复原文。
    if (!state || JSON.stringify(current.current[key]) === JSON.stringify(state)) return false;
    publish({ ...current.current, [key]: state });
    return true;
  };
  const clear = useCallback(() => {
    publish({});
    setResetKey((value) => value + 1);
  }, [publish]);
  const forget = (prefix: string) =>
    publish(
      Object.fromEntries(
        Object.entries(current.current).filter(([key]) => !key.startsWith(prefix)),
      ),
    );
  return {
    resetKey,
    invalidFor: (keys: readonly string[]) =>
      Object.fromEntries(
        keys.flatMap((key) => {
          const state = current.current[key];
          return state && !state.valid ? [[key, state.text]] : [];
        }),
      ) as Record<string, string>,
    text: (key: string) => current.current[key]?.text,
    observe,
    clear,
    forget,
    forgetExact: (key: string) =>
      publish(
        Object.fromEntries(
          Object.entries(current.current).filter(([candidate]) => candidate !== key),
        ),
      ),
    removeListItem: (prefix: string, index: number) => {
      const start = `${prefix}.`;
      publish(
        Object.fromEntries(
          Object.entries(current.current).flatMap(([key, state]) => {
            if (!key.startsWith(start)) return [[key, state]];
            const tail = key.slice(start.length);
            const item = /^(\d+)(.*)$/.exec(tail);
            if (!item) return [[key, state]];
            const position = Number(item[1]);
            if (position === index) return [];
            return [[position > index ? `${start}${position - 1}${item[2]}` : key, state]];
          }),
        ),
      );
    },
    validate: (keys: readonly string[]) =>
      keys.every((key) => {
        const state = current.current[key];
        return !state || (state.valid && validMoneyDraft(state.text));
      }),
  };
}
