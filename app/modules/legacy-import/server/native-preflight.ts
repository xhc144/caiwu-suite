import { createHash } from 'node:crypto';
import { isValidDate } from '@caiwu/core';
import {
  NativeDocumentSchema,
  NATIVE_GAPS,
  NATIVE_HEAD,
  NATIVE_KEYS,
  NATIVE_NOTICE,
  NATIVE_PZ,
  NATIVE_SAVEAS,
  NATIVE_SAVEAS0,
  NATIVE_TYPES,
  type NativeIssue,
  type NativeReport,
  type NativeRowRef,
} from '../native';

type Values = Record<string, string | null>;
type Row = { ref: NativeRowRef; values: Values };
const empty = (s: string | null | undefined) => s == null || s === '';
const limits: Record<string, number> = {
  kmbm: 20,
  pz_zy: 80,
  pzdj_zdr: 8,
  pzdj_shr: 8,
  pzdj_jzr: 8,
  pzlx_jc: 20,
  pzlx_qc: 20,
};
const checked = new Set([
  ...NATIVE_KEYS,
  'pz_xh',
  'kmbm',
  'pz_zy',
  'pz_jf',
  'pz_df',
  'dd',
  'pzdj_fds',
  'pzdj_rq',
  'pzdj_shrq',
  'pzdj_jzrq',
  'pzlx_jc',
  'pzlx_qc',
]);
function canonical(name: string, field: string): string {
  if (name.startsWith('dw_pz_saveas')) {
    if (field.startsWith('pzdj_')) return field.slice(5);
    if (name === 'dw_pz_saveas0' || field === 'pz_dd' || field === 'pz_bz1')
      return field.startsWith('pz_') ? field.slice(3) : field;
  }
  return field;
}
function handling(field: string): string {
  if (checked.has(field)) return '逐值校验并保留原值';
  if (field === 'pzdj_bz') return '保留原状态；语义不全，阻断迁移';
  if (['pzdj_zdr', 'pzdj_shr', 'pzdj_jzr'].includes(field)) return '保留历史人员；有值即阻断迁移';
  return '保留不支持字段；有值即阻断迁移（含零）';
}

