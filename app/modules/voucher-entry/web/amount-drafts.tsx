import { createContext, useRef, useState } from 'react';

export type InvalidAmount = { text: string; label: string; line: number; field: string };
export const amountDraftKey = (line: number, field: string) => `${line}:${field}`;
export const amountDraftHint = (draft: InvalidAmount) =>
  `${draft.label}格式有误，请改为数字金额（例如 123.45），或清空该格后重新输入；修正前不能保存。`;

/** 只保留尚不能提交的文本；不写入数值模型，抽屉卸载后仍可恢复。 */
export function useAmountDrafts(onEdit?: () => void) {
  const values = useRef(new Map<string, InvalidAmount>());
  const [epoch, setEpoch] = useState(0);
  return {
    values: values.current,
    epoch,
    update: (key: string, draft: InvalidAmount | null) => {
      const previous = values.current.get(key);
      if (draft) values.current.set(key, draft);
      else values.current.delete(key);
      if (previous?.text !== draft?.text) onEdit?.();
    },
    remap: (lineNumber: (line: number) => number | null) => {
      const next = [...values.current.values()].flatMap((value) => {
        const line = lineNumber(value.line);
        if (line == null) return [];
        const label = value.label.replace(/^第\d+行/, `第${line}行`);
        return [[amountDraftKey(line, value.field), { ...value, line, label }] as const];
      });
      values.current.clear();
      for (const [key, value] of next) values.current.set(key, value);
      setEpoch((n) => n + 1);
    },
    clearField: (line: number, field: string) => {
      values.current.delete(amountDraftKey(line, field));
      setEpoch((n) => n + 1);
    },
    clear: () => {
      values.current.clear();
      setEpoch((n) => n + 1);
    },
  };
}
export const AmountDraftContext = createContext<ReturnType<typeof useAmountDrafts> | null>(null);
