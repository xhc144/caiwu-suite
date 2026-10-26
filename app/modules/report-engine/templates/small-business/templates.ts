import {
  balanceFormula,
  emptyTemplate,
  ReportTemplateSchema,
  type BalanceFunction,
  type ReportTemplate,
} from '../../shared';
import {
  balanceAddress,
  balanceLines,
  cashflowItems,
  cashflowLines,
  columnLabels,
  incomeLines,
  statementAddress,
  type FilingMode,
} from './catalogue';

const text = (t: ReportTemplate, address: string, source: string) =>
  t.cells.push({ address, source, kind: 'text', unit: 'number', currency: 'CNY' });
const formula = (t: ReportTemplate, address: string, source: string) =>
  t.cells.push({ address, source, kind: 'formula', unit: 'cents', currency: 'CNY' });

function base(code: string, name: string, rows: number, cols: number) {
  const t = emptyTemplate({ code, name, rows, cols });
  t.readOnly = true;
  text(t, 'A1', name);
  text(t, 'A2', '取数切片：尚未完成完整法定报表；请阅读同目录README的未完成项。');
  text(t, 'A3', '金额以整数分取数、以元显示；生成期间及仅已过账口径见导出“口径与审核”。');
  t.merges = [1, 2, 3].map((row) => ({ row, col: 1, rows: 1, cols }));
  t.colWidths = Array.from({ length: cols }, (_, i) => ({
    col: i + 1,
    width: i % 4 === 0 ? 420 : i % 4 === 1 ? 60 : 200,
  }));
  t.rowHeights = [1, 2, 3].map((row) => ({ row, height: 44 }));
  return t;
}

function finish(t: ReportTemplate) {
  t.styles = t.cells.map((c) => ({
    address: c.address,
    align: c.kind === 'formula' ? 'right' : 'left',
    wrap: c.kind === 'text',
    bold: ['A1', 'A2'].includes(c.address),
    format: c.kind === 'formula' ? 'decimal2' : 'general',
  }));
  return ReportTemplateSchema.parse(t);
}

function balance(account: string, metric: BalanceFunction['metric'], item = '') {
  return balanceFormula({
    account,
    metric,
    unit: 'cents',
    currency: 'CNY',
    direction: 'signed',
    dimension: item ? 'cashflow' : 'none',
    item,
  });
}

/** 不是本月期初：含年中启用前累计时，仍按core的年度累计口径还原年初。 */
function yearOpening(account: string) {
  return `(${balance(account, 'closing')}-${balance(account, 'ytdDebit')}+${balance(account, 'ytdCredit')})`;
}

// 只接入无需往来方向、到期日或结转识别的项目。未接入项目始终是明确的文字。
const directBalanceAccounts: Readonly<Record<number, readonly string[]>> = {
  1: ['1001', '1002', '1012'],
  2: ['1101'],
  3: ['1121'],
  6: ['1131'],
  7: ['1132'],
  8: ['1221'],
  10: ['1403'],
  12: ['1405'],
  13: ['1411'],
  17: ['1511'],
  18: ['1601'],
  19: ['-1602'],
  20: ['1601', '1602'],
  21: ['1604'],
  22: ['1605'],
  23: ['1606'],
  24: ['1621', '1622'],
  25: ['1701', '1702'],
  26: ['4301'],
  31: ['-2001'],
  32: ['-2201'],
  35: ['-2211'],
  36: ['-2221'],
  37: ['-2231'],
  38: ['-2232'],
  39: ['-2241'],
  49: ['-3002'],
  50: ['-3101'],
};

