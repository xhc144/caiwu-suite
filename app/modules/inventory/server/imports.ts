import { createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { BusinessError, sumCents, zId } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import { DocumentSchema, OpeningSchema, ProductSchema } from '../shared';
import { requireImportKeys } from '../excel';
import { openingValue } from '../opening';
import { fail, inventoryService } from './service';
const key = randomBytes(32);
export const ImportSchema = z.object({
  kind: z.enum(['products', 'opening', 'document']),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(1000),
  rowNumbers: z.array(z.number().int().min(2)).max(1000).optional(),
  warehouseId: zId.optional(),
  revision: z.number().int().nonnegative().optional(),
  document: DocumentSchema.optional(),
  overwrite: z.boolean().default(false),
  confirmation: z.string().optional(),
});
function errorText(e: unknown) {
  return e instanceof BusinessError
    ? e.data.message
    : e instanceof z.ZodError
      ? e.issues.map((i) => i.message).join('；')
      : e instanceof Error
        ? e.message
        : '数据错误';
}
export async function importInventory(
  svc: CoreServices,
  raw: z.input<typeof ImportSchema>,
  commit = false,
) {
  return svc.tx(async (t) => {
    const v = ImportSchema.parse(raw),
      s = inventoryService(t);
    t.permissions.require('inventory.edit');
    t.permissions.require('inventory.import');
    const products = await s.products();
    const seen = new Set<string>();
    const rows = [];
    const errors: { row: number; message: string }[] = [];
    const productInputs = [];
    let amounts: { netCents: number; taxCents: number; grossCents: number } | null = null;
    if (v.rowNumbers && v.rowNumbers.length !== v.rows.length)
      fail('IMPORT', 'Excel 行号与数据行数不一致，请重新读取文件');
    for (const [i, row] of v.rows.entries()) {
      try {
        if (v.kind === 'document') continue;
        requireImportKeys(v.kind, row);
        if (v.kind === 'products') {
          const code = String(row.code ?? '').trim();
          if (seen.has(code)) fail('DUPLICATE', `产品 ${code} 在导入文件中重复`);
          seen.add(code);
          const old = products.find((p) => p.code === code);
          if (old && !v.overwrite)
            fail('REPLACE', `产品 ${code} 已存在`, '勾选覆盖已有产品并再次预览');
          const resolveAccount = async (
            key: 'inventoryAccountCode' | 'salesAccountCode',
            fallback: number | null | undefined,
          ) => {
            if (row[key] === undefined) return fallback ?? null;
            const code = String(row[key]).trim();
            return code ? (await t.accounts.require(code)).id : null;
          };
          const input = ProductSchema.parse({
            ...old,
            ...row,
            inventoryAccountId: await resolveAccount(
              'inventoryAccountCode',
              (row.inventoryAccountId ?? old?.inventoryAccountId) as number | null | undefined,
            ),
            salesAccountId: await resolveAccount(
              'salesAccountCode',
              (row.salesAccountId ?? old?.salesAccountId) as number | null | undefined,
            ),
            id: old?.id,
            revision: old?.revision,
          });
          await s.checkProduct(input);
          productInputs.push(input);
          rows.push({ ...input, result: old ? '覆盖' : '新增' });
        } else {
          const r = OpeningSchema.shape.rows.element.parse(row);
          if (seen.has(r.productCode)) fail('DUPLICATE', `产品 ${r.productCode} 在文件中重复`);
          seen.add(r.productCode);
          const product = await s.product(r.productCode, i + 1);
          if (product.disabled) fail('DISABLED', `产品 ${product.code} 已停用`);
          openingValue(r);
          rows.push(r);
        }
      } catch (e) {
        errors.push({ row: v.rowNumbers?.[i] ?? i + 2, message: errorText(e) });
      }
    }
    if (v.kind === 'opening') {
      if (!v.warehouseId) fail('WAREHOUSE', '请选择导入期初的仓库');
      await s.openingUnlocked();
      const old = await s.opening(v.warehouseId);
      if (old.revision !== v.revision) fail('REVISION', '期初已变化，请重新预览');
      if (old.rows.length && !v.overwrite)
        errors.push({ row: 0, message: '已有期初数据，需明确确认覆盖完整仓库期初' });
      if (!errors.length) {
        const total = sumCents(
          rows.map((r) => openingValue(OpeningSchema.shape.rows.element.parse(r)).amountCents),
        );
        amounts = { netCents: total, taxCents: 0, grossCents: total };
      }
    }
    if (v.kind === 'document') {
      if (!v.document) fail('DOCUMENT', '请先填写单据头');
      // Document rows retain their own prices, tax basis and notes.
      rows.length = 0;
      errors.length = 0;
      for (const [i, r] of v.rows.entries()) {
        try {
          requireImportKeys('document', r);
          const line = DocumentSchema.shape.lines.element
            .extend({ priceIncludesTax: z.boolean() })
            .strict()
            .parse(r);
          await s.product(line.productCode, i + 1);
          rows.push(line);
        } catch (e) {
          errors.push({ row: v.rowNumbers?.[i] ?? i + 2, message: errorText(e) });
        }
      }
      if (v.document.id && !v.overwrite)
        errors.push({ row: 0, message: '当前单据已有明细，请明确确认覆盖全部原明细' });
      if (!errors.length)
        try {
          const preview = await s.previewDocument({
            ...v.document,
            lines: rows.map((r) => DocumentSchema.shape.lines.element.parse(r)),
          });
          amounts = {
            netCents: preview.netCents,
            taxCents: preview.taxCents,
            grossCents: preview.grossCents,
          };
        } catch (e) {
          errors.push({ row: 0, message: errorText(e) });
        }
    }
    const { confirmation: _c, ...payload } = v;
    const confirmation = createHmac('sha256', key)
      .update(
        JSON.stringify({
          payload,
          products,
          warehouses: await s.warehouses(),
          context: await s.context(),
          user: t.user.id,
        }),
      )
      .digest('hex');
    if (commit) {
      if (errors.length) fail('IMPORT', '导入存在逐行错误，未保存任何数据', '修正后重新预览');
      if (v.confirmation !== confirmation)
        fail('IMPORT_VERSION', '导入预览已过期或数据版本发生变化', '重新预览并确认保存');
      if (v.kind === 'products') for (const p of productInputs) await s.saveProduct(p);
      if (v.kind === 'opening')
        await s.saveOpening({
          warehouseId: v.warehouseId!,
          revision: v.revision!,
          rows: rows.map((r) => OpeningSchema.shape.rows.element.parse(r)),
          confirmReplace: v.overwrite,
        });
      if (v.kind === 'document')
        await s.saveDocument({
          ...v.document!,
          lines: rows.map((r) => DocumentSchema.shape.lines.element.parse(r)),
        });
      await t.log.write({
        action: 'inventory.import',
        summary: `导入 ${rows.length} 行${v.kind === 'products' ? '产品' : v.kind === 'opening' ? '期初' : '单据明细'}`,
      });
    }
    return { rows, errors, amounts, confirmation, saved: commit };
  });
}
