import { Button, Input, Select } from 'antd';
import { BusinessError, centsToYuan, formatMoney } from '@caiwu/core';
import { DataTable, type DataColumn } from '@caiwu/ui';
import { z } from 'zod';
import { OpeningRowSchema } from '../shared';
import { openingCents, openingValue } from '../opening';
import { ProductSelect } from './common';

export type OpeningDraftLine = {
  productCode: string;
  quantity: string;
  valueBasis: 'unitPrice' | 'amount';
  unitPrice: string;
  amount: string;
};
export function openingInput(line: OpeningDraftLine) {
  return OpeningRowSchema.parse({
    productCode: line.productCode,
    quantity: line.quantity,
    valueBasis: line.valueBasis,
    ...(line.valueBasis === 'amount'
      ? { amountCents: openingCents(line.amount) }
      : { unitPrice: line.unitPrice }),
  });
}
export function openingError(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues.map((i) => i.message).join('；');
  return error instanceof BusinessError
    ? error.data.message
    : error instanceof Error
      ? error.message
      : '期初数据不合法';
}
export default function OpeningEditor({
  lines,
  onChange,
  disabled,
}: {
  lines: OpeningDraftLine[];
  onChange: (lines: OpeningDraftLine[]) => void;
  disabled: boolean;
}) {
  const update = (index: number, patch: Partial<OpeningDraftLine>) =>
    onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const values = lines.map((line) => {
    try {
      return { value: openingValue(openingInput(line)), error: '' };
    } catch (error) {
      return { value: null, error: openingError(error) };
    }
  });
  const columns: DataColumn<OpeningDraftLine & { key: string }>[] = [
    {
      key: 'product',
      title: '产品编号/名称',
      width: 240,
      render: (_, r, index) => (
        <ProductSelect
          label={`第${index + 1}行产品`}
          value={r.productCode}
          onChange={(productCode) => !disabled && update(index, { productCode })}
        />
      ),
    },
    {
      key: 'quantity',
      title: '数量',
      width: 150,
      render: (_, r, index) => (
        <Input
          aria-label={`第${index + 1}行数量`}
          disabled={disabled}
          value={r.quantity}
          onChange={(e) => update(index, { quantity: e.target.value })}
        />
      ),
    },
    {
      key: 'basis',
      title: '保存口径',
      width: 160,
      render: (_, r, index) => (
        <Select
          aria-label={`第${index + 1}行保存口径`}
          disabled={disabled}
          value={r.valueBasis}
          onChange={(valueBasis) => update(index, { valueBasis })}
          options={[
            { value: 'unitPrice', label: '数量×单价' },
            { value: 'amount', label: '直接金额' },
          ]}
        />
      ),
    },
    {
      key: 'unitPrice',
      title: '单价（元，反算六位小数）',
      width: 200,
      render: (_, r, index) => (
        <Input
          aria-label={`第${index + 1}行单价`}
          disabled={disabled || r.valueBasis === 'amount'}
          value={
            r.valueBasis === 'unitPrice' ? r.unitPrice : (values[index]?.value?.unitPrice ?? '')
          }
          onChange={(e) => update(index, { unitPrice: e.target.value })}
        />
      ),
    },
    {
      key: 'amount',
      title: '金额（元）',
      width: 180,
      render: (_, r, index) => (
        <Input
          aria-label={`第${index + 1}行金额`}
          disabled={disabled || r.valueBasis === 'unitPrice'}
          value={
            r.valueBasis === 'amount'
              ? r.amount
              : values[index]?.value
                ? centsToYuan(values[index]!.value!.amountCents)
                : ''
          }
          onChange={(e) => update(index, { amount: e.target.value })}
        />
      ),
    },
    {
      key: 'result',
      title: '保存结果 / 校验',
      width: 240,
      render: (_, __, index) =>
        values[index]?.value
          ? `${formatMoney(values[index]!.value!.amountCents)} 元`
          : values[index]?.error,
    },
    {
      key: 'remove',
      title: '操作',
      render: (_, __, index) => (
        <Button
          disabled={disabled}
          danger
          onClick={() => onChange(lines.filter((_, i) => i !== index))}
        >
          删行
        </Button>
      ),
    },
  ];
  return (
    <>
      <DataTable
        tableId="inventory.opening-editor"
        rowKey="key"
        columns={columns}
        dataSource={lines.map((l, i) => ({ ...l, key: String(i) }))}
      />
      <Button
        disabled={disabled}
        onClick={() =>
          onChange([
            ...lines,
            {
              productCode: '',
              quantity: '1',
              unitPrice: '0',
              amount: '0.00',
              valueBasis: 'unitPrice',
            },
          ])
        }
      >
        增加明细行
      </Button>
    </>
  );
}
