import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import { describe, expect, test, vi } from 'vitest';
import { createTestApp, type TestApp } from '@caiwu/testkit';
import server from '../server';
import { parseImportFile } from '../server/files';
import { validateWorkbookZip } from '../server/workbook-zip';
import type { ImportTables } from '../server/migrations';

type Entry = {
  name: string;
  data: string | Buffer;
  method?: 0 | 8;
  localName?: string;
  declaredSize?: number;
  localDeclaredSize?: number;
  crc?: number;
  localCrc?: number;
  descriptor?: 'signed' | 'unsigned';
  descriptorSize?: number;
  compressedSuffix?: Buffer;
  compressedOverride?: Buffer;
  centralExtra?: Buffer;
  localExtra?: Buffer;
};

/** All entries are small synthetic data; never use this helper on source books. */
function zip(entries: Entry[]) {
  const locals: Buffer[] = [],
    directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const method = entry.method ?? 8;
    const compressed = Buffer.concat([
      entry.compressedOverride ?? (method === 8 ? deflateRawSync(data) : data),
      entry.compressedSuffix ?? Buffer.alloc(0),
    ]);
    const name = Buffer.from(entry.name),
      localName = Buffer.from(entry.localName ?? entry.name);
    const centralExtra = entry.centralExtra ?? Buffer.alloc(0),
      localExtra = entry.localExtra ?? Buffer.alloc(0);
    const size = entry.declaredSize ?? data.length,
      checksum = entry.crc ?? crc32(data);
    const flags = 0x800 | (entry.descriptor ? 8 : 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(entry.localCrc ?? (entry.descriptor ? 0 : checksum), 14);
    local.writeUInt32LE(entry.descriptor ? 0 : compressed.length, 18);
    local.writeUInt32LE(entry.localDeclaredSize ?? (entry.descriptor ? 0 : size), 22);
    local.writeUInt16LE(localName.length, 26);
    local.writeUInt16LE(localExtra.length, 28);
    const descriptor = Buffer.alloc(entry.descriptor === 'signed' ? 16 : entry.descriptor ? 12 : 0);
    if (entry.descriptor) {
      const base = entry.descriptor === 'signed' ? 4 : 0;
      if (base) descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(checksum, base);
      descriptor.writeUInt32LE(compressed.length, base + 4);
      descriptor.writeUInt32LE(entry.descriptorSize ?? size, base + 8);
    }
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(centralExtra.length, 30);
    central.writeUInt32LE(offset, 42);
    const record = Buffer.concat([local, localName, localExtra, compressed, descriptor]);
    locals.push(record);
    directory.push(Buffer.concat([central, name, centralExtra]));
    offset += record.length;
  }
  const central = Buffer.concat(directory),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

function centralOffsets(bytes: Buffer) {
  const end = bytes.length - 22,
    count = bytes.readUInt16LE(end + 10);
  let cursor = bytes.readUInt32LE(end + 16);
  const offsets: number[] = [];
  for (let index = 0; index < count; index++) {
    offsets.push(cursor);
    cursor +=
      46 +
      bytes.readUInt16LE(cursor + 28) +
      bytes.readUInt16LE(cursor + 30) +
      bytes.readUInt16LE(cursor + 32);
  }
  return offsets;
}

/** Unpack only our freshly generated, bounded, trusted synthetic workbook. */
function workbookEntries(bytes: Buffer): Entry[] {
  return centralOffsets(bytes).map((central) => {
    const name = bytes
      .subarray(central + 46, central + 46 + bytes.readUInt16LE(central + 28))
      .toString();
    const local = bytes.readUInt32LE(central + 42);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const compressed = bytes.subarray(start, start + bytes.readUInt32LE(central + 20));
    return {
      name,
      data: bytes.readUInt16LE(central + 10) === 8 ? inflateRawSync(compressed) : compressed,
    };
  });
}

async function amountWorkbook(amount: string | number) {
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet('凭证');
  sheet.addRow(['凭证日期', '凭证字', '凭证号', '摘要', '科目编码', '借方金额', '贷方金额']);
  sheet.addRow(['2026-01-03', '记', 1, '合成借方', '1601', amount, 0]);
  sheet.addRow(['2026-01-03', '记', 1, '合成贷方', '4001', 0, amount]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function unsafeNumericWorkbook() {
  const exact = '90071992547409.91';
  const entries = workbookEntries(await amountWorkbook(1));
  const sheet = entries.find((entry) => entry.name === 'xl/worksheets/sheet1.xml')!;
  let xml = String(sheet.data);
  for (const address of ['F2', 'G3']) {
    const cell = new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*>[\\s\\S]*?<\\/c>`);
    expect(xml.match(cell)?.[0]).toContain('<v>1</v>');
    xml = xml.replace(cell, (value) => value.replace('<v>1</v>', `<v>${exact}</v>`));
  }
  expect(xml.split(exact)).toHaveLength(3);
  sheet.data = xml;
  return zip(entries);
}

async function coreSnapshot(app: TestApp) {
  return {
    accounts: await app.svc.db.selectFrom('account').selectAll().orderBy('id').execute(),
    dimensions: await app.svc.db.selectFrom('dimension_item').selectAll().orderBy('id').execute(),
    opening: await app.svc.db.selectFrom('opening_balance').selectAll().orderBy('id').execute(),
    vouchers: await app.svc.db.selectFrom('voucher').selectAll().orderBy('id').execute(),
    lines: await app.svc.db.selectFrom('voucher_line').selectAll().orderBy('id').execute(),
    logs: await app.svc.db.selectFrom('operation_log').selectAll().orderBy('id').execute(),
  };
}

describe('w_bb_saveas ZIP实际解压限额与结构检查', () => {
  test('存储及deflate条目按实际总字节恰好到边界可通过，超一字节拒绝', async () => {
    const bytes = zip([
      { name: 'first.bin', data: 'abcd', method: 0 },
      { name: 'second.bin', data: 'efgh' },
    ]);
    await expect(validateWorkbookZip(bytes, 8)).resolves.toBeUndefined();
    await expect(validateWorkbookZip(bytes, 7)).rejects.toThrow();
  });

  test('中央和本地展开尺寸同时伪报很小也不能绕过真实解压计量', async () => {
    const bytes = zip([
      { name: 'payload.bin', data: Buffer.alloc(128 * 1024, 65), declaredSize: 1 },
    ]);
    expect(bytes.length).toBeLessThan(1024);
    await expect(validateWorkbookZip(bytes, 64)).rejects.toThrow('实际解压大小超过限制');
  });

  test('假小尺寸文件在ExcelJS读取前拒绝，不调用工作簿解析器', async () => {
    const getter = vi.spyOn(ExcelJS.Workbook.prototype, 'xlsx', 'get');
    try {
      const bytes = zip([
        { name: 'xl/worksheets/sheet1.xml', data: Buffer.alloc(128 * 1024, 65), declaredSize: 1 },
      ]);
      const parsed = await parseImportFile({
        name: '假小尺寸.xlsx',
        contentBase64: bytes.toString('base64'),
      });
      expect(parsed.sheets).toEqual([]);
      expect(parsed.issues.some((issue) => issue.severity === 'error')).toBe(true);
      expect(parsed.issues[0]!.message).toContain('实际解压大小超过声明值');
      expect(getter).not.toHaveBeenCalled();
    } finally {
      getter.mockRestore();
    }
  });

  test.each(['same.bin', 'xl/../same.bin', '/same.bin', 'xl\\same.bin'])(
    '重复或不规范路径%s拒绝',
    async (name) => {
      const entries =
        name === 'same.bin'
          ? [
              { name, data: 'a' },
              { name, data: 'b' },
            ]
          : [{ name, data: 'a' }];
      await expect(validateWorkbookZip(zip(entries))).rejects.toThrow();
    },
  );

  test('本地条目名与中央目录不同拒绝，不能让预检与ExcelJS指向不同数据', async () => {
    await expect(
      validateWorkbookZip(zip([{ name: 'first.bin', localName: 'other.bin', data: 'abc' }])),
    ).rejects.toThrow();
  });

  test('两个中央条目指向同一本地记录拒绝', async () => {
    const bytes = zip([
      { name: 'first.bin', data: 'abc' },
      { name: 'other.bin', data: 'def' },
    ]);
    bytes.writeUInt32LE(0, centralOffsets(bytes)[1]! + 42);
    await expect(validateWorkbookZip(bytes)).rejects.toThrow();
  });

  test('CRC损坏即使两处声明一致也拒绝', async () => {
    const data = Buffer.from('合成正文');
    await expect(
      validateWorkbookZip(zip([{ name: 'data.bin', data, crc: (crc32(data) ^ 1) >>> 0 }])),
    ).rejects.toThrow();
  });

  test('本地与中央声明尺寸不一致拒绝', async () => {
    await expect(
      validateWorkbookZip(zip([{ name: 'data.bin', data: 'abc', localDeclaredSize: 2 }])),
    ).rejects.toThrow();
  });

  test('两处均夸大展开尺寸时也按实际产出拒绝，不能只校验头部一致', async () => {
    await expect(
      validateWorkbookZip(zip([{ name: 'data.bin', data: 'abc', declaredSize: 4 }])),
    ).rejects.toThrow('实际解压大小与声明不一致');
  });

  test('大小写及Unicode等价名称不允许重解释为重复条目', async () => {
    for (const names of [
      ['DATA.bin', 'data.bin'],
      ['caf\u00e9.bin', 'cafe\u0301.bin'],
    ])
      await expect(
        validateWorkbookZip(zip(names.map((name) => ({ name, data: 'abc' })))),
      ).rejects.toThrow('重复或冲突');
  });

  test('存储法实际长度与展开声明不符也拒绝', async () => {
    await expect(
      validateWorkbookZip(zip([{ name: 'data.bin', data: 'abc', method: 0, declaredSize: 1 }])),
    ).rejects.toThrow();
  });

  test.each(['signed', 'unsigned'] as const)(
    '正确%s数据描述符可通过，错误尺寸拒绝',
    async (descriptor) => {
      await expect(
        validateWorkbookZip(zip([{ name: 'data.bin', data: 'abc', descriptor }])),
      ).resolves.toBeUndefined();
      await expect(
        validateWorkbookZip(
          zip([{ name: 'data.bin', data: 'abc', descriptor, descriptorSize: 2 }]),
        ),
      ).rejects.toThrow();
    },
  );

  test('截断deflate流及压缩结束后夹带数据拒绝', async () => {
    const data = Buffer.from('小型合成解压数据'.repeat(10)),
      compressed = deflateRawSync(data);
    await expect(
      validateWorkbookZip(
        zip([
          {
            name: 'data.bin',
            data,
            compressedOverride: compressed.subarray(0, compressed.length - 1),
          },
        ]),
      ),
    ).rejects.toThrow();
    await expect(
      validateWorkbookZip(
        zip([{ name: 'data.bin', data, compressedSuffix: Buffer.from([1, 2, 3]) }]),
      ),
    ).rejects.toThrow();
  });

  test('ZIP64与替代Unicode路径扩展不能改变目录解释', async () => {
    for (const id of [0x0001, 0x7075]) {
      const extra = Buffer.alloc(5);
      extra.writeUInt16LE(id, 0);
      extra.writeUInt16LE(1, 2);
      await expect(
        validateWorkbookZip(zip([{ name: 'data.bin', data: 'abc', centralExtra: extra }])),
      ).rejects.toThrow();
    }
  });

  test('多卷目录及目录外尾随内容拒绝', async () => {
    const bytes = zip([{ name: 'data.bin', data: 'abc' }]);
    const multi = Buffer.from(bytes);
    multi.writeUInt16LE(1, multi.length - 22 + 4);
    await expect(validateWorkbookZip(multi)).rejects.toThrow();
    await expect(
      validateWorkbookZip(Buffer.concat([bytes, Buffer.from('extra')])),
    ).rejects.toThrow();
  });

  test('正常ExcelJS生成的工作簿通过新守卫且能完整解析', async () => {
    const bytes = await amountWorkbook('123.45');
    await expect(validateWorkbookZip(bytes)).resolves.toBeUndefined();
    const parsed = await parseImportFile({
      name: '正常合成.xlsx',
      contentBase64: bytes.toString('base64'),
    });
    expect(parsed.issues).toEqual([]);
    expect(parsed.sheets[0]!.rows).toHaveLength(2);
    expect(parsed.sheets[0]!.rows[0]!.cells[5]).toBe('123.45');
  });
});

describe('w_pz_get numeric XML不得在parseFloat后静默损失一分', () => {
  const exact = '90071992547409.91';
  test('其他属性中的伪造t值不能让numeric单元格逃过源精度检查', async () => {
    await expect(
      validateWorkbookZip(
        zip([
          {
            name: 'xl/worksheets/sheet1.xml',
            data: `<worksheet><sheetData><row><c foo=" t='s'" r="F2" t="n"><v>${exact}</v></c></row></sheetData></worksheet>`,
          },
        ]),
      ),
    ).rejects.toThrow('精确位数');
  });

  test('嵌套c不能重置外部单元格类型后隐藏高精度v', async () => {
    await expect(
      validateWorkbookZip(
        zip([
          {
            name: 'xl/worksheets/sheet1.xml',
            data: `<worksheet><sheetData><row><c r="F2" t="n"><c r="A1" t="s"></c><v>${exact}</v></c></row></sheetData></worksheet>`,
          },
        ]),
      ),
    ).rejects.toThrow(/嵌套|标记/);
  });

  test.each([
    '<v>90071992547409.</v><v>91</v>',
    '<t>90071992547409.</t><v>91</v>',
    '<v><![CDATA[1.23]]></v>',
  ])('拒绝会被ExcelJS拼接或遗漏的numeric子结构：%s', async (inner) => {
    await expect(
      validateWorkbookZip(
        zip([
          {
            name: 'xl/worksheets/sheet1.xml',
            data: `<worksheet><sheetData><row><c r="F2" t="n">${inner}</c></row></sheetData></worksheet>`,
          },
        ]),
      ),
    ).rejects.toThrow();
  });

  test.each([
    '90071992547409.&#57;1',
    '90071992547409.9<!--合成注释-->1',
    '<![CDATA[90071992547409.91]]>',
    '1.00000000000000001',
  ])('数字实体、注释或CDATA不掩盖原始数字精度：%s', async (value) => {
    await expect(
      validateWorkbookZip(
        zip([
          {
            name: 'xl/worksheets/sheet1.xml',
            data: `<worksheet><sheetData><row><c r="F2"><v>${value}</v></c></row></sheetData></worksheet>`,
          },
        ]),
      ),
    ).rejects.toThrow('精确位数');
  });

  test('UTF8及XML标记跨16KiB块时仍正确检查数字，文本字面量保持文本', async () => {
    const padding = '<!--' + '汉'.repeat(5460) + '-->';
    for (const [value, valid] of [
      ['1.23', true],
      [exact, false],
    ] as const) {
      const bytes = zip([
        {
          name: 'xl/worksheets/sheet1.xml',
          data: `<worksheet>${padding}<sheetData><row><c r="F2"><v>${value}</v></c></row></sheetData></worksheet>`,
        },
      ]);
      if (valid) await expect(validateWorkbookZip(bytes)).resolves.toBeUndefined();
      else await expect(validateWorkbookZip(bytes)).rejects.toThrow('精确位数');
    }
    await expect(
      validateWorkbookZip(
        zip([
          {
            name: 'xl/worksheets/sheet1.xml',
            data: `<worksheet><sheetData><row><c r="F2" t="inlineStr"><is><t>${exact}</t></is></c></row></sheetData></worksheet>`,
          },
        ]),
      ),
    ).resolves.toBeUndefined();
  });
  test('借贷两边同样丢分仍会平衡的numeric XML必须在预检拒绝', async () => {
    expect(String(Number(exact))).toBe('90071992547409.9');
    const entries = workbookEntries(await amountWorkbook(1));
    const sheet = entries.find((entry) => entry.name === 'xl/worksheets/sheet1.xml')!;
    let xml = String(sheet.data);
    for (const address of ['F2', 'G3']) {
      const cell = new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*>[\\s\\S]*?<\\/c>`);
      expect(xml.match(cell)?.[0]).toContain('<v>1</v>');
      xml = xml.replace(cell, (value) => value.replace('<v>1</v>', `<v>${exact}</v>`));
    }
    expect(xml.split(exact)).toHaveLength(3);
    sheet.data = xml;
    const file = { name: '两边同错仍平衡.xlsx', contentBase64: zip(entries).toString('base64') };
    const app = await createTestApp({ modules: [server] });
    try {
      const api = app.call(server),
        prepared = await api.prepare({ name: '精度反例', files: [file] });
      const checked = await api.preflight({ id: prepared.id });
      expect(checked.status).toBe('failed');
      expect(checked.issues.some((issue) => /精确|精度|文本/.test(issue.message))).toBe(true);
      expect((await app.svc.vouchers.list({})).total).toBe(0);
    } finally {
      await app.close();
    }
  });

  test('同金额明确保存为文本时仍可精确导入最大安全整数分', async () => {
    const bytes = await amountWorkbook(exact);
    const app = await createTestApp({ modules: [server] });
    try {
      const api = app.call(server);
      const prepared = await api.prepare({
        name: '精确文本对照',
        files: [{ name: '文本金额.xlsx', contentBase64: bytes.toString('base64') }],
      });
      const checked = await api.preflight({ id: prepared.id });
      expect(checked.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
      const done = await api.commit({
        id: checked.id,
        revision: checked.revision,
        confirmed: true,
      });
      const voucher = await app.svc.vouchers.get(done.receipt!.vouchers[0]!.id);
      expect(voucher).toMatchObject({
        debitTotal: 9007199254740991,
        creditTotal: 9007199254740991,
      });
    } finally {
      await app.close();
    }
  });
});

