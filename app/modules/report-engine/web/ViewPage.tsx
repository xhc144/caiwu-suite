import { Alert, Button, Checkbox, Empty, Form, Modal, Select, Space, Spin, Tag } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { formatPeriod } from '@caiwu/core';
import { printHtml } from '@caiwu/print';
import { queryClient, useCurrentPeriod, usePeriods, usePermission } from '@caiwu/web-kit';
import { FilterBar, PageContainer, downloadBlob, useUrlFilters } from '@caiwu/ui';
import type { GenerateSchema } from '../shared';
import type { z } from 'zod';
import { api } from './api';
import { ReportGrid } from './Grid';
import { reportHtml } from './print';

type Pending = {
  input: z.input<typeof GenerateSchema>;
  count: number;
  links: { label: string; to: string }[];
};
export default function ViewPage() {
  const current = useCurrentPeriod();
  const [filters, setFilters] = useUrlFilters<{
    id: number;
    period: number;
    includeUnposted: boolean;
  }>({
    id: 0,
    period: current?.period ?? 202601,
    includeUnposted: false,
  });
  const valid = filters.id > 0 && Number.isSafeInteger(filters.id);
  const report = useQuery({ ...api.get.queryOptions({ id: filters.id }), enabled: valid });
  const selection = {
    id: filters.id,
    period: filters.period,
    includeUnposted: filters.includeUnposted,
  };
  const snapshot = useQuery({ ...api.snapshot.queryOptions(selection), enabled: valid });
  const periods = usePeriods();
  const canGenerate = usePermission('report-engine.generate');
  const canExport = usePermission('report-engine.export');
  const [pending, setPending] = useState<Pending | null>(null);
  const [working, setWorking] = useState(false);
  const [exportError, setExportError] = useState('');
  const generate = useMutation(
    api.generate.mutationOptions({
      onSuccess: (r, input) => {
        if (r.kind === 'confirmation') {
          setPending({ input, count: r.count, links: r.links });
          return;
        }
        setPending(null);
        queryClient.setQueryData(
          api.snapshot.queryKey({
            id: input.id,
            period: input.period,
            includeUnposted: input.includeUnposted,
          }),
          r.snapshot,
        );
      },
    }),
  );
  const start = () => {
    if (report.data)
      generate.mutate({
        ...selection,
        expectedRevision: report.data.revision,
        confirmUnposted: false,
        requestId: crypto.randomUUID(),
      });
  };
  const exportOrPrint = async (print: boolean) => {
    setWorking(true);
    setExportError('');
    try {
      const data = await queryClient.fetchQuery({
        ...api.exportResult.queryOptions(selection),
        staleTime: 0,
      });
      if (!data || !data.snapshot.cells.some((c) => c.value.trim() !== '')) {
        setExportError('所选期间还没有生成有效结果，请先生成报表');
        return;
      }
      if (print)
        await printHtml({
          title: `${data.snapshot.template.name}-${data.snapshot.period}`,
          html: reportHtml(data.snapshot),
        });
      else
        downloadBlob(
          new Blob([Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0))], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          }),
          `${data.snapshot.template.code}-${data.snapshot.period}.xlsx`,
        );
    } catch (e) {
      setExportError(e instanceof Error ? e.message : '导出或打印失败，请重试');
    } finally {
      setWorking(false);
    }
  };
  const s = snapshot.data;
  return (
    <PageContainer
      title={`报表生成${report.data ? `：${report.data.template.name}` : ''}`}
      subtitle="每次生成在同一账套事务中重新读取真实总账；下方展示已保存的期间结果和生成时间。"
      extra={<a href={`/m/report-engine/designer?id=${filters.id}`}>返回定义</a>}
    >
      <FilterBar<{ period: number; includeUnposted: boolean }>
        initialValues={filters}
        onSearch={(v) => {
          setPending(null);
          setFilters({ period: v.period, includeUnposted: v.includeUnposted ?? false });
          window.location.reload();
        }}
      >
        <Form.Item name="period" label="生成期间">
          <Select
            aria-label="生成期间"
            style={{ width: 170 }}
            options={periods.periods.map((p) => ({
              value: p.period,
              label: formatPeriod(p.period),
            }))}
          />
        </Form.Item>
        <Form.Item name="includeUnposted" valuePropName="checked">
          <Checkbox>显式包含未过账（待审核/已审核）</Checkbox>
        </Form.Item>
      </FilterBar>
      <Space wrap style={{ marginBlock: 12 }}>
        {canGenerate && (
          <Button
            type="primary"
            loading={generate.isPending}
            disabled={!report.data}
            onClick={start}
          >
            生成/重算
          </Button>
        )}
        {canExport && (
          <>
            <Button disabled={!s} loading={working} onClick={() => void exportOrPrint(false)}>
              导出 Excel
            </Button>
            <Button disabled={!s} loading={working} onClick={() => void exportOrPrint(true)}>
              打印
            </Button>
          </>
        )}
        <Tag color={filters.includeUnposted ? 'orange' : 'blue'}>
          {filters.includeUnposted ? '含待审核和已审核（不含草稿/作废）' : '仅已过账'}
        </Tag>
      </Space>
      {(report.isError || snapshot.isError || generate.isError || exportError) && (
        <Alert
          type="error"
          showIcon
          title={exportError || generate.error?.message || '读取报表失败，请返回列表重试'}
          description="失败操作不会覆盖上次成功结果。"
        />
      )}
      {(report.isLoading || snapshot.isLoading) && <Spin />}
      {s ? (
        <>
          <p>
            已保存结果：{formatPeriod(s.period)} · {s.generatedAt} · 定义版本 {s.revision} ·
            生成时未过账 {s.unpostedCount} 张
          </p>
          <Alert
            type={s.includeUnposted || s.unpostedCount ? 'warning' : 'info'}
            title={
              s.includeUnposted
                ? '本结果包含待审核和已审核凭证，不含草稿与作废凭证'
                : '本结果只含已过账凭证'
            }
            description="金额显示元，底层为整数分；有符号余额借正贷负，按正常方向取值由公式明确指定。总账后续发生变化，请点击重算。"
          />
          {report.data && s.revision !== report.data.revision && (
            <Alert type="warning" title="定义已更新，当前为上次生成结果，请重算" />
          )}
          <ReportGrid template={s.template} snapshot={s} />
          {s.checks.length > 0 && (
            <>
              <h3>审核结果</h3>
              {s.checks.map((c, i) => (
                <Alert
                  key={i}
                  style={{ marginBottom: 8 }}
                  type={c.status === 'pass' ? 'success' : c.status === 'fail' ? 'warning' : 'error'}
                  title={`${c.name}：${c.status === 'pass' ? '通过' : c.status === 'fail' ? '不通过' : '错误'}`}
                  description={`差额 ${c.difference ?? '无法计算'}；阈值 ${c.tolerance}（金额为分）${c.reason ? `；${c.reason}` : ''}`}
                />
              ))}
            </>
          )}
          <p>
            本次依赖定义：{s.dependencies.map((d) => `${d.code}（版本${d.revision}）`).join('、')}
          </p>
          <Space wrap>
            {s.template.cells
              .filter((c) => c.kind === 'formula')
              .map((c) => {
                const m = /BALANCE\("(\d+)"/.exec(c.source);
                return (
                  m && (
                    <Link
                      key={c.address}
                      to={`/m/ledgers/detail?account=${m[1]}&from=${s.period}&to=${s.period}`}
                    >
                      {c.address} 查看科目 {m[1]} 明细
                    </Link>
                  )
                );
              })}
          </Space>
        </>
      ) : (
        !snapshot.isLoading && <Empty description="所选期间和口径尚未生成报表" />
      )}
      <Modal
        open={pending != null}
        title="生成前发现未过账凭证"
        okText="按所选口径继续生成"
        cancelText="取消"
        confirmLoading={generate.isPending}
        onCancel={() => setPending(null)}
        onOk={() => pending && generate.mutate({ ...pending.input, confirmUnposted: true })}
      >
        <p>
          截至所选期间有 {pending?.count ?? 0} 张未过账凭证（含草稿）。
          {pending?.input.includeUnposted
            ? '继续将纳入待审核和已审核凭证，草稿仍不计入。'
            : '继续仅统计已过账凭证，这些未过账凭证不计入。'}
        </p>
        <Space>
          {pending?.links.map((link) => (
            <Link key={link.to} to={link.to}>
              {link.label}
            </Link>
          ))}
        </Space>
      </Modal>
    </PageContainer>
  );
}
