import { Select, Space, type SelectProps } from 'antd';
import { useMemo } from 'react';
import { dimensionName, formatPeriod, type DimensionTypeId, type Period } from '@caiwu/core';
import { useDimensionItems, usePeriods } from '@caiwu/web-kit';

export interface DimensionSelectProps extends Omit<SelectProps<number>, 'options' | 'showSearch'> {
  type: DimensionTypeId;
  includeDisabled?: boolean;
  /** 只能选末级（默认 true） */
  leafOnly?: boolean;
}

/** 辅助核算项选择器（项目、客供、部门、个人、现金流量项目）。value 是维度项 id。 */
export function DimensionSelect({
  type,
  includeDisabled = false,
  leafOnly = true,
  ...rest
}: DimensionSelectProps) {
  const { items, loading } = useDimensionItems(type);
  const options = useMemo(
    () =>
      items
        .filter((i) => (includeDisabled || !i.disabled) && (!leafOnly || i.isLeaf))
        .map((i) => ({
          value: i.id,
          label: `${i.code} ${i.name}`,
          search: `${i.code} ${i.name} ${i.pinyin}`.toLowerCase(),
        })),
    [items, includeDisabled, leafOnly],
  );
  return (
    <Select<number>
      placeholder={`选择${dimensionName(type)}`}
      loading={loading}
      allowClear
      {...rest}
      options={options}
      showSearch={{
        filterOption: (input, option) =>
          (option as { search: string }).search.includes(input.trim().toLowerCase()),
      }}
    />
  );
}

export interface PeriodPickerProps extends Omit<SelectProps<Period>, 'options'> {
  /** 只能选未结账期间 */
  openOnly?: boolean;
}

/** 会计期间选择（yyyymm）。 */
export function PeriodPicker({ openOnly, ...rest }: PeriodPickerProps) {
  const { periods, loading } = usePeriods();
  const options = useMemo(
    () =>
      periods
        .filter((p) => !openOnly || p.status === 'open')
        .map((p) => ({
          value: p.period,
          label: `${formatPeriod(p.period)}${p.status === 'closed' ? '（已结账）' : ''}`,
        })),
    [periods, openOnly],
  );
  return (
    <Select<Period>
      placeholder="选择期间"
      loading={loading}
      style={{ minWidth: 150 }}
      {...rest}
      options={options}
    />
  );
}

export interface PeriodRange {
  from: Period;
  to: Period;
}

/** 期间范围：从 … 到 …；结束早于开始时自动对齐。 */
export function PeriodRangePicker({
  value,
  onChange,
}: {
  value?: PeriodRange | null;
  onChange?: (v: PeriodRange) => void;
}) {
  return (
    <Space.Compact>
      <PeriodPicker
        value={value?.from}
        onChange={(from) =>
          onChange?.({ from, to: value?.to && value.to >= from ? value.to : from })
        }
        aria-label="开始期间"
      />
      <PeriodPicker
        value={value?.to}
        onChange={(to) =>
          onChange?.({ from: value?.from && value.from <= to ? value.from : to, to })
        }
        aria-label="结束期间"
      />
    </Space.Compact>
  );
}
