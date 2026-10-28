import { useRef, useState } from 'react';
import { Alert, Button, Drawer, Form, Input, InputNumber, Select, Space, Tag } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { balanceSide, formatMoney } from '@caiwu/core';
import {
  coreApi,
  useAccounts,
  useCurrentPeriod,
  usePermission,
  useRequiredSession,
} from '@caiwu/web-kit';
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
import { useCashierEditor } from './useCashierEditor';
import ResetDrawer from './ResetDrawer';

export default function AccountsPage() {
  const status = useQuery(api.status.queryOptions());
  const current = useCurrentPeriod();
  const { book } = useRequiredSession();
  const [filters, setFilters] = useUrlFilters({ year: 0 });
  const list = useQuery(api.accounts.queryOptions({ year: filters.year || undefined }));
  const canEdit = usePermission('cashier.account.edit');
  const canReset = usePermission('cashier.reset');
  const [resetting, setResetting] = useState(false);
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
    { key: 'foreignOpening', title: '原币期初', dataIndex: 'foreignOpening', money: true },
    {
      key: 'coreForeignOpening',
      title: '账务原币期初（只读）',
      dataIndex: 'coreForeignOpening',
      money: true,
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
            <Button disabled={r.period !== status.data?.period} onClick={() => setEditing(r)}>
              修改
            </Button>
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
          <Space>
            <Button type="primary" onClick={() => setEditing('new')}>
              新增账户
            </Button>
            {canReset && (
              <Button danger onClick={() => setResetting(true)}>
                重新初始化出纳
              </Button>
            )}
          </Space>
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
      {resetting && <ResetDrawer onClose={() => setResetting(false)} />}
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
    foreignOpening: number | null;
  }>();
  const { book } = useRequiredSession();
  const { byId } = useAccounts();
  const currencies = useQuery(coreApi.reference.currencies.queryOptions());
  const selectedCurrency =
    Form.useWatch('currency', form) ?? (account === 'new' ? book.baseCurrency : account.currency);
  const edit = useRef(
    account === 'new' ? undefined : { id: account.id, revision: account.revision },
  );
  const save = useMutation(api.saveAccount.mutationOptions());
  const editor = useCashierEditor({
    form,
    title: '出纳账户与期初',
    fields: selectedCurrency === book.baseCurrency ? ['opening'] : ['opening', 'foreignOpening'],
    onClose,
    onSave: async (values) => {
      const data = {
        ...values,
        foreignOpening: values.currency === book.baseCurrency ? null : values.foreignOpening,
      };
      const result = await save.mutateAsync({ data, edit: edit.current });
      edit.current = { id: result.id, revision: (edit.current?.revision ?? 0) + 1 };
      void refresh();
    },
  });
  return (
    <Drawer
      open
      title={account === 'new' ? '新增出纳账户' : '修改账户配置'}
      onClose={editor.close}
      size={480}
    >
      <Alert
        type="info"
        title="使用后关联科目、币种、期初不可改；停用保留历史。外币账户同时保存原币和本位币期初。"
      />
      {editor.savedEarlier && (
        <Alert type="info" title="先前内容已保存，保存期间的新修改仍未保存。" />
      )}
      <Form
        form={form}
        layout="vertical"
        initialValues={
          account === 'new'
            ? { currency: book.baseCurrency, opening: 0, foreignOpening: null }
            : account
        }
        onValuesChange={(changed) => {
          editor.changed();
          if (changed.coreAccountId != null) {
            const currency = byId.get(changed.coreAccountId)?.currency ?? book.baseCurrency;
            if (currency === book.baseCurrency) editor.money.reset('foreignOpening');
            form.setFieldsValue({
              currency,
              foreignOpening:
                currency === book.baseCurrency ? null : (form.getFieldValue('foreignOpening') ?? 0),
            });
          }
        }}
        onFinish={() => void editor.save()}
      >
        <Form.Item name="name" label="账户名称" rules={[{ required: true }]}>
          <Input autoFocus maxLength={80} />
        </Form.Item>
        <Form.Item name="coreAccountId" label="关联现金银行科目" rules={[{ required: true }]}>
          <AccountSelect filter={(a) => (a.isCash || a.isBank) && a.isLeaf && !a.disabled} />
        </Form.Item>
        <Form.Item name="currency" label="币种" rules={[{ required: true }]}>
          <Select
            options={currencies.data
              ?.filter((c) => !c.disabled)
              .map((c) => ({ value: c.code, label: `${c.code} ${c.name}` }))}
          />
        </Form.Item>
        <Form.Item
          name="opening"
          label="出纳期初（借正贷负）"
          rules={[{ required: true }, editor.money.rule('opening')]}
        >
          <MoneyInput {...editor.money.input('opening')} />
        </Form.Item>
        {selectedCurrency !== book.baseCurrency && (
          <Form.Item
            name="foreignOpening"
            label="原币期初（借正贷负）"
            rules={[{ required: true }, editor.money.rule('foreignOpening')]}
          >
            <MoneyInput {...editor.money.input('foreignOpening')} />
          </Form.Item>
        )}
        <Button
          type="primary"
          htmlType="submit"
          aria-label="保存账户"
          loading={editor.isSubmitting}
        >
          保存账户
        </Button>
        <Button onClick={editor.close}>取消</Button>
      </Form>
      {editor.holder}
    </Drawer>
  );
}
