import ExcelJS from 'exceljs';
import { describe, expect, test } from 'vitest';
import {
  buildImportTemplate,
  buildSourceExport,
  IMPORT_COLUMNS,
  IMPORT_FILE_LIMITS,
  parseImportFile,
} from '../server/files';
import type { ImportPayload } from '../server/normalize';
import type { ImportReceipt } from '../shared';

function textFile(text: string, name = '科目.csv') {
  return { name, kind: 'accounts' as const, contentBase64: Buffer.from(text).toString('base64') };
}

async function workbookFile(build: (workbook: ExcelJS.Workbook) => void) {
  const workbook = new ExcelJS.Workbook();
  build(workbook);
  return {
    name: '合成迁移.xlsx',
    contentBase64: Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64'),
  };
}

describe('w_bb_saveas 数据导出文件读取', () => {
  test('四张模板可回读，包含文本编码列和完整表头', async () => {
    const template = await buildImportTemplate();
    const parsed = await parseImportFile(template);
    expect(parsed.issues).toEqual([]);
    expect(parsed.sheets.map((sheet) => sheet.kind)).toEqual([
      'accounts',
      'dimensions',
      'opening',
      'vouchers',
    ]);
    expect(parsed.sheets.every((sheet) => sheet.rows.length === 0)).toBe(true);
    for (const sheet of parsed.sheets) expect(sheet.headers).toEqual(IMPORT_COLUMNS[sheet.kind]);
    expect(parsed.sheets[0]!.headers).toEqual(
      expect.arrayContaining(['备抵科目', '余额性质', '结转用途', '往来科目']),
    );
    expect(parsed.sheets[1]!.headers.slice(6)).toEqual([
      '联系人',
      '电话',
      '地址',
      '邮编',
      '开户银行',
      '银行账号',
      '税号',
      '简称',
      '客供角色',
      '分类名称',
      '现金流量方向',
    ]);
    const workbook = new ExcelJS.Workbook();
    const bytes = Buffer.from(template.contentBase64, 'base64');
    await workbook.xlsx.load(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    expect(workbook.worksheets[0]!.getColumn(1).numFmt).toBe('@');
  });

  test('CSV 保留首零编码、中文、引号内逗号、双引号及跨行字段和实际行号', async () => {
    const parsed = await parseImportFile(
      textFile(
        '\uFEFF科目编码,科目名称\r\n0010,"现金,备用金"\r\n0011,"第一行\r\n第二行"\r\n0012,"""引号"""\r\n',
      ),
    );
    expect(parsed.issues).toEqual([]);
    expect(parsed.sheets[0]!.rows).toEqual([
      { row: 2, cells: ['0010', '现金,备用金'] },
      { row: 3, cells: ['0011', '第一行\n第二行'] },
      { row: 5, cells: ['0012', '"引号"'] },
    ]);
  });

  test('TSV 和分号文本自动识别分隔符，忽略真正空行但保留位置', async () => {
    const tsv = await parseImportFile(
      textFile('\n档案编码\t档案名称\n\n0001\t行政部\n', '档案.tsv'),
    );
    expect(tsv.issues).toEqual([]);
    expect(tsv.sheets[0]!.rows).toEqual([{ row: 4, cells: ['0001', '行政部'] }]);
    const txt = await parseImportFile(textFile('科目编码;科目名称\n1001;库存现金', '科目.txt'));
    expect(txt.issues).toEqual([]);
    expect(txt.sheets[0]!.rows[0]!.cells).toEqual(['1001', '库存现金']);
  });

  test('TXT 从首个非空逻辑行识别逗号和分号，不受空行和带引号换行影响', async () => {
    for (const delimiter of [',', ';']) {
      const parsed = await parseImportFile(
        textFile(
          `\r\n \t\r\n科目编码${delimiter}"科目\n名称"\r\n0010${delimiter}库存现金`,
          '科目.txt',
        ),
      );
      expect(parsed.issues).toEqual([]);
      expect(parsed.sheets[0]!.headers).toEqual(['科目编码', '科目\n名称']);
      expect(parsed.sheets[0]!.headerRow).toBe(3);
      expect(parsed.sheets[0]!.rows).toEqual([{ row: 5, cells: ['0010', '库存现金'] }]);
    }
  });

  test('UTF-16LE 和 UTF-16BE 的 BOM 自动识别，无 BOM 时按指定编码读取', async () => {
    const text = '档案编码\t档案名称\n0001\t行政部😀';
    for (const encoding of ['utf-16le', 'utf-16be'] as const) {
      const encoded = Buffer.from(text, 'utf16le');
      if (encoding === 'utf-16be') encoded.swap16();
      for (const withBom of [true, false]) {
        const bytes = withBom
          ? Buffer.concat([
              Buffer.from(encoding === 'utf-16le' ? [0xff, 0xfe] : [0xfe, 0xff]),
              encoded,
            ])
          : encoded;
        const parsed = await parseImportFile({
          name: '辅助档案.txt',
          kind: 'dimensions',
          contentBase64: bytes.toString('base64'),
          ...(withBom ? {} : { encoding }),
        });
        expect(parsed.issues).toEqual([]);
        expect(parsed.sheets[0]!.headers).toEqual(['档案编码', '档案名称']);
        expect(parsed.sheets[0]!.rows).toEqual([{ row: 2, cells: ['0001', '行政部😀'] }]);
      }
    }
    const utf8 = await parseImportFile({
      ...textFile(`\uFEFF科目编码,科目名称\n1001,库存现金`),
      encoding: 'utf-16be',
    });
    expect(utf8.issues).toEqual([]);
  });

  test('UTF-16 截断字节或孤立代理字符报编码错误，不静默替换字符', async () => {
    for (const bytes of [Buffer.from([0xff, 0xfe, 0x41]), Buffer.from([0xff, 0xfe, 0x00, 0xd8])]) {
      const parsed = await parseImportFile({
        name: '科目.txt',
        kind: 'accounts',
        contentBase64: bytes.toString('base64'),
      });
      expect(parsed.sheets).toEqual([]);
      expect(parsed.issues[0]!.message).toContain('文本编码不匹配');
    }
  });

  test('GB18030 明确选择，错误 UTF-8 不静默改写编码', async () => {
    // GB18030/GBK 的“编码,名称\n001,现金”。
    const bytes = Buffer.from('b1e0c2eb2cc3fbb3c60a3030312ccfd6bdf0', 'hex');
    const file = {
      name: '科目.csv',
      kind: 'accounts' as const,
      contentBase64: bytes.toString('base64'),
    };
    expect((await parseImportFile(file)).issues[0]!.message).toContain('文本编码不匹配');
    const parsed = await parseImportFile({ ...file, encoding: 'gb18030' });
    expect(parsed.issues).toEqual([]);
    expect(parsed.sheets[0]!.headers).toEqual(['编码', '名称']);
    expect(parsed.sheets[0]!.rows[0]!.cells).toEqual(['001', '现金']);
  });

  test('引号错误精确定位源行与列', async () => {
    const parsed = await parseImportFile(textFile('科目编码,科目名称\n1001,"现金\n'));
    expect(parsed.issues).toEqual([
      {
        sheet: '科目.csv',
        row: 2,
        column: 'B',
        severity: 'error',
        message: '双引号没有闭合',
      },
    ]);
    expect(parsed.sheets).toEqual([]);
  });

  test('重复表头、缺失表头及多余数据均报错', async () => {
    const parsed = await parseImportFile(textFile('编码,编码,\n1001,现金,多余'));
    expect(parsed.issues.map((item) => item.message)).toEqual([
      '列名“编码”重复',
      '数据超出表头范围，请补齐列名',
    ]);
    const middle = await parseImportFile(textFile('编码,,名称\n1001,,现金'));
    expect(middle.issues[0]).toMatchObject({ row: 1, column: 'B', message: '列名不能为空' });
  });

  test('工作簿保留日期和数字格式中的首零编码', async () => {
    const parsed = await parseImportFile(
      await workbookFile((workbook) => {
        const sheet = workbook.addWorksheet('凭证');
        sheet.addRow(['凭证日期', '科目编码', '借方金额']);
        sheet.addRow([new Date('2026-01-09T00:00:00.000Z'), 12, 1234.56]);
        sheet.getCell('A2').numFmt = 'yyyy-mm-dd';
        sheet.getCell('B2').numFmt = '000000';
      }),
    );
    expect(parsed.issues).toEqual([]);
    expect(parsed.sheets[0]!.rows).toEqual([
      { row: 2, cells: ['2026-01-09', '000012', '1234.56'] },
    ]);
  });

  test('英文多表名与单表指定类型', async () => {
    const file = await workbookFile((workbook) => {
      for (const name of ['accounts', 'dimensions', 'opening', 'vouchers']) {
        workbook.addWorksheet(name).addRow(['编码']);
      }
    });
    expect((await parseImportFile(file)).sheets.map((sheet) => sheet.kind)).toEqual([
      'accounts',
      'dimensions',
      'opening',
      'vouchers',
    ]);
    const single = await workbookFile((workbook) => {
      workbook.addWorksheet('Sheet1').addRow(['编码']);
    });
    expect((await parseImportFile(single)).issues[0]!.message).toContain('无法确定数据类型');
    expect((await parseImportFile({ ...single, kind: 'opening' })).sheets[0]!.kind).toBe('opening');
  });

  test('公式、错误值及合并单元格逐格报错，不使用公式缓存结果', async () => {
    const parsed = await parseImportFile(
      await workbookFile((workbook) => {
        const sheet = workbook.addWorksheet('凭证');
        sheet.addRow(['凭证日期', '科目编码', '借方金额', '贷方金额']);
        sheet.addRow(['2026-01-09', '1001', { formula: '1+1', result: 2 }, { error: '#VALUE!' }]);
        sheet.addRow(['2026-01-10', '1002', '合并内容']);
        sheet.mergeCells('C3:D3');
      }),
    );
    expect(parsed.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sheet: '凭证',
          row: 2,
          column: 'C',
          message: '不支持公式，请先粘贴为数值',
        }),
        expect.objectContaining({
          sheet: '凭证',
          row: 2,
          column: 'D',
          message: '单元格有计算错误，请修正后重试',
        }),
        expect.objectContaining({
          sheet: '凭证',
          row: 3,
          column: 'C',
          message: '不支持合并单元格，请取消合并并逐行补齐',
        }),
      ]),
    );
    expect(parsed.sheets[0]!.rows[0]!.cells[2]).toBe('');
  });

  test('文本公式报错，正负金额可以保留', async () => {
    const parsed = await parseImportFile(
      textFile('编码,金额\n1001,=1+1\n1002,+12.34\n1003,-12.34'),
    );
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0]).toMatchObject({
      row: 2,
      column: '金额',
      message: expect.stringContaining('不支持公式'),
    });
    expect(parsed.sheets[0]!.rows[1]!.cells[1]).toBe('+12.34');
    expect(parsed.sheets[0]!.rows[2]!.cells[1]).toBe('-12.34');
  });

  test('SQL Anywhere 备份、旧 XLS、损坏工作簿与损坏传输不伪称读取成功', async () => {
    for (const [name, message] of [
      ['旧账.bak', 'SQL Anywhere'],
      ['旧账.xls', '.xls'],
      ['旧账.xlsx', '完整的 Excel 工作簿'],
    ]) {
      const parsed = await parseImportFile({
        name: name!,
        contentBase64: Buffer.from('synthetic').toString('base64'),
      });
      expect(parsed.sheets).toEqual([]);
      expect(parsed.issues[0]!.message).toContain(message);
    }
    expect(
      (await parseImportFile({ name: '科目.csv', contentBase64: 'not base64!!', kind: 'accounts' }))
        .issues[0]!.message,
    ).toContain('传输不完整');
  });

  test('体积、列数和单元格长度都有上限', async () => {
    const tooLarge = await parseImportFile({
      name: '科目.csv',
      kind: 'accounts',
      contentBase64: 'A'.repeat(Math.ceil(IMPORT_FILE_LIMITS.bytes / 3) * 4 + 4),
    });
    expect(tooLarge.issues[0]!.message).toContain('8 MB');
    const tooWide = await parseImportFile(
      textFile(Array.from({ length: 65 }, (_, index) => `列${index}`).join(',')),
    );
    expect(tooWide.issues[0]).toMatchObject({ row: 1, column: 'BM' });
    const tooLong = await parseImportFile(textFile(`名称\n${'字'.repeat(4001)}`));
    expect(tooLong.issues[0]).toMatchObject({ row: 2, column: 'A', message: '单元格超过 4000 字' });
  });

  test('超过 Excel 精确位数的数字要求改文本，不能悄悄变更编码', async () => {
    const parsed = await parseImportFile(
      await workbookFile((workbook) => {
        const sheet = workbook.addWorksheet('科目');
        sheet.addRow(['科目编码', '科目名称']);
        sheet.addRow([1000000000000001, '长编码']);
      }),
    );
    expect(parsed.issues[0]).toMatchObject({
      row: 2,
      column: 'A',
      message: expect.stringContaining('精确位数'),
    });
  });
});

