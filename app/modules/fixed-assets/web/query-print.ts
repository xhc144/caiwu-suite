import { formatMoney } from '@caiwu/core';
import { escapeHtml } from '@caiwu/print';
import type { Outputs } from './api';

/** 输出当前成功查询的完整结果；用户输入只作为转义后的正文。 */
export function depreciationPrint(
  result: Outputs['query'],
  range: { from: number; to: number; departmentLevel: string; categoryLevel: string },
  kind: 'detail' | 'distribution',
) {
  const title = kind === 'detail' ? '折旧查询' : '折旧分布表';
  const rows =
    kind === 'detail'
      ? result.rows.map((r) => [
          String(r.period),
          r.code,
          r.name,
          r.department,
          r.category,
          r.purpose,
          r.work,
          formatMoney(r.amount),
          r.issue,
        ])
      : result.distribution.map((r) => [r.group, formatMoney(r.amount)]);
  if (!rows.length) throw new Error('没有记录，无法打印及预览');
  const columns =
    kind === 'detail'
      ? ['月份', '设备编号', '设备名称', '部门', '类别', '用途', '月工作量', '折旧额（元）', '说明']
      : ['部门 / 资产类别', '折旧额（元）'];
  const grouping = `${range.departmentLevel === 'top' ? '部门大类' : '明细部门'} / ${range.categoryLevel === 'top' ? '资产大类' : '资产细类'}`;
  return {
    title,
    orientation: 'landscape' as const,
    html: `<h2>${title}</h2><p>期间：${escapeHtml(range.from)} 至 ${escapeHtml(range.to)}；${escapeHtml(grouping)}</p><table><thead><tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('')}</tbody></table><p>合计：${formatMoney(result.total)} 元；共 ${rows.length} 条</p>`,
  };
}
