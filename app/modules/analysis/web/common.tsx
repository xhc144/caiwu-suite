import { Alert, Button, Space } from 'antd';
import { useState } from 'react';
import { downloadBlob, ActionAlert, useUrlFilters } from '@caiwu/ui';
import { getBusinessError } from '@caiwu/web-kit';
import { escapeHtml, printHtml } from '@caiwu/print';
import { periodOfDate } from '@caiwu/core';
import type { AgingReport, AgingRow } from '../shared';

export function ReportError({ error, retry }: { error: unknown; retry: () => void }) {
  const business = getBusinessError(error);
  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      <ActionAlert
        type="error"
        title={business?.message ?? '分析读取失败'}
        description={business?.hint ?? '请检查筛选条件后重试'}
        actions={business?.actions}
      />
      <Button onClick={retry}>重试查询</Button>
    </Space>
  );
}
export function NoPermission() {
  return (
    <Alert
      type="warning"
      showIcon
      title="没有查看此分析的权限"
      description="请联系账套管理员授予相应的分析查看权限后重新登录。"
    />
  );
}
export function downloadWorkbook(base64: string, fileName: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  downloadBlob(
    new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${fileName}.xlsx`,
  );
}
export async function printTable(
  title: string,
  description: string,
  headers: string[],
  rows: (string | number)[][],
) {
  await printHtml({
    title,
    orientation: 'landscape',
    html: `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><table><thead><tr>${headers.map((s) => `<th>${escapeHtml(s)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((s) => `<td>${escapeHtml(s)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
  });
}
export function ledgerLink(row: AgingRow, report: AgingReport) {
  const p = new URLSearchParams({
    account: row.accountCode,
    from: String(report.basePeriod),
    to: String(periodOfDate(report.filter.cutoff)),
    dims: JSON.stringify(row.dimensions),
    cutoff: report.filter.cutoff,
    includeUnposted: report.filter.includeUnposted ? '1' : '0',
    currency: row.currency,
  });
  return `/m/ledgers/detail?${p}`;
}

/** 筛选提交立即更新查询；壳的标签页 location 随后同步，URL 仍负责恢复与外部导航。 */
export function useReportFilters<V extends Record<string, string | number | boolean | undefined>>(
  defaults: V,
): [V, (next: Partial<V>) => void] {
  const [url, setUrl] = useUrlFilters(defaults);
  const [submitted, setSubmitted] = useState<{ source: V; value: V } | null>(null);
  const value = submitted?.source === url ? submitted.value : url;
  return [
    value,
    (next) => {
      const merged = { ...value, ...next };
      setSubmitted({ source: url, value: merged });
      setUrl(merged);
    },
  ];
}
