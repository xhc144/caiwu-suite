import { useState } from 'react';
import { Alert, Button, Drawer, Form, Input, InputNumber, Select, Space, Tag } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { balanceSide, formatMoney } from '@caiwu/core';
import { useCurrentPeriod, usePermission, useRequiredSession } from '@caiwu/web-kit';
import {
  AccountSelect,
  DataTable,
  FilterBar,
  MoneyInput,
  PageContainer,
  PeriodPicker,
  useUrlFilters,
  type DataColumn,
} from '@caiwu/ui';
import { safeSum } from '../shared';
import { api, refresh, type CashAccount } from './api';
import { CashierNav, QueryState } from './common';

export default function AccountsPage() {
  const status = useQuery(api.status.queryOptions());
  const current = useCurrentPeriod();
  const { book } = useRequiredSession();
  const [filters, setFilters] = useUrlFilters({ year: 0 });
  const list = useQuery(api.accounts.queryOptions({ year: filters.year || undefined }));
  const canEdit = usePermission('cashier.account.edit');
  const enable = useMutation(api.enable.mutationOptions({ onSuccess: () => void refresh() }));
  const disable = useMutation(api.setDisabled.mutationOptions({ onSuccess: () => void refresh() }));
  const [period, setPeriod] = useState<number>();
  const [editing, setEditing] = useState<CashAccount | 'new' | null>(null);
  const columns: DataColumn<CashAccount>[] = [
    { key: 'name', title: '账户', dataIndex: 'name', width: 180 },
    {
      key: 'code',
      title: '关联科目',
      width: 220,
      render: (_, r) => `${r.code} ${r.coreName}`,
      exportValue: (r) => `${r.code} ${r.coreName}`,
    },
    { key: 'currency', title: '币种', dataIndex: 'currency', width: 80 },
    { key: 'period', title: '期初期间', dataIndex: 'period', width: 110 },
    {
      key: 'opening',
      title: '出纳期初（借正贷负）',
      dataIndex: 'opening',
      money: true,
      render: (_, r) =>
        `${balanceSide(r.opening, 'debit').side} ${formatMoney(Math.abs(r.opening))}`,
    },
    { key: 'coreOpening', title: '账务期初（只读）', dataIndex: 'coreOpening', money: true },
    {
      key: 'diff',
      title: '期初差额',
      money: true,
      render: (_, r) => formatMoney(safeSum([r.opening, -r.coreOpening])),
      exportValue: (r) => safeSum([r.opening, -r.coreOpening]),
    },
    {
      key: 'disabled',
      title: '状态',
      width: 90,
      render: (_, r) => <Tag>{r.disabled ? '停用' : '启用'}</Tag>,
      exportValue: (r) => (r.disabled ? '停用' : '启用'),
    },
    {
      key: 'actions',
      title: '操作',
      width: 170,
      noExport: true,
      render: (_, r) =>
        canEdit && (
          <Space>
            <Button onClick={() => setEditing(r)}>修改</Button>
            <Button
              loading={disable.isPending}
              onClick={() =>
                disable.mutate({ id: r.id, revision: r.revision, disabled: !r.disabled })
              }
            >
              {r.disabled ? '启用' : '停用'}
            </Button>
          </Space>
        ),
    },
  ];
  return (
    <PageContainer
      title="出纳账户与期初"
      subtitle="独立保存出纳期初，账务期初仅核对；首次发生业务后锁定初值"
      extra={
        canEdit &&
        status.data?.period && (
          <Button type="primary" onClick={() => setEditing('new')}>
            新增账户
          </Button>
        )
      }
    >
      <CashierNav />
      <QueryState loading={status.isLoading} error={status.error} retry={status.refetch}>
        {status.data?.period == null ? (
          <Alert
            type="info"
            title="首次启用出纳"
            description={
              <Space orientation="vertical">
                <span>选择启用期间，保存后再建立现金或银行账户。再次进入会保留全部历史。</span>
                <PeriodPicker
                  aria-label="出纳启用期间"
                  value={period ?? current?.period}
                  onChange={setPeriod}
                />
                {canEdit && (
                  <Button
                    type="primary"
                    loading={enable.isPending}
                    onClick={() =>
                      enable.mutate({ period: period ?? current?.period ?? book.startPeriod })
                    }
                  >
                    保存启用状态
                  </Button>
                )}
              </Space>
            }
          />
        ) : (
          <Alert type="success" title={`出纳已启用：${status.data.period}；历史数据已保留`} />
        )}
      </QueryState>
      <FilterBar<{ year?: number }>
        initialValues={{ year: filters.year || undefined }}
        onSearch={(v) => setFilters({ year: v.year ?? 0 })}
      >
        <Form.Item label="期初年度" name="year">
          <InputNumber min={1900} max={9999} placeholder="启用年度" />
        </Form.Item>
      </FilterBar>
      <QueryState loading={list.isLoading} error={list.error} retry={list.refetch}>
        <DataTable
          tableId="cashier.accounts"
          rowKey="id"
          columns={columns}
          dataSource={list.data ?? []}
          exportName="出纳账户期初"
          locale={{ emptyText: '请先启用出纳，再新增现金或银行账户' }}
        />
      </QueryState>
      {editing && <AccountDrawer account={editing} onClose={() => setEditing(null)} />}
    </PageContainer>
  );
}
function AccountDrawer({
  account,
  onClose,
}: {
  account: CashAccount | 'new';
  onClose: () => void;
}) {
  const [form] = Form.useForm<{
    name: string;
    coreAccountId: number;
    currency: string;
    opening: number;
  }>();
  const { book } = useRequiredSession();
  const save = useMutation(
    api.saveAccount.mutationOptions({
      onSuccess: () => {
        void refresh();
        onClose();
      },
    }),
  );
  return (
    <Drawer
      open
      title={account === 'new' ? '新增出纳账户' : '修改账户配置'}
      onClose={onClose}
      size={480}
    >
      <Alert type="info" title="使用后关联科目、币种、期初不可改；停用保留历史。当前支持本位币。" />
      <Form
        form={form}
        layout="vertical"
        initialValues={account === 'new' ? { currency: book.baseCurrency, opening: 0 } : account}
        onFinish={(data) =>
          save.mutate({
            data,
            edit: account === 'new' ? undefined : { id: account.id, revision: account.revision },
          })
        }
      >
        <Form.Item name="name" label="账户名称" rules={[{ required: true }]}>
          <Input autoFocus maxLength={80} />
        </Form.Item>
        <Form.Item name="coreAccountId" label="关联现金银行科目" rules={[{ required: true }]}>
          <AccountSelect filter={(a) => (a.isCash || a.isBank) && a.isLeaf && !a.currency} />
        </Form.Item>
        <Form.Item name="currency" label="币种" rules={[{ required: true }]}>
          <Select options={[{ value: book.baseCurrency, label: book.baseCurrency }]} />
        </Form.Item>
        <Form.Item name="opening" label="出纳期初（借正贷负）" rules={[{ required: true }]}>
          <MoneyInput />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={save.isPending}>
          保存账户
        </Button>
      </Form>
    </Drawer>
  );
}
