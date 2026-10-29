import { Card, Input, Space } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { DimensionSelect, MoneyInput, MoneyText } from '@caiwu/ui';
import type { PlanInput } from '../shared';
import { api } from './api';
import { QueryError } from './common';

type Allocation = NonNullable<PlanInput['allocations']>[number];
export default function AllocationFields({
  selection,
  value = [],
  onChange,
}: {
  selection: PlanInput['selection'];
  value?: Allocation[];
  onChange?: (value: Allocation[]) => void;
}) {
  const fields = useQuery({
    ...api.voucherFields.queryOptions(selection),
    enabled: selection.length > 0,
  });
  if (!selection.length) return null;
  return (
    <Card size="small" title="逐票外币、数量与辅助项" style={{ marginTop: 12 }}>
      <QueryError error={fields.error} retry={fields.refetch} />
      {fields.isPending && <p>正在读取核算科目…</p>}
      {fields.isSuccess && !fields.data.length && <p>所选科目无需外币或数量核算。</p>}
      {fields.data?.map((f) => {
        const current = value.find((a) => a.invoiceId === f.invoiceId && a.role === f.role);
        const update = (patch: Partial<Allocation>) =>
          onChange?.([
            ...value.filter((a) => a.invoiceId !== f.invoiceId || a.role !== f.role),
            {
              invoiceId: f.invoiceId,
              role: f.role,
              quantity: f.quantity,
              dimensions: f.dimensions,
              ...current,
              ...patch,
            },
          ]);
        const label = `发票 ${f.number} ${f.accountCode}`;
        return (
          <Card size="small" key={`${f.invoiceId}:${f.role}`} title={`${label} ${f.accountName}`}>
            <Space wrap>
              <span>
                本币金额 <MoneyText value={f.amount} />
              </span>
              {f.currency && (
                <>
                  <label>
                    {f.currency} 原币金额{' '}
                    <MoneyInput
                      aria-label={`${label}原币金额`}
                      style={{ width: 150 }}
                      value={current?.fcAmount}
                      onChange={(fcAmount) => update({ fcAmount })}
                    />
                  </label>
                  <label>
                    汇率{' '}
                    <Input
                      aria-label={`${label}汇率`}
                      style={{ width: 150 }}
                      placeholder={f.exchangeRate ?? '请填写'}
                      value={current?.exchangeRate ?? ''}
                      onChange={(e) => update({ exchangeRate: e.target.value || null })}
                    />
                  </label>
                </>
              )}
              {f.quantityUnit && (
                <>
                  <label>
                    数量（{f.quantityUnit}）{' '}
                    <Input
                      aria-label={`${label}数量`}
                      style={{ width: 150 }}
                      value={current?.quantity ?? f.quantity ?? ''}
                      onChange={(e) => update({ quantity: e.target.value || null })}
                    />
                  </label>
                  <label>
                    单价{' '}
                    <Input
                      aria-label={`${label}单价`}
                      style={{ width: 150 }}
                      placeholder="按本币金额和数量计算"
                      value={current?.unitPrice ?? ''}
                      onChange={(e) => update({ unitPrice: e.target.value || null })}
                    />
                  </label>
                </>
              )}
              {f.enabledDimensions.map((dt) => (
                <label key={dt.id}>
                  {dt.name}{' '}
                  <DimensionSelect
                    aria-label={`${label}${dt.name}`}
                    type={dt.id}
                    style={{ width: 180 }}
                    value={(current?.dimensions ?? f.dimensions)[dt.id] ?? undefined}
                    allowClear
                    onChange={(id) =>
                      update({
                        dimensions: {
                          ...(current?.dimensions ?? f.dimensions),
                          [dt.id]: id ?? null,
                        },
                      })
                    }
                  />
                </label>
              ))}
            </Space>
          </Card>
        );
      })}
      <p>
        原币金额按币种单位填写，汇率为每单位外币折合本币。数量仅在票面单位与科目单位相同时自动合计；红字保留原方向并填写负金额、负数量。
      </p>
    </Card>
  );
}