/** Pure analysis: no DB, services, batches, vouchers, or execution plan are reachable here. */
export function nativePreflight(input: { name: string; text: string }): NativeReport {
  const report: NativeReport = {
    source: {
      name: input.name,
      bytes: Buffer.byteLength(input.text),
      sha256: createHash('sha256').update(input.text).digest('hex'),
    },
    profile: '未识别',
    structurePassed: false,
    textAmountsPassed: false,
    migrationAllowed: false,
    targetChanges: 0,
    notice: NATIVE_NOTICE,
    issues: [],
    issueCount: 0,
    document: null,
    coverage: [],
    records: [],
    vouchers: [],
    gaps: [...NATIVE_GAPS],
  };
  let structureErrors = 0;
  let fidelityErrors = 0;
  const add = (
    code: string,
    area: NativeIssue['area'],
    table: string,
    row: number | null,
    field: string,
    message: string,
  ) => {
    report.issueCount++;
    if (area === 'structure') structureErrors++;
    if (area === 'fidelity') fidelityErrors++;
    report.issues.push({ code, area, table, row, field, message });
  };
  const issue = (r: Row, code: string, area: NativeIssue['area'], field: string, message: string) =>
    add(code, area, r.ref.table, r.ref.row, field, message);
  const finish = () => {
    report.structurePassed = structureErrors === 0;
    report.textAmountsPassed =
      fidelityErrors === 0 &&
      report.vouchers.length > 0 &&
      report.vouchers.every((v) => v.debitCents !== null && v.creditCents !== null);
    add('PREFLIGHT_ONLY', 'migration', '', null, '', NATIVE_NOTICE);
    return report;
  };
  if (report.source.bytes > 262_144) {
    add('SOURCE_LIMIT', 'structure', '', null, '', '文本超过 256 KiB；请按来源范围拆分后预检。');
    return finish();
  }
  let value: unknown;
  try {
    value = JSON.parse(input.text) as unknown;
  } catch {
    add(
      'EXPLICIT_ROWS_REQUIRED',
      'structure',
      '',
      null,
      '',
      '需要 caiwu-native-rows-v1 JSON 表行；不解析未知原导出字节、编码或 PowerBuilder 转义。',
    );
    return finish();
  }
  const parsed = NativeDocumentSchema.safeParse(value);
  if (!parsed.success) {
    add(
      'ROW_DOCUMENT_INVALID',
      'structure',
      '',
      null,
      '',
      '表行结构不符合明确格式：字段值只接受字符串或 null，禁止数值浮点、未知元数据、超限行列。',
    );
    return finish();
  }
  const doc = parsed.data;
  report.document = doc;
  if (doc.tables.reduce((sum, t) => sum + t.rows.length, 0) > 5000) {
    add('ROW_LIMIT', 'structure', '', null, '', '合计超过 5000 行。');
    return finish();
  }
  if (doc.source.decoding !== 'explicit-json-rows')
    add(
      'BYTE_FORMAT_UNKNOWN',
      'fidelity',
      '',
      null,
      '',
      '原字节编码/转义未知，不能证明原导出兼容。',
    );
  if (doc.source.amountUnit === 'unknown')
    add('AMOUNT_UNIT_UNKNOWN', 'fidelity', '', null, '', '金额单位未知，禁止猜测元或分。');
  if (doc.source.amountEncoding !== 'decimal-text')
    add(
      'DOUBLE_UNVERIFIED',
      'fidelity',
      '',
      null,
      '',
      '原 double 未经精度核验，不能用舍入后的文本冒充保真。',
    );
  if (doc.source.currency !== 'CNY')
    add(
      'CURRENCY_UNSUPPORTED',
      'fidelity',
      '',
      null,
      '',
      '当前只校验明确声明的 CNY 本币金额文本，未知币种/外币均阻断。',
    );
  add(
    'ORIGINAL_PRECISION_UNVERIFIED',
    'migration',
    '',
    null,
    '',
    '收到的十进制文本可检查是否精确落分；原 double 与导出文本的等值性、原单位来源尚未核验。',
  );

  const names = doc.tables.map((t) => t.name);
  const joined = names.includes('dw_pz_saveas')
    ? 'dw_pz_saveas'
    : names.includes('dw_pz_saveas0')
      ? 'dw_pz_saveas0'
      : null;
  const requiredNames = joined ? [joined, 'pzlx'] : ['pz', 'pzdj', 'pzlx'];
  report.profile = joined ? `qingsong/${joined}` : 'qingsong/dw_pz_saveas 的 pz/pzdj 显式投影';
  if (new Set(names).size !== names.length)
    add('TABLE_DUPLICATE', 'structure', '', null, '', '表名重复，不能合并或覆盖来源表。');
  for (const name of requiredNames)
    if (!names.includes(name))
      add('TABLE_MISSING', 'structure', name, null, '', '缺少该 profile 必需的表。');
  for (const name of names)
    if (!requiredNames.includes(name))
      add(
        'TABLE_UNSUPPORTED',
        'structure',
        name,
        null,
        '',
        '不支持该表或混合 profile；不能把 pz/pzdj/kmbm/nc 展示变体拼接成真实版本。',
      );
  const expected: Record<string, readonly string[]> = {
    pz: NATIVE_PZ,
    pzdj: NATIVE_HEAD,
    pzlx: NATIVE_TYPES,
    dw_pz_saveas: NATIVE_SAVEAS,
    dw_pz_saveas0: NATIVE_SAVEAS0,
  };
  const rows = new Map<string, Row[]>();
  for (const t of doc.tables) {
    if (new Set(t.columns).size !== t.columns.length)
      add('COLUMN_DUPLICATE', 'structure', t.name, null, '', '字段名重复，不能覆盖来源值。');
    const fields = expected[t.name];
    for (const field of new Set([...t.columns, ...(fields ?? [])])) {
      const present = t.columns.includes(field);
      report.coverage.push({
        table: t.name,
        field,
        present,
        handling: fields?.includes(field)
          ? handling(canonical(t.name, field))
          : '未知字段，阻断；原值保留',
      });
      if (!present)
        add(
          'FIELD_MISSING',
          'structure',
          t.name,
          null,
          field,
          '缺少固定 profile 字段，不补默认值。',
        );
      else if (!fields?.includes(field))
        add(
          'FIELD_UNSUPPORTED',
          'structure',
          t.name,
          null,
          field,
          '不属于该固定原字段 profile，即使全空也不能忽略。',
        );
    }
    const records = t.rows.map((values, index): Row => {
      if (values.length !== t.columns.length)
        add('ROW_WIDTH', 'structure', t.name, index + 1, '', '行列数不一致；缺格不是 NULL。');
      const sourceValues = Object.fromEntries(
        t.columns.map((field, col) => [field, values[col] ?? null]),
      );
      const ref = { table: t.name, row: index + 1, values: sourceValues };
      report.records.push(ref);
      return {
        ref,
        values: Object.fromEntries(
          Object.entries(sourceValues).map(([f, v]) => [canonical(t.name, f), v]),
        ),
      };
    });
    if (records.length === 0) add('TABLE_EMPTY', 'structure', t.name, null, '', '来源表没有数据。');
    rows.set(t.name, records);
  }
  if (structureErrors > 0) {
    report.profile = `未完整匹配：${report.profile}`;
    return finish();
  }

  const integer = (r: Row, f: string, min: number, max: number): number | null => {
    const text = r.values[f];
    if (
      text == null ||
      !/^(0|[1-9]\d*)$/.test(text) ||
      !Number.isSafeInteger(Number(text)) ||
      Number(text) < min ||
      Number(text) > max
    ) {
      issue(
        r,
        'INTEGER_INVALID',
        'structure',
        f,
        `必须为 ${min} 至 ${max} 的整数文本，不规范化或猜值。`,
      );
      return null;
    }
    return Number(text);
  };
  const key = (r: Row) => {
    const parts = [
      integer(r, 'nf', 1900, 9999),
      integer(r, 'yf', 1, 12),
      integer(r, 'pzlx', 1, 32767),
      integer(r, 'pzbh', 1, 10000),
    ];
    return parts.some((p) => p == null) ? null : parts.join('/');
  };
  const dict = new Map<string, Row>();
  for (const r of rows.get('pzlx') ?? []) {
    const id = integer(r, 'pzlx', 1, 32767);
    if (id == null) continue;
    if (dict.has(String(id)))
      issue(r, 'TYPE_DUPLICATE', 'structure', 'pzlx', '类型字典代码重复，禁止以名称猜对应关系。');
    dict.set(String(id), r);
    for (const f of ['pzlx_jc', 'pzlx_qc'])
      if (empty(r.values[f]))
        issue(r, 'TYPE_NAME_MISSING', 'structure', f, '类型字典名称不能为空。');
  }
  const heads = new Map<string, Row>();
  const lines: Row[] = [];
  if (joined) {
    for (const r of rows.get(joined) ?? []) {
      const k = key(r);
      if (k == null) continue;
      const h = {
        ref: r.ref,
        values: Object.fromEntries(
          NATIVE_HEAD.filter((f) => f in r.values).map((f) => [f, r.values[f] ?? null]),
        ),
      };
      const previous = heads.get(k);
      if (previous && JSON.stringify(previous.values) !== JSON.stringify(h.values))
        issue(
          r,
          'HEAD_CONFLICT',
          'structure',
          '',
          `四键 ${k} 重复头信息不一致（首行 ${previous.ref.row}）。`,
        );
      if (!previous) heads.set(k, h);
      lines.push(r);
    }
    if (joined === 'dw_pz_saveas0') {
      for (const f of ['pzdj_bz', 'pzdj_rq', 'pzdj_shrq', 'pzdj_jzrq']) {
        report.coverage.push({
          table: joined,
          field: f,
          present: false,
          handling: '该原 profile 缺失此信息；阻断，不从日/人员推定',
        });
        add(
          'SAVEAS0_INFORMATION_MISSING',
          'structure',
          joined,
          null,
          f,
          'saveas0 缺状态/凭证及审核过账日期，不能默认未审核或由人员、日字段重建。',
        );
      }
    }
  } else {
    for (const r of rows.get('pzdj') ?? []) {
      const k = key(r);
      if (k == null) continue;
      if (heads.has(k))
        issue(
          r,
          'HEAD_DUPLICATE',
          'structure',
          '',
          `四键 ${k} 重复凭证头（首行 ${heads.get(k)!.ref.row}），即使相同也阻断。`,
        );
      else heads.set(k, r);
    }
    lines.push(...(rows.get('pz') ?? []));
  }
  for (const [table, records] of rows)
    for (const r of records)
      for (const [f, v] of Object.entries(r.values)) {
        const max = limits[f];
        if (max != null && v != null && v.length > max)
          issue(r, 'TEXT_LENGTH', 'structure', f, `超过原定义 ${max} 字符上限。`);
        if (table === 'pzlx' || checked.has(f) || f === 'pzdj_bz') continue;
        if (!empty(v))
          issue(
            r,
            ['pzdj_zdr', 'pzdj_shr', 'pzdj_jzr'].includes(f)
              ? 'HISTORICAL_PERSON_UNSUPPORTED'
              : 'NATIVE_FIELD_UNSUPPORTED',
            'migration',
            f,
            '该原字段有值（含零），尚无保真迁移能力；原值保留，禁止静默丢弃。',
          );
      }
  const grouped = new Map<string, Row[]>();
  const identities = new Set<string>();
  for (const r of lines) {
    const k = key(r);
    const seq = integer(r, 'pz_xh', 1, 5000);
    if (k == null) continue;
    const identity = `${k}/${seq}`;
    if (seq != null && identities.has(identity))
      issue(r, 'LINE_DUPLICATE', 'structure', 'pz_xh', `四键及行序重复：${identity}。`);
    identities.add(identity);
    if (!heads.has(k))
      issue(r, 'LINE_ORPHAN', 'structure', '', `四键 ${k} 找不到凭证头，不能只按编号连接。`);
    const list = grouped.get(k) ?? [];
    list.push(r);
    grouped.set(k, list);
    if (empty(r.values.kmbm) || !/^\d+$/.test(r.values.kmbm ?? ''))
      issue(
        r,
        'ACCOUNT_INVALID',
        'structure',
        'kmbm',
        '科目编码必须是非空数字文本；本报告不证明科目档案及末级关系。',
      );
  }
  const money = (r: Row, f: string): bigint | null => {
    const text = r.values[f];
    const unit = doc.source.amountUnit;
    const pattern = unit === 'fen' ? /^-?(0|[1-9]\d*)$/ : /^-?(0|[1-9]\d*)(\.\d{1,2})?$/;
    if (unit === 'unknown' || doc.source.amountEncoding !== 'decimal-text') return null;
    if (text == null || !pattern.test(text)) {
      issue(
        r,
        'AMOUNT_PRECISION',
        'fidelity',
        f,
        '金额必须为明确单位的精确十进制文本；不接受空值、科学计数、超额小数或舍入。',
      );
      return null;
    }
    const [whole = '', fraction = ''] = text.replace(/^-/, '').split('.');
    const cents =
      (BigInt(whole) * (unit === 'fen' ? 1n : 100n) +
        (unit === 'fen' ? 0n : BigInt(fraction.padEnd(2, '0')))) *
      (text.startsWith('-') ? -1n : 1n);
    if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < BigInt(Number.MIN_SAFE_INTEGER)) {
      issue(r, 'AMOUNT_RANGE', 'fidelity', f, '金额超出安全整数分范围。');
      return null;
    }
    return cents;
  };
  for (const [k, h] of heads) {
    const list = grouped.get(k) ?? [];
    if (list.length === 0) issue(h, 'HEAD_ORPHAN', 'structure', '', `四键 ${k} 没有任何分录。`);
    if (list.length < 2) issue(h, 'LINES_INCOMPLETE', 'structure', '', '凭证至少需要两条分录。');
    const type = dict.get(h.values.pzlx ?? '');
    if (!type)
      issue(
        h,
        'TYPE_UNKNOWN',
        'structure',
        'pzlx',
        '来源类型代码不在独立 pzlx 字典中，禁止按名称或目标类型猜测。',
      );
    integer(h, 'pzdj_fds', 0, 2147483647);
    const status = h.values.pzdj_bz;
    if (empty(status))
      issue(h, 'STATUS_MISSING', 'migration', 'pzdj_bz', '缺少原状态，禁止默认未审核。');
    else if (status === '1' || status === '2')
      issue(
        h,
        'HISTORICAL_STATUS_UNSUPPORTED',
        'migration',
        'pzdj_bz',
        `原规则禁止转入状态 ${status}；本切片不转换历史审核/过账状态。`,
      );
    else
      issue(
        h,
        'STATUS_UNKNOWN',
        'migration',
        'pzdj_bz',
        `状态「${status}」语义未核实，禁止解释为未审核。`,
      );
    for (const f of ['pzdj_rq', 'pzdj_shrq', 'pzdj_jzrq']) {
      const date = h.values[f];
      if (empty(date)) {
        if (f === 'pzdj_rq')
          issue(h, 'DATE_MISSING', 'structure', f, '凭证日期缺失，禁止拼接或默认。');
        continue;
      }
      if (!isValidDate(date!))
        issue(
          h,
          'DATE_INVALID',
          'structure',
          f,
          '日期必须为真实 YYYY-MM-DD 文本，不做区域格式猜测。',
        );
    }
    const date = h.values.pzdj_rq;
    if (
      date &&
      isValidDate(date) &&
      (Number(date.slice(0, 4)) !== Number(h.values.nf) ||
        Number(date.slice(5, 7)) !== Number(h.values.yf))
    )
      issue(h, 'DATE_PERIOD_MISMATCH', 'structure', 'pzdj_rq', '凭证日期与四键年月不一致。');
    const audit = h.values.pzdj_shrq;
    const posted = h.values.pzdj_jzrq;
    if (
      (date && audit && isValidDate(audit) && audit < date) ||
      (posted &&
        isValidDate(posted) &&
        ((date && posted < date) || (audit && isValidDate(audit) && posted < audit)))
    )
      issue(
        h,
        'DATE_ORDER',
        'structure',
        'pzdj_shrq/pzdj_jzrq',
        '审核/过账日期早于前序日期，不能修改来源时间。',
      );
    for (const [actor, time] of [
      ['pzdj_shr', 'pzdj_shrq'],
      ['pzdj_jzr', 'pzdj_jzrq'],
    ] as const)
      if (!empty(h.values[actor]) && empty(h.values[time]))
        issue(
          h,
          'HISTORICAL_DATE_MISSING',
          'migration',
          time,
          '历史人员存在但对应日期缺失，不能补当前时间。',
        );
    let debit = 0n,
      credit = 0n,
      complete = true;
    const amounts: NativeReport['vouchers'][number]['amounts'] = [];
    list.forEach((r, index) => {
      if (Number(r.values.pz_xh) !== index + 1)
        issue(
          r,
          'LINE_ORDER',
          'structure',
          'pz_xh',
          '行序须在来源出现顺序中从 1 连续递增；不自动重排或补号。',
        );
      const day = integer(r, 'dd', 1, 31);
      if (date && isValidDate(date) && day !== Number(date.slice(8, 10)))
        issue(r, 'DAY_MISMATCH', 'structure', 'dd', '分录日与头日期不一致。');
      const d = money(r, 'pz_jf'),
        c = money(r, 'pz_df');
      amounts.push({
        row: r.ref.row,
        debitText: r.values.pz_jf ?? null,
        creditText: r.values.pz_df ?? null,
        debitCents: d?.toString() ?? null,
        creditCents: c?.toString() ?? null,
      });
      if (d == null || c == null) complete = false;
      else {
        debit += d;
        credit += c;
        if ((d !== 0n && c !== 0n) || (d === 0n && c === 0n))
          issue(
            r,
            'AMOUNT_SIDE',
            'structure',
            'pz_jf/pz_df',
            '每条分录须恰有一侧非零（红字保留符号）。',
          );
      }
    });
    if (complete && debit !== credit)
      issue(h, 'VOUCHER_UNBALANCED', 'structure', 'pz_jf/pz_df', '按明确单位精确转分后借贷不平。');
    if (
      debit > BigInt(Number.MAX_SAFE_INTEGER) ||
      debit < BigInt(Number.MIN_SAFE_INTEGER) ||
      credit > BigInt(Number.MAX_SAFE_INTEGER) ||
      credit < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      issue(h, 'TOTAL_RANGE', 'fidelity', 'pz_jf/pz_df', '合计超出安全整数分范围。');
      complete = false;
    }
    report.vouchers.push({
      key: k,
      head: h.ref,
      lines: list.map((r) => r.ref),
      typeName: type?.values.pzlx_jc ?? null,
      debitCents: complete ? debit.toString() : null,
      creditCents: complete ? credit.toString() : null,
      amounts,
    });
  }
  return finish();
}
