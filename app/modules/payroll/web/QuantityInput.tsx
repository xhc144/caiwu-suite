import { Input } from 'antd';
import { quantityText } from '../quantity';

/** 原文由父级持有，分页卸载及保存失败均不丢失非法输入。 */
export default function QuantityInput({
  value,
  draftText,
  onDraftChange,
  onChange,
  ...rest
}: {
  value?: string;
  draftText?: string;
  onDraftChange: (text: string) => void;
  onChange: (value: string | undefined) => void;
  disabled?: boolean;
  'aria-label': string;
  status?: 'error';
}) {
  return (
    <Input
      {...rest}
      inputMode="decimal"
      value={draftText ?? value ?? ''}
      onChange={(event) => {
        const raw = event.target.value;
        onDraftChange(raw);
        if (!raw.trim()) onChange(undefined);
        else {
          const canonical = quantityText(raw);
          if (canonical !== null) onChange(canonical);
        }
      }}
    />
  );
}