describe('w_bb_saveas 小XML不能触发ExcelJS大范围展开', () => {
  test('ExcelJS会读取的worksheet后缀别名也必须经过源数字检查', async () => {
    await expect(
      validateWorkbookZip(
        zip([
          {
            name: 'xl/worksheets/sheet1.xml.extra',
            data: '<worksheet><sheetData><row r="1"><c r="A1"><v>90071992547409.91</v></c></row></sheetData></worksheet>',
          },
        ]),
      ),
    ).rejects.toThrow('精确位数');
  });

  test.each([
    [
      '超大行号',
      'xl/worksheets/sheet1.xml',
      '<worksheet><sheetData><row r="50005"/></sheetData></worksheet>',
    ],
    [
      '超大单元格行号',
      'xl/worksheets/sheet1.xml',
      '<worksheet><sheetData><row r="1"><c r="A50005"><v>1</v></c></row></sheetData></worksheet>',
    ],
    [
      '超大单元格列号',
      'xl/worksheets/sheet1.xml',
      '<worksheet><sheetData><row r="1"><c r="BM1"><v>1</v></c></row></sheetData></worksheet>',
    ],
    [
      '列定义巨量展开',
      'xl/worksheets/sheet1.xml',
      '<worksheet><cols><col min="1" max="4294967295" width="10"/></cols></worksheet>',
    ],
    [
      '合并范围巨量展开',
      'xl/worksheets/sheet1.xml',
      '<worksheet><mergeCells><mergeCell ref="A1:XFD1048576"/></mergeCells></worksheet>',
    ],
    [
      '数据验证巨量范围',
      'xl/worksheets/sheet1.xml',
      '<worksheet><dataValidations><dataValidation type="whole" sqref="A1:XFD1048576"><formula1>1</formula1></dataValidation></dataValidations></worksheet>',
    ],
    [
      '定义名巨量范围',
      'xl/workbook.xml',
      '<workbook><definedNames><definedName name="SyntheticHugeRange">Sheet1!$A$1:$XFD$1048576</definedName></definedNames></workbook>',
    ],
    [
      '合并单项面积超限',
      'xl/worksheets/sheet1.xml',
      '<worksheet><mergeCells><mergeCell ref="A1:BL65"/></mergeCells></worksheet>',
    ],
  ])('%s在ExcelJS前由受限预扫描拒绝', async (_label, name, data) => {
    expect(Buffer.byteLength(data)).toBeLessThan(512);
    await expect(validateWorkbookZip(zip([{ name, data }]))).rejects.toThrow();
  });

  test('小范围列定义、合并及验证能通过守卫，保持既有逐格错误处理', async () => {
    const data =
      '<worksheet><cols><col min="1" max="7" width="10"/></cols><sheetData><row r="1"><c r="A1"><v>1.23</v></c></row></sheetData><mergeCells><mergeCell ref="C3:D3"/></mergeCells><dataValidations><dataValidation type="whole" sqref="A1:A4"><formula1>1</formula1></dataValidation></dataValidations></worksheet>';
    await expect(
      validateWorkbookZip(zip([{ name: 'xl/worksheets/sheet1.xml', data }])),
    ).resolves.toBeUndefined();
    await expect(
      validateWorkbookZip(
        zip([
          {
            name: 'xl/workbook.xml',
            data: '<workbook><definedNames><definedName name="SyntheticSmallRange">Sheet1!$A$1:$B$3</definedName></definedNames></workbook>',
          },
        ]),
      ),
    ).resolves.toBeUndefined();
  });

  test('多个各自不大的定义名范围仍受累计展开面积限制', async () => {
    const data =
      '<workbook><definedNames><definedName name="SyntheticOne">Sheet1!$A$1:$BL$2000</definedName><definedName name="SyntheticTwo">Sheet2!$A$1:$BL$2000</definedName></definedNames></workbook>';
    await expect(validateWorkbookZip(zip([{ name: 'xl/workbook.xml', data }]))).rejects.toThrow();
  });

  test('超过256个小合并项也拒绝，无需构造大XML或实际展开', async () => {
    const data =
      '<worksheet><mergeCells>' +
      Array.from(
        { length: 257 },
        (_, index) => `<mergeCell ref="A${index + 1}:A${index + 1}"/>`,
      ).join('') +
      '</mergeCells></worksheet>';
    expect(Buffer.byteLength(data)).toBeLessThan(10_000);
    await expect(
      validateWorkbookZip(zip([{ name: 'xl/worksheets/sheet1.xml', data }])),
    ).rejects.toThrow();
  });

  test.each(['xl/sharedStrings.xml', 'xl/_rels/workbook.xml.rels'])(
    '%s中的CDATA也明确拒绝，不能让文本来源被ExcelJS静默忽略',
    async (name) => {
      const data = name.endsWith('.rels')
        ? '<Relationships><![CDATA[synthetic]]></Relationships>'
        : '<sst><si><t><![CDATA[123.45]]></t></si></sst>';
      await expect(validateWorkbookZip(zip([{ name, data }]))).rejects.toThrow(/CDATA/);
    },
  );

  test('普通共享字符串不受数值原文精度限制，保留文本金额路径', async () => {
    await expect(
      validateWorkbookZip(
        zip([
          {
            name: 'xl/sharedStrings.xml',
            data: '<sst><si><t>90071992547409.91</t></si></sst>',
          },
        ]),
      ),
    ).resolves.toBeUndefined();
  });
});

