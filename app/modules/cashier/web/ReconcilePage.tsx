import { useState } from 'react';
import { Alert, Button, Descriptions, Form, Input, Select, Space, Typography } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { formatMoney } from '@caiwu/core';
import { useCurrentPeriod, usePermission } from '@caiwu/web-kit';
import { DataTable, FilterBar, PageContainer, useUrlFilters } from '@caiwu/ui';
import { safeSum } from '../shared';
import { api, refresh } from './api';
import { CashierNav, QueryState, useCashierConfirm, printRows } from './common';

export default function ReconcilePage() {
  const navigate = useNavigate();
  const period = useCurrentPeriod();
  const [filters, setFilters] = useUrlFilters({ accountId: 0, cutoff: '' });
  const accounts = useQuery(api.accounts.queryOptions({}));
  const accountId = filters.accountId || accounts.data?.[0]?.id || 0;
  const cutoff = filters.cutoff || period?.endDate || '';
  const result = useQuery(
    api.reconcile.queryOptions(
      { accountId, cutoff },
      { enabled: accountId > 0 && !!cutoff, retry: false },
    ),
  );
  const [docKeys, setDocKeys] = useState<React.Key[]>([]);
  const [lineKeys, setLineKeys] = useState<React.Key[]>([]);
  const canMatch = usePermission('cashier.reconcile');
  const [confirm, holder] = useCashierConfirm();
  const match = useMutation(
    api.match.mutationOptions({
      onSuccess: () => {
        setDocKeys([]);
        setLineKeys([]);
        void refresh();
      },
    }),
  );
  const unmatch = useMutation(api.unmatch.mutationOptions({ onSuccess: () => void refresh() }));
  const data = result.data;
  const error = result.error ?? accounts.error;
  const stale = result.isFetching || !!error;
  // 同一条件的后台刷新保留成功快照；查询键仍隔离账户/截止日，不能借用旧条件数据。
  const refetch = () => result.refetch({ cancelRefetch: false });
  const adjustmentRows = data
    ? [
        {
          key: 'opening',
          label: '期初余额（借正贷负）',
          cash: data.adjustment.cashOpening,
          core: data.adjustment.coreOpening,
        },
        {
          key: 'balance',
          label: '截止日余额（借正贷负）',
          cash: data.adjustment.cashBalance,
          core: data.adjustment.coreBalance,
        },
        {
          key: 'outstanding',
          label: '加：对侧未达净额',
          cash: data.adjustment.coreOutstanding,
          core: data.adjustment.cashOutstanding,
        },
        {
          key: 'adjusted',
          label: '调节后余额',
          cash: data.adjustment.adjustedCash,
          core: data.adjustment.adjustedCore,
        },
      ]
    : [];
  return (
    <PageContainer
      title="和账务对账"
      subtitle="出纳账—财务账核对；财务侧仅显示已过账且未作废的本账户分录"
    >
      <CashierNav />
      <FilterBar<{ accountId?: number; cutoff?: string }>
        key={`${accountId}-${cutoff}`}
        initialValues={{ accountId, cutoff }}
        onSearch={(v) => {
          setDocKeys([]);
          setLineKeys([]);
          setFilters({ accountId: v.accountId ?? 0, cutoff: v.cutoff ?? '' });
        }}
      >
        <Form.Item name="accountId" label="对账账户">
          <Select
            style={{ width: 200 }}
            options={accounts.data?.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Form.Item>
        <Form.Item name="cutoff" label="截止日">
          <Input type="date" />
        </Form.Item>
      </FilterBar>
      {!accountId && <Alert title="请先建立出纳账户及期初" type="info" />}
      <QueryState loading={!data && result.isFetching} error={data ? null : error} retry={refetch}>
        {data && (
          <>
            <Alert
              type="info"
              title={`${data.account.name} · ${data.account.currency} · 截止 ${data.cutoff}`}
              description="勾账只记录本模块匹配组。财务引用不能在出纳编辑或删除；点凭证号查看原凭证。"
            />
            {result.isFetching && (
              <div role="status" aria-live="polite">
                正在刷新，当前显示上次成功数据
              </div>
            )}
            {error && (
              <Alert
                type="error"
                showIcon
                title="刷新失败，当前仍显示上次成功数据"
                description={error.message}
                action={<Button onClick={() => void refetch()}>重试</Button>}
              />
            )}
            <Button
              loading={result.isFetching}
              disabled={result.isFetching}
              onClick={() => void refetch()}
            >
              刷新财务分录
            </Button>
            <Typography.Title level={5}>出纳待勾项目</Typography.Title>
            <DataTable
              tableId="cashier.reconcile.documents"
              rowKey="id"
              dataSource={data.documents}
              exportName="出纳对账项目"
              rowSelection={{
                selectedRowKeys: docKeys,
                onChange: setDocKeys,
                getCheckboxProps: (r) => ({ disabled: r.matchId != null }),
              }}
              columns={[
                { key: 'number', title: '单号', dataIndex: 'number', width: 130 },
                { key: 'date', title: '日期', dataIndex: 'date', width: 110 },
                { key: 'summary', title: '摘要', dataIndex: 'summary', width: 220 },
                { key: 'signed', title: '收款正／付款负', dataIndex: 'signed', money: true },
                { key: 'match', title: '勾账组', dataIndex: 'matchId', width: 100 },
              ]}
            />
            <Typography.Title level={5}>财务只读引用</Typography.Title>
            <DataTable
              tableId="cashier.reconcile.entries"
              rowKey="lineId"
              dataSource={data.entries}
              exportName="财务只读分录"
              rowSelection={{
                selectedRowKeys: lineKeys,
                onChange: setLineKeys,
                getCheckboxProps: (r) => ({ disabled: r.matchId != null }),
              }}
              columns={[
                {
                  key: 'voucher',
                  title: '凭证',
                  width: 140,
                  exportValue: (r) => r.displayNo,
                  render: (_, r) => (
                    <Button
                      type="link"
                      onClick={() => void navigate(`/m/voucher-entry/edit?id=${r.voucherId}`)}
                    >
                      {r.displayNo}
                    </Button>
                  ),
                },
                { key: 'date', title: '日期', dataIndex: 'date', width: 110 },
                { key: 'summary', title: '摘要', dataIndex: 'summary', width: 220 },
                { key: 'signed', title: '借方正／贷方负', dataIndex: 'signed', money: true },
                { key: 'match', title: '勾账组', dataIndex: 'matchId', width: 100 },
                {
                  key: 'source',
                  title: '来源',
                  width: 150,
                  noExport: true,
                  render: (_, r) =>
                    r.sourceTo ? (
                      <Button type="link" onClick={() => void navigate(r.sourceTo!)}>
                        查看出纳来源
                      </Button>
                    ) : (
                      '账务凭证（只读）'
                    ),
                },
              ]}
            />
            <Space style={{ marginTop: 12 }}>
              <span>
                所选出纳净额：
                {formatMoney(
                  safeSum(
                    data.documents.filter((d) => docKeys.includes(d.id)).map((d) => d.signed),
                  ),
                )}
                ；财务净额：
                {formatMoney(
                  safeSum(
                    data.entries.filter((e) => lineKeys.includes(e.lineId)).map((e) => e.signed),
                  ),
                )}
              </span>
              {canMatch && (
                <Button
                  type="primary"
                  disabled={stale || !docKeys.length || !lineKeys.length}
                  loading={match.isPending}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: '确认手动等额勾账',
                        content: `出纳 ${docKeys.length} 项，财务 ${lineKeys.length} 项；提交时会重新检查金额和凭证状态。`,
                        confirmText: '勾账',
                      })
                    )
                      match.mutate({
                        accountId,
                        cutoff,
                        documents: data.documents
                          .filter((d) => docKeys.includes(d.id))
                          .map((d) => ({ id: d.id, revision: d.revision })),
                        lineIds: data.entries
                          .filter((e) => lineKeys.includes(e.lineId))
                          .map((e) => e.lineId),
                        snapshot: data.snapshot,
                        confirmed: true,
                      });
                  }}
                >
                  确认手动勾账
                </Button>
              )}
            </Space>
            <Typography.Title level={5}>勾账组</Typography.Title>
            <DataTable
              tableId="cashier.matches"
              rowKey="id"
              dataSource={data.groups}
              columns={[
                { key: 'id', title: '组号', dataIndex: 'id', width: 80 },
                { key: 'documents', title: '单据', dataIndex: 'documents', width: 240 },
                { key: 'vouchers', title: '凭证', dataIndex: 'vouchers', width: 200 },
                { key: 'amount', title: '净额', dataIndex: 'amount', money: true },
                {
                  key: 'valid',
                  title: '校验',
                  width: 120,
                  render: (_, r) => (r.valid ? '金额及状态正常' : '异常，请检查原凭证'),
                },
                {
                  key: 'actions',
                  title: '操作',
                  width: 140,
                  noExport: true,
                  render: (_, r) =>
                    canMatch && (
                      <Button
                        disabled={stale}
                        loading={unmatch.isPending}
                        onClick={async () => {
                          if (
                            await confirm({
                              title: `取消勾账组 ${r.id}`,
                              content:
                                '仅释放本组项目，不改变任何单据、凭证或余额。异常组会阻止取消。',
                              confirmText: '取消勾账',
                            })
                          )
                            unmatch.mutate({ id: r.id, confirmed: true });
                        }}
                      >
                        取消勾账
                      </Button>
                    ),
                },
              ]}
            />
            <Typography.Title level={4}>截止日余额调节表</Typography.Title>
            <Alert
              type={data.adjustment.openingDifference === 0 ? 'info' : 'warning'}
              title={`期初差额：${formatMoney(data.adjustment.openingDifference)}；调节后差额：${formatMoney(data.adjustment.difference)}`}
              description="公式：出纳余额＋财务未达净额＝财务余额＋出纳未达净额。此表核对同账套两种业务记录，不代表与银行外部对账完成。"
            />
            <DataTable
              tableId="cashier.adjustment"
              rowKey="key"
              dataSource={adjustmentRows}
              exportName="出纳账与财务账余额调节表"
              columns={[
                { key: 'label', title: '项目', dataIndex: 'label', width: 240 },
                { key: 'cash', title: '出纳账', dataIndex: 'cash', money: true },
                { key: 'core', title: '财务账', dataIndex: 'core', money: true },
              ]}
            />
            <Descriptions
              size="small"
              items={[
                {
                  key: 'cash',
                  label: '出纳未达项',
                  children: `${data.adjustment.cashOutstandingIds.length} 项`,
                },
                {
                  key: 'core',
                  label: '财务未达项',
                  children: `${data.adjustment.coreOutstandingIds.length} 项`,
                },
              ]}
            />
            <Button
              onClick={() =>
                printRows(
                  `出纳账—财务账余额调节表 ${data.account.name} ${data.cutoff} ${data.account.currency}`,
                  ['项目', '出纳账', '财务账'],
                  adjustmentRows.map((r) => [r.label, r.cash, r.core]),
                )
              }
            >
              打印余额调节表
            </Button>
          </>
        )}
      </QueryState>
      {holder}
    </PageContainer>
  );
}