export function balanceSheetTemplate() {
  const t = base('301', '小企业资产负债表（部分取数，未完成）', 39, 8);
  for (const [address, label] of [
    ['A4', '会小企01表；small-appendix.pdf第68—75页'],
    ['A5', '资产'],
    ['B5', '行次'],
    ['C5', '期末余额'],
    ['D5', '年初余额'],
    ['E5', '负债和所有者权益'],
    ['F5', '行次'],
    ['G5', '期末余额'],
    ['H5', '年初余额'],
    ['A37', '小企业（中外合作经营）须增加“减：已归还投资”；本切片尚未实现。'],
    ['A38', '附注及附表：应付职工薪酬明细、应交税费明细、利润分配表尚未实现。'],
    ['A39', '年初采用期末－本年借方累计＋本年贷方累计；需以正确录入的期初及累计为前提。'],
  ])
    text(t, address!, label!);
  for (const [i, label] of balanceLines.entries()) {
    const line = i + 1;
    const gridRow = line <= 30 ? line + 5 : line - 25;
    text(t, `${line <= 30 ? 'A' : 'E'}${gridRow}`, label);
    text(t, `${line <= 30 ? 'B' : 'F'}${gridRow}`, String(line));
    for (const column of ['closing', 'yearOpening'] as const) {
      const address = balanceAddress(line, column);
      const accounts = directBalanceAccounts[line];
      if (!accounts) {
        text(t, address, '未实现：需重分类、分析填列或完整合计');
        continue;
      }
      formula(
        t,
        address,
        accounts
          .map((raw) => {
            const negative = raw.startsWith('-');
            const account = negative ? raw.slice(1) : raw;
            const source =
              column === 'closing' ? balance(account, 'closing') : yearOpening(account);
            return negative ? `-(${source})` : source;
          })
          .join('+'),
      );
    }
  }
  for (const column of ['closing', 'yearOpening'] as const) {
    t.checks.push({
      name: `${column === 'closing' ? '期末' : '年初'}固定资产账面价值＝原价－累计折旧`,
      left: balanceAddress(20, column),
      right: `${balanceAddress(18, column)}-${balanceAddress(19, column)}`,
      tolerance: '0',
    });
  }
  return finish(t);
}

export function incomeTemplate(mode: FilingMode = 'monthly') {
  const t = base(
    '302',
    `小企业利润表（${mode === 'monthly' ? '月报' : '年报'}表样，取数未实现）`,
    39,
    4,
  );
  text(t, 'A4', '会小企02表；small-appendix.pdf第75—78页；保留所依据原文的项目名称。');
  const labels = columnLabels(mode);
  for (const [address, label] of [
    ['A5', '项目'],
    ['B5', '行次'],
    ['C5', labels[0]],
    ['D5', labels[1]],
  ])
    text(t, address!, label!);
  for (const [i, label] of incomeLines.entries()) {
    text(t, `A${i + 6}`, label);
    text(t, `B${i + 6}`, String(i + 1));
    text(t, statementAddress(i + 1, 'ytd'), '未实现：需排除损益结转并保留冲减');
    text(
      t,
      statementAddress(i + 1, 'comparison'),
      mode === 'annual' ? '未实现：需上年全年、结转前净发生额' : '未实现：需本月结转前净发生额',
    );
  }
  text(t, 'A39', '其中项需费用明细映射；不按总额、贷方累计或零值替代。');
  return finish(t);
}

/**
 * 现有引擎可以真实计算月报22行，但审核失败不阻止导出，故保留“试算，未完成”。
 * SBxx标在现金类分录上；内部转存统一SB_INTERNAL，两侧都须填写。
 */
