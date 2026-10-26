import { periodEndDate, periodOfDate, type Cents } from '@caiwu/core';

export type AssetEvent = {
  key: string;
  date: string;
  description: string;
  originalChange: Cents;
  depreciationChange: Cents;
  order: number;
};
export function buildAssetHistory(
  card: {
    id: number;
    acquired: string;
    is_opening: number;
    base_original: number;
    opening_depreciation: number;
    disposal_date: string | null;
  },
  startDate: string,
  adjustments: { id: number; date: string; before_value: number; after_value: number }[],
  lines: { period: number; amount: number }[],
): AssetEvent[] {
  const initialDate = card.is_opening
    ? startDate
    : card.acquired < startDate
      ? startDate
      : card.acquired;
  const events: AssetEvent[] = [
    {
      key: `${card.id}-initial`,
      date: initialDate,
      description: card.is_opening ? '期初资产' : '新增资产',
      originalChange: card.base_original,
      depreciationChange: card.opening_depreciation,
      order: 0,
    },
  ];
  for (const a of adjustments)
    events.push({
      key: `${card.id}-adjust-${a.id}`,
      date: a.date,
      description: '原值调整',
      originalChange: a.after_value - a.before_value,
      depreciationChange: 0,
      order: 1,
    });
  for (const [i, l] of lines.entries()) {
    const date =
      card.disposal_date && periodOfDate(card.disposal_date) === l.period
        ? card.disposal_date
        : periodEndDate(l.period);
    events.push({
      key: `${card.id}-depreciation-${i}`,
      date,
      description: '计提折旧',
      originalChange: 0,
      depreciationChange: l.amount,
      order: 2,
    });
  }
  events.sort(
    (a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.key.localeCompare(b.key),
  );
  if (card.disposal_date) {
    const disposalDate = card.disposal_date;
    const active = events.filter((e) => e.date <= disposalDate);
    events.push({
      key: `${card.id}-disposal`,
      date: card.disposal_date,
      description: '注销资产',
      originalChange: -active.reduce((s, e) => s + e.originalChange, 0),
      depreciationChange: -active.reduce((s, e) => s + e.depreciationChange, 0),
      order: 3,
    });
    events.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  }
  return events;
}

export function dueDate(useDate: string, months: number): string {
  const d = new Date(useDate + 'T00:00:00Z'),
    day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
