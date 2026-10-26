import type { Row, Workbook, Worksheet } from 'exceljs';
import { parseMoney } from '@caiwu/core';
import { AccessorySchema, type CardInput } from '../shared';

export const openingHeaders = [
  '设备编号',
  '设备名称',
  '类别编码',
  '状态编码',
  '用途编码',
  '部门编码',
  '购置日期',
  '使用日期',
  '原值（元）',
  '残值率',
  '方法码',
  '使用年限（月）',
  '期初累计折旧（元）',
  '期初累计月数',
  '总工作量',
  '期初累计工作量',
  '规格型号',
  '单位',
  '数量',
  '少于30月已复核（是/否）',
  '预计残值（元，可空）',
  '参考编号',
];
export const accessoryHeaders = ['设备编号', '附属编号', '附属名称', '数量', '单价（元）', '说明'];
type Accessory = NonNullable<CardInput['accessories']>[number];
export type OpeningWorkbookCard = { values: string[]; accessories: Accessory[] };
type References = {
  masters: { id: number; kind: string; code: string }[];
  departments: { id: number; code: string }[];
};

export async function createOpeningWorkbook(cards: OpeningWorkbookCard[] = []) {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  const main = workbook.addWorksheet('期初卡片');
  const accessories = workbook.addWorksheet('附属设备');
  main.addRow(openingHeaders);
  accessories.addRow(accessoryHeaders);
  for (const card of cards) {
    main.addRow(card.values);
    for (const a of card.accessories)
      accessories.addRow([card.values[0], a.code, a.name, a.quantity, a.unitPrice, a.note ?? '']);
  }
  for (const sheet of [main, accessories]) {
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.columns.forEach((column) => {
      column.width = 24;
      column.numFmt = '@';
    });
  }
  return workbook;
}

function cellText(sheet: Worksheet, row: Row, column: number) {
  const cell = row.getCell(column);
  if (cell.formula || (cell.value && typeof cell.value === 'object' && 'error' in cell.value))
    throw new Error(`${sheet.name}第 ${row.number} 行第 ${column} 列含公式或错误，请粘贴为值`);
  if (
    typeof cell.value === 'number' &&
    Number.isSafeInteger(cell.value) &&
    cell.value >= 0 &&
    /^0{2,40}$/.test(cell.numFmt)
  )
    return String(cell.value).padStart(cell.numFmt.length, '0');
  return cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : cell.text.trim();
}

function requireHeaders(sheet: Worksheet, headers: string[]) {
  if (headers.some((h, i) => cellText(sheet, sheet.getRow(1), i + 1) !== h))
    throw new Error(`${sheet.name}列名不符，请使用本页 Excel 模板`);
  sheet.eachRow((row) => {
    row.eachCell((cell, column) => {
      if (column > headers.length && cell.text.trim())
        throw new Error(`${sheet.name}第 ${row.number} 行存在模板外数据，请核对后再导入`);
    });
  });
}

/** 保留旧的单工作表格式；子表按设备编号关联，任何无法关联的数据都拒绝整文件。 */
export function readOpeningWorkbook(workbook: Workbook, refs: References) {
  const main = workbook.worksheets[0];
  if (!main) throw new Error('工作簿没有工作表');
  requireHeaders(main, openingHeaders);
  for (const sheet of workbook.worksheets.slice(1))
    if (sheet.name !== '附属设备' && sheet.actualRowCount)
      throw new Error(`工作表「${sheet.name}」含未识别数据，请按模板整理，避免遗漏`);
  const rows: { row: number; data: CardInput }[] = [];
  const byCode = new Map<string, CardInput[]>();
  main.eachRow((row, index) => {
    if (index === 1) return;
    const v = (n: number) => cellText(main, row, n);
    if (!openingHeaders.some((_, i) => v(i + 1))) return;
    const mid = (kind: string, code: string) =>
      refs.masters.find((m) => m.kind === kind && m.code === code)?.id ?? 0;
    const data: CardInput = {
      code: v(1),
      name: v(2),
      categoryId: mid('category', v(3)),
      statusId: mid('status', v(4)),
      purposeId: mid('purpose', v(5)),
      departmentId: refs.departments.find((d) => d.code === v(6))?.id ?? 0,
      acquired: v(7),
      useDate: v(8),
      original: parseMoney(v(9)) ?? -1,
      rate: v(10),
      method: v(11) as CardInput['method'],
      lifeMonths: Number(v(12)),
      openingDepreciation: parseMoney(v(13) || '0') ?? -1,
      openingMonths: Number(v(14) || '0'),
      totalWork: v(15) || '0',
      openingWork: v(16) || '0',
      model: v(17),
      unit: v(18) || '台',
      quantity: v(19) || '1',
      confirmShortLife: v(20) === '是',
      residual: v(21) ? (parseMoney(v(21)) ?? -1) : undefined,
      reference: v(22),
      accessories: [],
    };
    rows.push({ row: index, data });
    byCode.set(data.code, [...(byCode.get(data.code) ?? []), data]);
  });
  if (!rows.length) throw new Error('期初卡片工作表没有数据');
  if (rows.length > 5000) throw new Error('每次最多导入 5000 张期初卡片，请分批处理');
  const accessoryRows: { row: number; assetCode: string; data: Accessory }[] = [];
  const accessorySheet = workbook.worksheets.slice(1).find((s) => s.name === '附属设备');
  if (accessorySheet) {
    requireHeaders(accessorySheet, accessoryHeaders);
    accessorySheet.eachRow((row, index) => {
      if (index === 1) return;
      const v = (n: number) => cellText(accessorySheet, row, n);
      if (!accessoryHeaders.some((_, i) => v(i + 1))) return;
      const parents = byCode.get(v(1));
      if (parents?.length !== 1)
        throw new Error(`附属设备第 ${index} 行：设备编号 ${v(1)} 必须在本文件期初卡片中唯一存在`);
      let data: Accessory;
      try {
        const parsed = AccessorySchema.safeParse({
          code: v(2),
          name: v(3),
          quantity: v(4),
          unitPrice: v(5),
          note: v(6),
        });
        if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('；'));
        data = parsed.data;
      } catch (error) {
        const message =
          error instanceof Error && !error.message.startsWith('[DecimalError]')
            ? error.message
            : '数量或单价格式错误，请填写十进制数';
        throw new Error(`附属设备第 ${index} 行：${message}`, { cause: error });
      }
      const parent = parents[0]!;
      if (parent.accessories!.some((a) => a.code === data.code))
        throw new Error(`附属设备第 ${index} 行：设备 ${parent.code} 的附属编号 ${data.code} 重复`);
      if (parent.accessories!.length >= 1000)
        throw new Error(`附属设备第 ${index} 行：每张卡片最多 1000 条附属设备`);
      parent.accessories!.push(data);
      accessoryRows.push({ row: index, assetCode: parent.code, data });
    });
  }
  return { rows, accessoryRows };
}