export function cashflowTemplate(mode: FilingMode = 'monthly') {
  const t = base(
    '303',
    `小企业现金流量表（${mode === 'monthly' ? '月报' : '年报'}取数试算，未完成）`,
    52,
    6,
  );
  const accounts = ['1001', '1002', '1012'];
  const sumBalance = (metric: BalanceFunction['metric'], item = '') =>
    accounts.map((a) => balance(a, metric, item)).join('+');
  const labels = columnLabels(mode);
  for (const [address, label] of [
    ['A4', '会小企03表；small-appendix.pdf第78—82页；现金范围：1001、1002、1012。'],
    ['A5', '项目'],
    ['B5', '行次'],
    ['C5', labels[0]],
    ['D5', labels[1]],
    ['A29', '取数检查区：SBxx为本模板现金流量分类；内部转存SB_INTERNAL；检查不通过须停止使用。'],
    ['A30', '现金流量项目'],
    ['B30', '制度行次'],
    ['C30', '本年借方'],
    ['D30', '本年贷方'],
    ['E30', '本月借方'],
    ['F30', '本月贷方'],
    ['A50', '未完成：审核失败阻止生成/导出、逐分录漏分阻止、受限资金与现金范围配置。'],
    ['A51', '未完成：年报上年金额、单位及日期动态表头、附注；不构成完整法定报表。'],
    ['A52', '购建资产借款利息列行17；工程人员工资列行4；处置资产现金净额列行10。'],
  ])
    text(t, address!, label!);
  for (const [i, label] of cashflowLines.entries()) {
    text(t, `A${i + 6}`, label);
    text(t, `B${i + 6}`, String(i + 1));
  }
  const items = [
    ...cashflowItems.map((item) => ({ ...item, label: cashflowLines[item.line - 1]! })),
    { line: 0, code: 'SB_INTERNAL', side: 'in', label: '现金内部转存（不计入三类活动）' },
  ];
  for (const [i, item] of items.entries()) {
    const row = i + 31;
    text(t, `A${row}`, `${item.code} ${item.label}`);
    text(t, `B${row}`, item.line ? String(item.line) : '内部');
    for (const [column, metric] of [
      ['C', 'ytdDebit'],
      ['D', 'ytdCredit'],
      ['E', 'debit'],
      ['F', 'credit'],
    ] as const)
      formula(t, `${column}${row}`, sumBalance(metric, item.code));
    if (!item.line) continue;
    formula(
      t,
      statementAddress(item.line, 'ytd'),
      item.side === 'in' ? `C${row}-D${row}` : `D${row}-C${row}`,
    );
    if (mode === 'monthly')
      formula(
        t,
        statementAddress(item.line, 'comparison'),
        item.side === 'in' ? `E${row}-F${row}` : `F${row}-E${row}`,
      );
  }
  for (const [column, key] of [
    ['C', 'ytd'],
    ['D', 'comparison'],
  ] as const) {
    if (column === 'D' && mode === 'annual') {
      for (let line = 1; line <= 22; line++)
        text(t, statementAddress(line, key), '未实现：需上年全年取数');
      continue;
    }
    const a = (line: number) => statementAddress(line, key);
    const equations: Readonly<Record<number, string>> = {
      7: `${a(1)}+${a(2)}-${a(3)}-${a(4)}-${a(5)}-${a(6)}`,
      13: `${a(8)}+${a(9)}+${a(10)}-${a(11)}-${a(12)}`,
      19: `${a(14)}+${a(15)}-${a(16)}-${a(17)}-${a(18)}`,
      20: `${a(7)}+${a(13)}+${a(19)}`,
      21: column === 'C' ? accounts.map(yearOpening).join('+') : sumBalance('opening'),
      22: `${a(20)}+${a(21)}`,
    };
    for (const [line, source] of Object.entries(equations)) formula(t, a(Number(line)), source);
    t.checks.push({
      name: `${labels[column === 'C' ? 0 : 1]}期末现金与总账一致`,
      left: a(22),
      right: sumBalance('closing'),
      tolerance: '0',
    });
  }
  for (const [column, metric, label] of [
    ['C', 'ytdDebit', '本年借方分类完整'],
    ['D', 'ytdCredit', '本年贷方分类完整'],
    ['E', 'debit', '本月借方分类完整'],
    ['F', 'credit', '本月贷方分类完整'],
  ] as const)
    t.checks.push({
      name: label,
      left: sumBalance(metric),
      right: `SUM(${column}31:${column}47)`,
      tolerance: '0',
    });
  for (const [left, right, label] of [
    ['C47', 'D47', '本年'],
    ['E47', 'F47', '本月'],
  ])
    t.checks.push({
      name: `${label}现金内部转存净额为零`,
      left: left!,
      right: right!,
      tolerance: '0',
    });
  return finish(t);
}
