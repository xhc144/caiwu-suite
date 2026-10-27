import ExcelJS from 'exceljs';
import Decimal from 'decimal.js';
import { escapeHtml, type PrintJob } from '@caiwu/print';
import type { PreparedSmallBusiness } from './statutory.server';
import type { Statement } from './statements';
import { problem } from './configuration';

export const displayAmount = (value: number) => new Decimal(value).div(100).toFixed(2);
export const reportDate = (p: number) =>
  new Date(Date.UTC(Math.floor(p / 100), p % 100, 0)).toISOString().slice(0, 10);
export function statementPrintJob(prepared: PreparedSmallBusiness, statement: Statement): PrintJob {
  const pages: string[] = [];
  for (let offset = 0; offset < statement.rows.length; offset += 18) {
    const rows = statement.rows.slice(offset, offset + 18);
    const header = `<header><h1>${escapeHtml(statement.name)}</h1><p>会小企${statement.code.slice(1)}表 编制单位：${escapeHtml(prepared.orgName)} 报告日期：${reportDate(prepared.period)} 单位：元</p></header>`;
    const head = `<thead><tr><th style="width:50%">项目</th><th style="width:8%">行次</th><th style="width:21%">${escapeHtml(statement.columns[0])}</th><th style="width:21%">${escapeHtml(statement.columns[1])}</th></tr></thead>`;
    const body = rows
      .map(
        (r) =>
          `<tr><td>${escapeHtml(r.label)}</td><td>${r.line}</td>${r.amounts.map((a) => `<td class="num">${a ? displayAmount(a.value) : '不适用'}</td>`).join('')}</tr>`,
      )
      .join('');
    const returned =
      offset === 36 && statement.returnedInvestment?.some(Boolean)
        ? `<p>实收资本项下减：已归还投资 期末 ${displayAmount(statement.returnedInvestment[0])} 年初 ${displayAmount(statement.returnedInvestment[1])}</p>`
        : '';
    pages.push(
      `<section class="small-report-page">${header}<table>${head}<tbody>${body}</tbody></table>${returned}${prepared.comparisonNote ? `<p>${escapeHtml(prepared.comparisonNote)}</p>` : ''}${offset + 18 >= statement.rows.length ? (statement.notes ?? []).map((n) => `<p>${escapeHtml(n)}</p>`).join('') : ''}<footer>仅已过账 ${prepared.mode === 'annual' ? '年报' : '月报'} 第${pages.length + 1}页</footer></section>`,
    );
  }
  return {
    title: statement.name,
    html: pages.join(''),
    pageSize: 'A4',
    orientation: 'portrait',
    marginMm: 12,
    css: '.small-report-page{break-after:page;page-break-after:always}.small-report-page:last-child{break-after:auto;page-break-after:auto}.small-report-page h1{text-align:center;font-size:18pt;margin:5mm 0}.small-report-page p{font-size:10pt;line-height:1.5}.small-report-page th,.small-report-page td{font-size:10pt;line-height:1.45;padding:2.5mm 1.5mm}.small-report-page tr{break-inside:avoid}.small-report-page footer{margin-top:5mm;font-size:9pt;text-align:right}thead{display:table-header-group}',
  };
}
/** 仅序列化公共入口已批准的成功快照；来源复核与输出权限由该入口执行。 */
export async function statementWorkbook(
  prepared: PreparedSmallBusiness,
  statement: Statement,
): Promise<string> {
  for (const row of statement.rows)
    for (const a of row.amounts)
      if (a && new Decimal(a.value).div(100).sd() > 15)
        problem('EXCEL_PRECISION', `行${row.line}金额超过Excel可精确保存的数值范围，请先核实金额`);
  const wb = new ExcelJS.Workbook(),
    ws = wb.addWorksheet(statement.name);
  ws.columns = [{ width: 62 }, { width: 8 }, { width: 22 }, { width: 22 }];
  ws.mergeCells('A1:D1');
  ws.getCell('A1').value = statement.name;
  ws.getCell('A1').font = { bold: true, size: 18 };
  ws.mergeCells('A2:D2');
  ws.getCell('A2').value =
    `编制单位：${prepared.orgName} 报告日期：${reportDate(prepared.period)} 单位：元`;
  ws.addRow(['项目', '行次', ...statement.columns]);
  for (const row of statement.rows) {
    const out = ws.addRow([
      row.label,
      row.line,
      ...row.amounts.map((a) => (a ? new Decimal(a.value).div(100).toNumber() : '不适用')),
    ]);
    out.height = 32;
    for (const column of [3, 4]) {
      const cell = out.getCell(column),
        a = row.amounts[column - 3];
      cell.numFmt = '#,##0.00;[Red]-#,##0.00';
      cell.alignment = { horizontal: 'right' };
      if (a)
        cell.note = `${a.formula}\n${a.sources.map((s) => `${s.account} ${s.from}—${s.to} ${s.toRoute}`).join('\n')}`;
    }
  }
  if (statement.returnedInvestment?.some(Boolean))
    ws.addRow([
      '减：已归还投资',
      '',
      ...statement.returnedInvestment.map((v) => new Decimal(v).div(100).toNumber()),
    ]);
  if (prepared.comparisonNote) {
    ws.addRow([prepared.comparisonNote]);
    ws.mergeCells(ws.rowCount, 1, ws.rowCount, 4);
  }
  ws.eachRow((r) =>
    r.eachCell((c) => {
      c.alignment = { ...c.alignment, vertical: 'middle', wrapText: true };
      c.border = { bottom: { style: 'thin', color: { argb: 'FF999999' } } };
    }),
  );
  ws.pageSetup = {
    paperSize: 9,
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: '1:3',
    margins: { left: 0.45, right: 0.45, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
    printArea: `A1:D${ws.rowCount}`,
  };
  ws.headerFooter.oddFooter = '第 &P 页，共 &N 页';
  const meta = wb.addWorksheet('来源与口径');
  meta.addRows([
    ['单位', prepared.orgName],
    ['报告日期', reportDate(prepared.period)],
    ['口径', '仅已过账'],
    ['配置版本', prepared.configuration.revision],
    ['比较期说明', prepared.comparisonNote ?? statement.columns[1]],
    ...(statement.notes ?? []).map((n) => ['编制说明', n]),
    ['项目', '期间', '科目', '凭证', '分录', '金额（元）', '联查'],
  ]);
  for (const row of statement.rows)
    for (const a of row.amounts)
      if (a)
        for (const s of a.sources)
          meta.addRow([
            `${row.line} ${row.label}`,
            `${s.from}—${s.to}`,
            s.account,
            s.voucherId ?? '',
            s.lineId ?? '',
            new Decimal(s.amount).div(100).toNumber(),
            s.toRoute,
          ]);
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
}
