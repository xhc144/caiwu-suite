import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createOpeningWorkbook, readOpeningWorkbook } from '../web/opening-workbook';

const refs = {
  masters: [
    { id: 1, kind: 'category', code: '01' },
    { id: 2, kind: 'status', code: '01' },
    { id: 3, kind: 'purpose', code: '01' },
  ],
  departments: [{ id: 4, code: '01' }],
};
const card = {
  values: [
    '0001',
    '历史设备',
    '01',
    '01',
    '01',
    '01',
    '2025-01-01',
    '2025-01-01',
    '6000.01',
    '0',
    '1',
    '60',
    '100.02',
    '1',
    '0',
    '0',
    '型号',
    '台',
    '1',
    '否',
    '',
    '000R',
  ],
  accessories: [
    { code: '000A', name: '精确配件', quantity: '0.1', unitPrice: '0.2', note: '保留说明' },
  ],
};

describe('w_xt_kgzb_zc / w_zcgl_kp_fssb：真实 XLSX 双表', () => {
  it('真实 XLSX 往返保留编号前零、整数分、十进制数量/单价、说明和归属', async () => {
    const original = await createOpeningWorkbook([card]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await original.xlsx.writeBuffer());
    expect(workbook.getWorksheet('期初卡片')!.getColumn(1).numFmt).toBe('@');
    expect(workbook.getWorksheet('附属设备')!.getColumn(1).numFmt).toBe('@');
    const parsed = readOpeningWorkbook(workbook, refs);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.data).toMatchObject({
      code: '0001',
      original: 600001,
      openingDepreciation: 10002,
      reference: '000R',
      categoryId: 1,
      statusId: 2,
      purposeId: 3,
      departmentId: 4,
      accessories: card.accessories,
    });
    expect(parsed.accessoryRows[0]).toMatchObject({
      row: 2,
      assetCode: '0001',
      data: card.accessories[0],
    });
  });

  it('旧版单表格式和空子表仍可读取，空白格式行不产生卡片', async () => {
    const workbook = await createOpeningWorkbook([{ ...card, accessories: [] }]);
    workbook.removeWorksheet('附属设备');
    workbook.worksheets[0]!.name = '数据';
    workbook.worksheets[0]!.getRow(20).getCell(1).value = '  ';
    const parsed = readOpeningWorkbook(workbook, refs);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.data.accessories).toEqual([]);
  });

  it('旧 Excel 的数字编号按补零显示格式恢复，主子表仍按完整编号匹配', async () => {
    const workbook = await createOpeningWorkbook([card]);
    const main = workbook.getWorksheet('期初卡片')!;
    main.getRow(2).getCell(1).value = 1;
    main.getRow(2).getCell(1).numFmt = '0000';
    main.getRow(2).getCell(3).value = 1;
    main.getRow(2).getCell(3).numFmt = '00';
    const accessory = workbook.getWorksheet('附属设备')!;
    accessory.getRow(2).getCell(1).value = 1;
    accessory.getRow(2).getCell(1).numFmt = '0000';
    accessory.getRow(2).getCell(2).value = 2;
    accessory.getRow(2).getCell(2).numFmt = '0000';
    const parsed = readOpeningWorkbook(workbook, refs);
    expect(parsed.rows[0]!.data).toMatchObject({ code: '0001', categoryId: 1 });
    expect(parsed.rows[0]!.data.accessories![0]!.code).toBe('0002');
  });

  it.each(['孤立设备', ''])('孤立或缺失设备编号「%s」拒绝整文件', async (code) => {
    const workbook = await createOpeningWorkbook([card]);
    workbook.getWorksheet('附属设备')!.getRow(2).getCell(1).value = code;
    expect(() => readOpeningWorkbook(workbook, refs)).toThrow(/附属设备第 2 行.*唯一存在/);
  });

  it('重复主卡片不能使附属设备归属含糊', async () => {
    const workbook = await createOpeningWorkbook([card, { ...card, accessories: [] }]);
    expect(() => readOpeningWorkbook(workbook, refs)).toThrow(/唯一存在/);
  });

  it('同卡附属编号重复拒绝，不同卡允许相同附属编号', async () => {
    const other = { ...card, values: ['0002', ...card.values.slice(1)] };
    const workbook = await createOpeningWorkbook([card, other]);
    expect(readOpeningWorkbook(workbook, refs).accessoryRows).toHaveLength(2);
    workbook.getWorksheet('附属设备')!.addRow(['0001', '000A', '重复', '1', '2', '']);
    expect(() => readOpeningWorkbook(workbook, refs)).toThrow(/第 4 行.*重复/);
  });

  it.each([
    [3, ''],
    [4, '-1'],
    [4, '0.0000001'],
    [5, '非法单价'],
  ] as const)('附属表第 %s 列非法值拒绝并指出工作表行', async (column, value) => {
    const workbook = await createOpeningWorkbook([card]);
    workbook.getWorksheet('附属设备')!.getRow(2).getCell(column).value = value;
    expect(() => readOpeningWorkbook(workbook, refs)).toThrow(/附属设备第 2 行/);
  });

  it.each(['期初卡片', '附属设备'])('%s 的公式缓存不能充当确定值', async (sheet) => {
    const workbook = await createOpeningWorkbook([card]);
    workbook
      .getWorksheet(sheet)!
      .getRow(2)
      .getCell(sheet === '期初卡片' ? 9 : 5).value = {
      formula: '1+1',
      result: 2,
    };
    expect(() => readOpeningWorkbook(workbook, refs)).toThrow(/第 2 行.*含公式或错误/);
  });

  it('不静默丢弃未知工作表、模板外列或损坏的子表标题', async () => {
    const workbook = await createOpeningWorkbook([card]);
    workbook.addWorksheet('未识别配件').addRow(['还有数据']);
    expect(() => readOpeningWorkbook(workbook, refs)).toThrow(/未识别配件.*未识别数据/);
    workbook.removeWorksheet('未识别配件');
    workbook.getWorksheet('附属设备')!.getRow(2).getCell(7).value = '不能丢失';
    expect(() => readOpeningWorkbook(workbook, refs)).toThrow(/模板外数据/);
    workbook.getWorksheet('附属设备')!.getRow(2).getCell(7).value = null;
    workbook.getWorksheet('附属设备')!.getRow(1).getCell(1).value = '错误标题';
    expect(() => readOpeningWorkbook(workbook, refs)).toThrow(/附属设备列名不符/);
  });

  it('空模板不能被当成可导入数据', async () => {
    expect(() => readOpeningWorkbook(new ExcelJS.Workbook(), refs)).toThrow(/没有工作表/);
    const workbook = await createOpeningWorkbook();
    expect(() => readOpeningWorkbook(workbook, refs)).toThrow(/没有数据/);
  });
});
