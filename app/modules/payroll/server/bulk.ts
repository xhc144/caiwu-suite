import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type { CoreServices } from '@caiwu/core/server';
import { BulkInputSchema, PasteInputSchema, type RowInput } from '../shared';
import { payrollService } from './service';
import { fail } from './engine';
import { quantityFromE6, quantityToE6 } from '../quantity';
type BulkInput = z.output<typeof BulkInputSchema>;
type PasteInput = z.output<typeof PasteInputSchema>;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const expires = () => Date.now() + 300000;
function tokenExpiry(token: string) {
  const parts = /^(\d+)\.([a-f0-9]{64})$/.exec(token);
  if (!parts) fail('PLAN_STALE', '批量修改预览已失效', '重新预览后确认');
  const value = Number(parts[1]);
  if (value < Date.now() || value > Date.now() + 300000)
    fail('PLAN_EXPIRED', '批量修改预览已过期', '重新预览后确认');
  return value;
}
async function load(svc: CoreServices, id: number, revision: number) {
  const s = payrollService(svc);
  await s.assertMutable(id, revision);
  const b = await s.batch(id);
  const c = await s.category(b.categoryId);
  if (c.revision !== b.category.revision)
    fail('STALE', '工资结构已更新', '重新打开工资并保存结构后再批量操作');
  return b;
}
export async function previewBulk(svc: CoreServices, input: BulkInput, expiresAt = expires()) {
  input = BulkInputSchema.parse(input);
  const b = await load(svc, input.id, input.revision);
  const field = b.category.fields.find(
    (f) => f.key === input.field && (f.kind === 'money' || f.kind === 'quantity') && !f.disabled,
  );
  if (!field) fail('BULK_FIELD', '统一置数只能选择启用的金额录入或数量录入栏目');
  if (
    (field.kind === 'money' && typeof input.value !== 'number') ||
    (field.kind === 'quantity' && typeof input.value !== 'string')
  )
    fail('BULK_UNIT', '金额与数量的输入单位不一致', '金额按元录入，数量按栏目单位录入');
  const value =
    typeof input.value === 'string' ? quantityFromE6(quantityToE6(input.value)) : input.value;
  const ids = new Set(input.employeeIds);
  if (
    ids.size !== input.employeeIds.length ||
    [...ids].some((id) => !b.rows.some((r) => r.employeeId === id))
  )
    fail('BULK_SCOPE', '置数范围含重复人员或其他批次人员', '重新勾选当前批次中的人员');
  const people = await payrollService(svc).employees();
  const preview = b.rows
    .filter((r) => ids.has(r.employeeId))
    .map((r) => ({
      employeeId: r.employeeId,
      employeeRevision: people.find((e) => e.id === r.employeeId)!.revision,
      code: people.find((e) => e.id === r.employeeId)!.code,
      name: people.find((e) => e.id === r.employeeId)!.name,
      field: field.name,
      kind: field.kind,
      unit: field.unit ?? '',
      before:
        (field.kind === 'quantity' ? r.quantities?.[input.field] : r.values[input.field]) ?? null,
      after:
        input.onlyEmpty &&
        (field.kind === 'quantity' ? r.quantities?.[input.field] : r.values[input.field]) !==
          undefined
          ? field.kind === 'quantity'
            ? r.quantities![input.field]!
            : r.values[input.field]!
          : value,
    }));
  return {
    hash: `${expiresAt}.${hash({ input, rows: b.rows, preview, expiresAt })}`,
    expiresAt,
    preview,
  };
}
export async function applyBulk(
  svc: CoreServices,
  input: BulkInput,
  expectedHash: string,
  confirmed: boolean,
) {
  if (!confirmed)
    fail('CONFIRM', '统一置数须确认预览范围', '核对所选人员和修改前后金额，取消不会修改数据');
  return svc.tx(async (t) => {
    const p = await previewBulk(t, input, tokenExpiry(expectedHash));
    if (p.hash !== expectedHash) fail('PLAN_STALE', '置数预览已失效', '重新预览后确认');
    const s = payrollService(t),
      b = await s.batch(input.id);
    const next = new Map(p.preview.map((r) => [r.employeeId, r.after]));
    const rows = b.rows.map((r) =>
      next.has(r.employeeId)
        ? typeof next.get(r.employeeId) === 'string'
          ? {
              ...r,
              quantities: { ...r.quantities, [input.field]: next.get(r.employeeId) as string },
            }
          : { ...r, values: { ...r.values, [input.field]: next.get(r.employeeId) as number } }
        : r,
    );
    const saved = await s.saveBatch({ ...b, categoryRevision: b.category.revision, rows });
    await t.log.write({
      action: 'payroll.salary.bulk',
      summary: `工资批次 ${b.id} 统一置数 ${next.size} 人`,
      targetType: 'payroll_batch',
      targetId: b.id,
    });
    return saved;
  });
}
export async function previewPaste(svc: CoreServices, input: PasteInput, expiresAt = expires()) {
  input = PasteInputSchema.parse(input);
  const b = await load(svc, input.id, input.revision),
    people = await payrollService(svc).employees();
  const keys = new Set(
    b.category.fields.filter((f) => f.kind === 'money' && !f.disabled).map((f) => f.key),
  );
  const quantityFields = new Map(
    b.category.fields.filter((f) => f.kind === 'quantity' && !f.disabled).map((f) => [f.key, f]),
  );
  const nextRows: RowInput[] = b.rows.map((r) => ({
    ...r,
    values: { ...r.values },
    ...(r.quantities ? { quantities: { ...r.quantities } } : {}),
  }));
  const seen = new Set<string>();
  const preview: {
    employeeId: number;
    employeeRevision: number;
    code: string;
    name: string;
    field: string;
    kind: 'money' | 'quantity';
    unit: string;
    before: number | string | null;
    after: number | string;
  }[] = [];
  for (const p of input.rows) {
    if (seen.has(p.code)) fail('PASTE_DUPLICATE', `粘贴编号 ${p.code} 重复`);
    seen.add(p.code);
    const person = people.find((e) => e.code === p.code),
      row = nextRows.find((r) => r.employeeId === person?.id);
    if (!person || !row)
      fail('PASTE_SCOPE', `编号 ${p.code} 不在本批次范围`, '先在工资批次添加该人员，再粘贴工资');
    for (const [key, value] of Object.entries(p.values)) {
      if (!keys.has(key)) fail('PASTE_FIELD', `栏目 ${key} 不是启用的金额录入项`);
      preview.push({
        employeeId: person.id,
        employeeRevision: person.revision,
        code: p.code,
        name: person.name,
        field: key,
        kind: 'money',
        unit: '元',
        before: row.values[key] ?? null,
        after: value,
      });
      row.values[key] = value;
    }
    for (const [key, value] of Object.entries(p.quantities ?? {})) {
      const field = quantityFields.get(key);
      if (!field) fail('PASTE_FIELD', `栏目 ${key} 不是启用的数量录入项`);
      const after = quantityFromE6(quantityToE6(value));
      preview.push({
        employeeId: person.id,
        employeeRevision: person.revision,
        code: p.code,
        name: person.name,
        field: key,
        kind: 'quantity',
        unit: field.unit ?? '',
        before: row.quantities?.[key] ?? null,
        after,
      });
      row.quantities = { ...row.quantities, [key]: after };
    }
  }
  if (!preview.length)
    fail('PASTE_EMPTY', '没有可粘贴的金额或数量单元格', '首行为编号及稳定变量，空单元格保留原值');
  // 编号可被 HR 修改，确认计划必须绑定解析后的稳定身份及实际待写结果。
  return {
    hash: `${expiresAt}.${hash({ input, rows: b.rows, preview, nextRows, expiresAt })}`,
    expiresAt,
    preview,
    rows: nextRows,
  };
}
export async function applyPaste(
  svc: CoreServices,
  input: PasteInput,
  expectedHash: string,
  confirmed: boolean,
) {
  if (!confirmed) fail('CONFIRM', '工资粘贴须确认预览', '核对人员和金额，取消不会修改工资');
  return svc.tx(async (t) => {
    const p = await previewPaste(t, input, tokenExpiry(expectedHash));
    if (p.hash !== expectedHash) fail('PLAN_STALE', '粘贴预览已失效', '重新粘贴并预览');
    const s = payrollService(t),
      b = await s.batch(input.id);
    return s.saveBatch({ ...b, categoryRevision: b.category.revision, rows: p.rows });
  });
}
