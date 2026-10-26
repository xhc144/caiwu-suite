import { FIELDS, TABLES, TABLE_NAMES, type PrepareInput, type TableKind } from './shared';

/** 自建虚构数据，供格式演示和隔离测试；不来自原软件或真实账套。 */
export function syntheticTables(): Record<TableKind, string[][]> {
  return {
    accounts: [
      Object.values(FIELDS.accounts),
      ['9998', '演示借方科目', 'asset', '借', '否', '否', '否', '否', '否'],
      ['9999', '演示贷方科目', 'equity', '贷', '否', '否', '否', '否', '否'],
    ],
    opening: [
      Object.values(FIELDS.opening),
      ['9998', '1000.00', '0.00', '0.00'],
      ['9999', '-1000.00', '0.00', '0.00'],
    ],
    vouchers: [
      Object.values(FIELDS.vouchers),
      [
        'SYN-001',
        '2026-01-06',
        '记',
        '7',
        '待审核',
        '2',
        '1',
        '9998',
        '虚构示例',
        '123.45',
        '0.00',
      ],
      [
        'SYN-001',
        '2026-01-06',
        '记',
        '7',
        '待审核',
        '2',
        '2',
        '9999',
        '虚构示例',
        '0.00',
        '123.45',
      ],
    ],
    balances: [
      Object.values(FIELDS.balances),
      ['9998', '1000.00', '123.45', '0.00', '1123.45', '123.45', '0.00'],
      ['9999', '-1000.00', '0.00', '123.45', '-1123.45', '0.00', '123.45'],
    ],
  };
}

export function syntheticInput(): PrepareInput {
  const tables = syntheticTables();
  return {
    files: TABLES.map((kind) => ({
      name: `${TABLE_NAMES[kind]}.csv`,
      kind,
      encoding: 'utf-8',
      // 本函数用于 Node 测试；页面下载走服务端 Excel 模板。
      base64: Buffer.from(
        tables[kind]
          .map((row) => row.map((v) => `"${v.replaceAll('"', '""')}"`).join(','))
          .join('\r\n'),
      ).toString('base64'),
    })),
    mappings: Object.fromEntries(
      TABLES.map((k) => [k, Object.fromEntries(Object.entries(FIELDS[k]))]),
    ) as PrepareInput['mappings'],
    expected: { accounts: 2, opening: 2, vouchers: 1, lines: 2, balances: 2 },
  };
}