describe('w_bb_saveas 旧暂存批次必须复查原始XLSX', () => {
  test.each(['伪小展开尺寸', '原始数字精度'] as const)(
    '预检重新拒绝旧批次的%s原文件，不信任已解析payload',
    async (kind) => {
      const app = await createTestApp({ modules: [server] });
      try {
        const api = app.call(server);
        const file = {
          name: '旧暂存.xlsx',
          contentBase64: (await amountWorkbook('1.23')).toString('base64'),
        };
        const prepared = await api.prepare({ name: '旧读取器产生的暂存', files: [file] });
        const unsafe =
          kind === '伪小展开尺寸'
            ? zip([
                {
                  name: 'xl/worksheets/sheet1.xml',
                  data: Buffer.alloc(128 * 1024, 65),
                  declaredSize: 1,
                },
              ])
            : await unsafeNumericWorkbook();
        await app.svc.db
          .withTables<ImportTables>()
          .updateTable('legacy_import_source')
          .set({ content_base64: unsafe.toString('base64') })
          .where('batch_id', '=', prepared.id)
          .where('file_index', '=', 0)
          .execute();
        const before = await coreSnapshot(app);
        const checked = await api.preflight({ id: prepared.id });
        expect(checked.status).toBe('failed');
        expect(checked.receipt).toBeNull();
        if (kind === '伪小展开尺寸')
          expect(checked.issues).toContainEqual(
            expect.objectContaining({
              file: file.name,
              row: 0,
              column: '原文件',
              message: expect.stringContaining('实际解压大小超过声明值'),
              severity: 'error',
            }),
          );
        else
          expect(checked.issues).toContainEqual(
            expect.objectContaining({
              file: file.name,
              row: 2,
              column: 'F',
              message: expect.stringContaining('精确位数'),
              severity: 'error',
            }),
          );
        expect(await coreSnapshot(app)).toEqual(before);
        expect(await api.originalExport({ id: prepared.id, index: 0 })).toEqual({
          name: file.name,
          contentBase64: unsafe.toString('base64'),
        });
      } finally {
        await app.close();
      }
    },
  );

  test('已通过预检的旧批次在正式提交时仍复查源数字，拒绝后无账务写入且原文件可取回', async () => {
    const app = await createTestApp({ modules: [server] });
    try {
      const api = app.call(server),
        file = {
          name: '已预检旧批次.xlsx',
          contentBase64: (await amountWorkbook('1.23')).toString('base64'),
        };
      const prepared = await api.prepare({ name: '旧批次提交前复检', files: [file] });
      const checked = await api.preflight({ id: prepared.id });
      expect(checked.status).toBe('checked');
      const unsafe = await unsafeNumericWorkbook();
      await app.svc.db
        .withTables<ImportTables>()
        .updateTable('legacy_import_source')
        .set({ content_base64: unsafe.toString('base64') })
        .where('batch_id', '=', prepared.id)
        .where('file_index', '=', 0)
        .execute();
      const before = await coreSnapshot(app);
      const error: unknown = await api
        .commit({ id: checked.id, revision: checked.revision, confirmed: true })
        .catch((failure: unknown) => failure);
      const wrapped = error as { data?: { code?: string }; cause?: { data?: { code?: string } } };
      expect(wrapped.cause?.data?.code ?? wrapped.data?.code).toBe('IMPORT_INVALID');
      expect(await coreSnapshot(app)).toEqual(before);
      const failed = await api.get({ id: prepared.id });
      expect(failed.status).toBe('failed');
      expect(failed.receipt).toBeNull();
      expect(failed.issues).toContainEqual(
        expect.objectContaining({
          row: 2,
          column: 'F',
          message: expect.stringContaining('精确位数'),
          severity: 'error',
        }),
      );
      expect(await api.originalExport({ id: prepared.id, index: 0 })).toEqual({
        name: file.name,
        contentBase64: unsafe.toString('base64'),
      });
    } finally {
      await app.close();
    }
  });
});
