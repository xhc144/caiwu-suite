import Decimal from 'decimal.js';
import { QuantitySchema } from './shared';
import type { Batch, SalaryRow } from './shared';

/** 所有数量转换均在十进制中进行，落库前才转为安全整数。 */
export function quantityToE6(value: string): number {
  return new Decimal(QuantitySchema.parse(value)).mul(1000000).toNumber();
}
export function quantityFromE6(value: number): string {
  if (!Number.isSafeInteger(value)) throw new Error('数量存储值不是安全整数');
  return new Decimal(value).div(1000000).toFixed();
}
export function quantityText(value: string): string | null {
  const parsed = QuantitySchema.safeParse(value.normalize('NFKC').trim());
  return parsed.success ? quantityFromE6(quantityToE6(parsed.data)) : null;
}

type QuantityRow = {
  quantities?: Record<string, string>;
  calculatedQuantities?: Record<string, string>;
};
type StoredQuantityRow = {
  quantities_e6?: Record<string, number>;
  calculated_quantities_e6?: Record<string, number>;
};
function storedRow<T extends QuantityRow>(row: T) {
  const { quantities, calculatedQuantities, ...rest } = row;
  const e6 = (values: Record<string, string>) =>
    Object.fromEntries(Object.entries(values).map(([key, value]) => [key, quantityToE6(value)]));
  return {
    ...rest,
    ...(quantities ? { quantities_e6: e6(quantities) } : {}),
    ...(calculatedQuantities ? { calculated_quantities_e6: e6(calculatedQuantities) } : {}),
  };
}
function restoredRow<T extends QuantityRow>(row: T & StoredQuantityRow): T {
  const { quantities_e6, calculated_quantities_e6, ...rest } = row;
  const text = (values: Record<string, number>) =>
    Object.fromEntries(Object.entries(values).map(([key, value]) => [key, quantityFromE6(value)]));
  return {
    ...rest,
    ...(quantities_e6 ? { quantities: text(quantities_e6) } : {}),
    ...(calculated_quantities_e6 ? { calculatedQuantities: text(calculated_quantities_e6) } : {}),
  } as T;
}
export const encodeSalaryRow = (row: SalaryRow) => JSON.stringify(storedRow(row));
export const decodeSalaryRow = (json: string) =>
  restoredRow(JSON.parse(json) as SalaryRow & StoredQuantityRow);
export const encodeSalaryRows = (rows: SalaryRow[]) => JSON.stringify(rows.map(storedRow));
export const decodeSalaryRows = (json: string): SalaryRow[] =>
  (JSON.parse(json) as (SalaryRow & StoredQuantityRow)[]).map((row) => restoredRow(row));
/** 更正审计也保持同一数量存储格式；返回给页面时才还原原单位字符串。 */
export const encodeBatches = (batches: Batch[]) =>
  JSON.stringify(
    batches.map((batch) => ({
      ...batch,
      rows: batch.rows.map(storedRow),
      snapshots: batch.snapshots.map(storedRow),
      previous: batch.previous.map(storedRow),
    })),
  );
export const decodeBatches = (json: string): Batch[] =>
  (JSON.parse(json) as Batch[]).map((batch) => ({
    ...batch,
    rows: batch.rows.map((row) => restoredRow(row)),
    snapshots: batch.snapshots.map((row) => restoredRow(row)),
    previous: batch.previous.map((row) => restoredRow(row)),
  }));
