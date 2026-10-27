import { createContext, useRef, useState } from 'react';
export type InvalidAmount = { text: string; label: string; line: number; field: string };
/** 每个编辑器自己的非法金额文本，分录抽屉关闭后仍保留。 */
export function useAmountDrafts() {
  const values = useRef(new Map<string, InvalidAmount>());
  const [epoch, setEpoch] = useState(0);
  return {
    values: values.current,
    epoch,
    remap: (lineNumber: (line: number) => number | null) => {
      const next = [...values.current.values()].flatMap((value) => {
        const line = lineNumber(value.line);
        if (line == null) return [];
        const label = value.label.replace(/^第\d+行/, `第${line}行`);
        return [[`${label}:${value.field}`, { ...value, line, label }] as const];
      });
      values.current.clear();
      for (const [key, value] of next) values.current.set(key, value);
      setEpoch((n) => n + 1);
    },
    clear: () => {
      values.current.clear();
      setEpoch((n) => n + 1);
    },
  };
}
export const AmountDraftContext = createContext<ReturnType<typeof useAmountDrafts> | null>(null);