describe('迁移来源导出', () => {
  const payload = (): ImportPayload => ({
    rows: [
      {
        kind: 'vouchers',
        location: { file: '原始凭证.csv', sheet: '凭证', row: 5 },
        values: { code: '001001', debit: '12.34' },
        original: { 科目编码: '001001', 借方金额: '12.34', 未知列: '=1+1', 原制单人: '张会计' },
      },
    ],
    issues: [],
    files: [
      {
        name: '原始凭证.csv',
        sheets: [
          {
            name: '凭证',
            kind: 'vouchers',
            headers: ['科目编码', '借方金额', '未知列', '原制单人'],
            rowCount: 1,
          },
        ],
      },
    ],
  });
  async function readExport(file: { contentBase64: string }) {
    const workbook = new ExcelJS.Workbook();
    const bytes = Buffer.from(file.contentBase64, 'base64');
    await workbook.xlsx.load(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    return workbook;
  }

  test('原值含未知列和公式文字均按字符串回读，来源行与凭证对照完整', async () => {
    const source = payload();
    const receipt: ImportReceipt = {
      batchId: 'synthetic-batch',
      completedAt: '2026-01-09T00:00:00Z',
      summary: {
        accounts: 0,
        dimensions: 0,
        opening: 0,
        vouchers: 1,
        lines: 2,
        reusedAccounts: 0,
        reusedDimensions: 0,
      },
      vouchers: [
        {
          original: '202601/记/00012',
          id: 42,
          displayNo: '记-0001',
          location: source.rows[0]!.location,
        },
      ],
    };
    const exported = await buildSourceExport(source, receipt);
    const workbook = await readExport(exported);
    const sheet = workbook.worksheets[1]!;
    expect(sheet.getRow(1).values).toEqual([
      undefined,
      '科目编码',
      '借方金额',
      '未知列',
      '原制单人',
    ]);
    expect(sheet.getRow(5).values).toEqual([undefined, '001001', '12.34', '=1+1', '张会计']);
    expect(sheet.getCell('C5').type).toBe(ExcelJS.ValueType.String);
    expect(sheet.getCell('C5').numFmt).toBe('@');
    expect(sheet.getCell('C5').formula).toBeUndefined();
    expect(workbook.getWorksheet('来源目录')!.getRow(2).values).toEqual([
      undefined,
      sheet.name,
      '原始凭证.csv',
      '凭证',
      '凭证',
      '1',
    ]);
    expect(workbook.getWorksheet('凭证对照')!.getRow(2).values).toEqual([
      undefined,
      '202601/记/00012',
      '记-0001',
      '42',
      '原始凭证.csv',
      '凭证',
      '5',
    ]);
  });

  test('不同来源的长工作表名合法截短且不会重名，未导入时仍有空对照表', async () => {
    const source = payload();
    const longName = '这是很长的来源表名[]:*?/\\'.repeat(3);
    source.rows[0]!.location.sheet = longName;
    source.files[0]!.sheets[0]!.name = longName;
    source.files.push({
      name: '另一来源.xlsx',
      sheets: [
        {
          name: longName,
          kind: 'accounts',
          headers: ['科目编码', '科目名称'],
          rowCount: 1,
        },
      ],
    });
    source.rows.push({
      kind: 'accounts',
      location: { file: '另一来源.xlsx', sheet: longName, row: 2 },
      values: {},
      original: { 科目编码: '9999', 科目名称: '合成科目' },
    });
    const workbook = await readExport(await buildSourceExport(source, null));
    const names = workbook.worksheets.map((sheet) => sheet.name);
    expect(new Set(names).size).toBe(names.length);
    expect(
      names.every(
        (name) =>
          name.length <= 31 &&
          Array.from(name).every((character) => !'[]:*?/\\'.includes(character)),
      ),
    ).toBe(true);
    expect(workbook.getWorksheet('凭证对照')!.rowCount).toBe(1);
    expect(workbook.getWorksheet('来源目录')!.getCell('C2').value).toBe(longName);
    expect(workbook.getWorksheet('来源目录')!.getCell('B3').value).toBe('另一来源.xlsx');
    expect(workbook.worksheets[2]!.getCell('A2').value).toBe('9999');
  });
});
