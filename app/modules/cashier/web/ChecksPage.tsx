import { useState } from 'react';
import { Alert, Button, Drawer, Form, Input, Select, Space } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { today } from '@caiwu/core';
import { useAccounts, usePermission } from '@caiwu/web-kit';
import { DataTable, MoneyInput, PageContainer } from '@caiwu/ui';
import { api, refresh, type Outputs } from './api';
import { CashierNav, QueryState, useCashierConfirm } from './common';
import { useCashierEditor } from './useCashierEditor';

type Check = Outputs['checks'][number];
const labels = { received: '已领用', issued: '已签发', cleared: '已兑付', voided: '已作废' };
type Edit = { action: 'receive' } | { action: 'issue' | 'cleared' | 'voided'; row: Check };
export default function ChecksPage() {
  const list = useQuery(api.checks.queryOptions({}));
  const coreAccounts = useAccounts();
  const accounts = useQuery(api.accounts.queryOptions({}));
  const canEdit = usePermission('cashier.check.edit');
  const canSettle = usePermission('cashier.check.settle');
  const [editing, setEditing] = useState<Edit | null>(null);
  return (
    <PageContainer
      title="支票登记簿"
      subtitle="领用、签发、兑付与作废留痕；登记不自动生成收付单或凭证"
    >
      <CashierNav />
      <Space style={{ marginBottom: 12 }}>
        {canEdit && (
          <Button type="primary" onClick={() => setEditing({ action: 'receive' })}>
            领用支票
          </Button>
        )}
        <Button onClick={() => void list.refetch()}>刷新支票登记簿</Button>
      </Space>
      <QueryState loading={list.isLoading} error={list.error} retry={list.refetch}>
        <DataTable
          tableId="cashier.checks"
          rowKey="id"
          dataSource={list.data ?? []}
          exportName="支票登记簿"
          columns={[
            { key: 'account', title: '银行账户', dataIndex: 'accountName', width: 180 },
            { key: 'number', title: '票号', dataIndex: 'number', width: 150 },
            { key: 'received', title: '领用日期', dataIndex: 'received_date', width: 120 },
            { key: 'issued', title: '签发日期', dataIndex: 'issued_date', width: 120 },
            { key: 'payee', title: '收款人', dataIndex: 'payee', width: 180 },
            { key: 'amount', title: '金额', dataIndex: 'amount', money: true },
            {
              key: 'state',
              title: '状态',
              width: 100,
              render: (_, r) => labels[r.state],
              exportValue: (r) => labels[r.state],
            },
            { key: 'finished', title: '兑付／作废日期', dataIndex: 'finished_date', width: 150 },
            { key: 'note', title: '备注', dataIndex: 'note', width: 180 },
            {
              key: 'actions',
              title: '操作',
              width: 190,
              noExport: true,
              render: (_, r) => (
                <Space>
                  {canEdit && r.state === 'received' && (
                    <Button onClick={() => setEditing({ action: 'issue', row: r })}>签发</Button>
                  )}
                  {canSettle && r.state === 'issued' && (
                    <Button onClick={() => setEditing({ action: 'cleared', row: r })}>
                      登记兑付
                    </Button>
                  )}
                  {canSettle && (r.state === 'received' || r.state === 'issued') && (
                    <Button danger onClick={() => setEditing({ action: 'voided', row: r })}>
                      作废
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </QueryState>
      {editing && (
        <CheckDrawer
          editing={editing}
          accounts={(accounts.data ?? []).filter(
            (a) => coreAccounts.byId.get(a.coreAccountId)?.isBank,
          )}
          onClose={() => setEditing(null)}
        />
      )}
    </PageContainer>
  );
}
function CheckDrawer({
  editing,
  accounts,
  onClose,
}: {
  editing: Edit;
  accounts: Outputs['accounts'];
  onClose: () => void;
}) {
  const title =
    editing.action === 'receive'
      ? '领用支票'
      : editing.action === 'issue'
        ? '签发支票'
        : editing.action === 'cleared'
          ? '登记兑付'
          : '作废支票';
  const [confirm, holder] = useCashierConfirm();
  const [form] = Form.useForm<{
    accountId: number;
    number: string;
    date: string;
    payee: string;
    amount: number;
    note: string;
  }>();
  const receive = useMutation(api.receiveCheck.mutationOptions());
  const issue = useMutation(api.issueCheck.mutationOptions());
  const finish = useMutation(api.finishCheck.mutationOptions());
  const editor = useCashierEditor({
    form,
    title,
    fields: editing.action === 'issue' ? ['amount'] : [],
    onClose,
    onSave: async (v) => {
      if (editing.action === 'receive') {
        await receive.mutateAsync({
          accountId: v.accountId,
          number: v.number,
          receivedDate: v.date,
          note: v.note ?? '',
        });
      } else {
        const accepted = await confirm({
          title: `${title} ${editing.row.number}`,
          content:
            editing.action === 'issue'
              ? '请核对收款人、金额和日期。签发后不能改写票面资料。'
              : '请核对真实银行办理结果。已兑付或作废后不能再变更状态。',
          confirmText: title,
        });
        if (!accepted) throw new Error('已取消支票登记');
        if (editing.action === 'issue')
          await issue.mutateAsync({
            id: editing.row.id,
            revision: editing.row.revision,
            date: v.date,
            payee: v.payee,
            amount: v.amount,
            confirmed: true,
          });
        else
          await finish.mutateAsync({
            id: editing.row.id,
            revision: editing.row.revision,
            date: v.date,
            state: editing.action,
            confirmed: true,
          });
      }
      void refresh();
    },
  });
  return (
    <Drawer open title={title} size={480} onClose={editor.close}>
      <Alert
        type="info"
        title={
          editing.action === 'receive'
            ? '同一银行账户的票号唯一，登记后保留历史。'
            : `票号：${editing.row.number}；${labels[editing.row.state]}`
        }
      />
      <Form
        form={form}
        disabled={editor.isSubmitting}
        layout="vertical"
        initialValues={{ date: today() }}
        onValuesChange={editor.changed}
        onFinish={() => void editor.save()}
      >
        {editing.action === 'receive' && (
          <>
            <Form.Item name="accountId" label="银行账户" rules={[{ required: true }]}>
              <Select
                options={accounts
                  .filter((a) => !a.disabled)
                  .map((a) => ({ value: a.id, label: a.name }))}
              />
            </Form.Item>
            <Form.Item name="number" label="支票号码" rules={[{ required: true }]}>
              <Input maxLength={40} />
            </Form.Item>
            <Form.Item name="note" label="备注">
              <Input.TextArea maxLength={500} />
            </Form.Item>
          </>
        )}
        <Form.Item name="date" label="办理日期" rules={[{ required: true }]}>
          <Input type="date" />
        </Form.Item>
        {editing.action === 'issue' && (
          <>
            <Form.Item name="payee" label="收款人" rules={[{ required: true }]}>
              <Input maxLength={120} />
            </Form.Item>
            <Form.Item
              name="amount"
              label="签发金额"
              rules={[{ required: true }, editor.money.rule('amount')]}
            >
              <MoneyInput {...editor.money.input('amount')} />
            </Form.Item>
          </>
        )}
        <Button
          type="primary"
          htmlType="submit"
          disabled={editor.isSubmitting}
          aria-busy={editor.isSubmitting}
        >
          保存支票登记
        </Button>
      </Form>
      {holder}
      {editor.holder}
    </Drawer>
  );
}
