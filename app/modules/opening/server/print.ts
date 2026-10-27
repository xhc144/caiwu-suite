import { formatMoney } from '@caiwu/core';
import type { CoreServices } from '@caiwu/core/server';
import {
  exactSum,
  openingDimensions,
  selectOpeningRows,
  yearStart,
  type OpeningScope,
} from '../shared';
import { fail, openingService } from './service';

// 服务端不引用包含浏览器驱动的 @caiwu/print；返回纯数据交给前端驱动。
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 只打印持久化的末级明细；读取在同一事务内形成快照，不写期初或锁状态。 */
export async function openingPrint(svc: CoreServices, scope: OpeningScope) {
  svc.permissions.require('opening.view');
  return svc.tx(async (tsvc) => {
    const data = await openingService(tsvc).list(scope.year);
    const selectedItem = scope.item
      ? data.items.find((i) => String(i.id) === scope.item && i.typeId === scope.dimension)
      : null;
    if (scope.item && !selectedItem)
      fail(
        'OPENING_PRINT_ITEM',
        '辅助档案与当前期初视图不匹配',
        '请选择当前辅助类型的真实档案，或清除档案筛选',
      );
    const rows = selectOpeningRows(data.accounts, data.rows, scope);
    if (!rows.length)
      fail(
        'OPENING_PRINT_EMPTY',
        '当前条件下没有已保存的期初明细',
        '请先保存期初，或调整科目、币种及辅助条件',
      );
    const dimension = openingDimensions.find((d) => d.id === scope.dimension);
    const title = `${scope.year} 年${dimension ? dimension.name : '科目'}期初余额`;
    const amount = (value: number) => `<td class="num">${escapeHtml(formatMoney(value))}</td>`;
    const lines = rows.map((row) => {
      const account = data.accounts.find((a) => a.id === row.accountId)!;
      const auxiliary =
        openingDimensions
          .flatMap((d) => {
            const id = row.dimensions[d.id];
            if (id == null) return [];
            const item = data.items.find((i) => i.id === id && i.typeId === d.id);
            return [`${d.name}：${item ? `${item.code} ${item.name}` : `档案 ${id}（已不存在）`}`];
          })
          .join('；') || '无辅助';
      return `<tr data-opening-id="${row.id}"><td>${escapeHtml(`${account.code} ${account.fullName}`)}</td><td>${escapeHtml(auxiliary)}</td><td>${escapeHtml(row.currency || data.book.baseCurrency)}</td>${amount(yearStart(row))}${amount(row.ytdDebit)}${amount(row.ytdCredit)}${amount(row.balance)}${amount(row.fcBalance)}<td class="num">${escapeHtml(`${row.quantity}${account.quantityUnit ? ` ${account.quantityUnit}` : ''}`)}</td></tr>`;
    });
    const headings = [
      '科目',
      '辅助组合',
      '币种',
      '年初本位币',
      '账前累计借方',
      '账前累计贷方',
      '启用本位币',
      '外币启用余额',
      '启用数量',
    ];
    const totals = [
      exactSum(rows.map(yearStart)),
      exactSum(rows.map((r) => r.ytdDebit)),
      exactSum(rows.map((r) => r.ytdCredit)),
      exactSum(rows.map((r) => r.balance)),
    ];
    return {
      title,
      pageSize: 'A4' as const,
      orientation: 'landscape' as const,
      marginMm: 10,
      html: `<h1>${escapeHtml(title)}</h1><p>单位：${escapeHtml(data.book.orgName)}；起算期间：${data.fiscal.opening_period}；本位币：${escapeHtml(data.book.baseCurrency)}</p><p>范围：${escapeHtml(scope.currency === 'base' ? '仅本位币' : scope.currency || '全部币种')}；科目：${escapeHtml(scope.account || '全部')}；${scope.quantity ? '仅数量科目' : '全部科目'}；${escapeHtml(dimension ? `${dimension.name}辅助明细` : '全部辅助组合')}；档案：${escapeHtml(selectedItem ? `${selectedItem.code} ${selectedItem.name}` : '全部')}。共 ${rows.length} 条已保存末级明细。</p><p>余额借正贷负，金额单位为元；年初 + 账前借方 − 账前贷方 = 启用余额。只汇总末级明细，外币及不同单位数量不混加。</p><table><colgroup><col style="width:16%"><col style="width:18%"><col style="width:6%">${Array.from({ length: 6 }, () => '<col style="width:10%">').join('')}</colgroup><thead><tr>${headings.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${lines.join('')}</tbody><tfoot><tr><td colspan="3">本位币合计（借正贷负）</td>${totals.map(amount).join('')}<td>不合计</td><td>不合计</td></tr></tfoot></table>`,
      css: 'h1{font-size:18px;text-align:center}p{line-height:1.6}th,td{font-size:11px;line-height:1.5;vertical-align:top}thead{display:table-header-group}tfoot{display:table-row-group}tr{break-inside:avoid}td.num{white-space:normal;overflow-wrap:anywhere}',
    };
  });
}
