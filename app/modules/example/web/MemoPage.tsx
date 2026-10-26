import { Button, Drawer, Form, Input, DatePicker, Popconfirm, Space, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { moduleRoute } from '@caiwu/core';
import { notify, queryClient, useAccounts, useHotkey, usePermission } from '@caiwu/web-kit';
import {
  AccountSelect,
  DataTable,
  DimensionSelect,
  FilterBar,
  MoneyInput,
  PageContainer,
  useUrlFilters,
  type DataColumn,
} from '@caiwu/ui';
import type { Memo } from '../shared';
import { api } from './api';

interface FormValues {
  date: dayjs.Dayjs;
  summary: string;
  debitAccountId: number;
  creditAccountId: number;
  amount: number | null;
  departmentId?: number | null;
}

/**
 * 示范页面：筛选栏 + 数据表格 + 侧边抽屉表单 + 业务按钮。
 * 列表条件放在地址栏（?keyword=...），从别处跳过来可以直接带条件。
 */
export default function MemoPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useUrlFilters({ keyword: '', id: 0 });
  const listInput = { keyword: filters.keyword || undefined, id: filters.id || undefined };
  const list = useQuery(api.memos.list.queryOptions(listInput));
  const canEdit = usePermission('example.memo.edit');
  const canVoucher = usePermission('example.memo.voucher');
  const [editing, setEditing] = useState<Memo | 'new' | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: api.memos.list.queryKey() });
  const remove = useMutation(api.memos.remove.mutationOptions({ onSuccess: () => void refresh() }));
  const generate = useMutation(
    api.memos.generateVoucher.mutationOptions({
      onSuccess: (m) => {
        notify.success(`已生成凭证 ${m.voucherNo}`);
        void refresh();
      },
    }),
  );
  const unvoucher = useMutation(
    api.memos.deleteVoucher.mutationOptions({ onSuccess: () => void refresh() }),
  );

  // 页面快捷键：只在这个标签页可见时生效
  useHotkey('Alt+N', () => canEdit && setEditing('new'));

  const columns: DataColumn<Memo>[] = [
    { key: 'date', title: '日期', dataIndex: 'date', width: 110 },
    { key: 'summary', title: '摘要', dataIndex: 'summary', width: 220 },
    { key: 'debit', title: '借方科目', dataIndex: 'debitAccountName', width: 200 },
    { key: 'credit', title: '贷方科目', dataIndex: 'creditAccountName', width: 200 },
    { key: 'dept', title: '部门', dataIndex: 'departmentName', width: 100 },
    { key: 'amount', title: '金额', dataIndex: 'amount', money: true },
    {
      key: 'voucher',
      title: '凭证',
      width: 150,
      exportValue: (m) => m.voucherNo,
      render: (_: unknown, m: Memo) =>
        m.voucherId ? (
          <Space size={4}>
            <Typography.Link
              onClick={() => void navigate(moduleRoute('voucher-entry', `/edit?id=${m.voucherId}`))}
            >
              {m.voucherNo}
            </Typography.Link>
            <Tag>{m.voucherStatus}</Tag>
          </Space>
        ) : (
          <Typography.Text type="secondary">未生成</Typography.Text>
        ),
    },
    {
      key: 'actions',
      title: '操作',
      noExport: true,
      width: 220,
      render: (_: unknown, m: Memo) => (
        <Space size={4}>
          {canEdit && !m.voucherId && (
            <Button size="small" type="link" onClick={() => setEditing(m)}>
              修改
            </Button>
          )}
          {canEdit && !m.voucherId && (
            <Popconfirm title="删除这张记账单？" onConfirm={() => remove.mutate({ id: m.id })}>
              <Button size="small" type="link" danger>
                删除
              </Button>
            </Popconfirm>
          )}
          {canVoucher && !m.voucherId && (
            <Button
              size="small"
              type="link"
              loading={generate.isPending}
              onClick={() => generate.mutate({ id: m.id })}
            >
              生成凭证
            </Button>
          )}
          {canVoucher && m.voucherId && (
            <Popconfirm title="删除生成的凭证？" onConfirm={() => unvoucher.mutate({ id: m.id })}>
              <Button size="small" type="link">
                删除凭证
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <PageContainer
      title="示范记账单"
      subtitle="演示模块写法：录入一笔费用，一键生成凭证（只在开发模式出现）"
      extra={
        canEdit && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
            新增（Alt+N）
          </Button>
        )
      }
    >
      <FilterBar<{ keyword?: string }>
        initialValues={{ keyword: filters.keyword }}
        onSearch={(v) => setFilters({ keyword: v.keyword ?? '', id: 0 })}
      >
        <Form.Item name="keyword" label="摘要">
          <Input placeholder="包含的文字" allowClear />
        </Form.Item>
      </FilterBar>
      <DataTable<Memo>
        tableId="example.memos"
        rowKey="id"
        loading={list.isLoading}
        columns={columns}
        dataSource={list.data ?? []}
        exportName="示范记账单"
      />
      <MemoDrawer memo={editing} onClose={() => setEditing(null)} onSaved={() => void refresh()} />
    </PageContainer>
  );
}

function MemoDrawer({
  memo,
  onClose,
  onSaved,
}: {
  memo: Memo | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<FormValues>();
  const { byId } = useAccounts();
  const debitId = Form.useWatch('debitAccountId', form);
  const needsDept = !!byId.get(debitId)?.dimensions.some((d) => d.type === 'department');
  const create = useMutation(api.memos.create.mutationOptions());
  const update = useMutation(api.memos.update.mutationOptions());
  const isNew = memo === 'new';

  const submit = async () => {
    const v = await form.validateFields();
    const data = {
      date: v.date.format('YYYY-MM-DD'),
      summary: v.summary,
      debitAccountId: v.debitAccountId,
      creditAccountId: v.creditAccountId,
      amount: v.amount ?? 0,
      departmentId: needsDept ? (v.departmentId ?? null) : null,
    };
    if (isNew) await create.mutateAsync(data);
    else if (memo) await update.mutateAsync({ id: memo.id, data });
    notify.success('已保存');
    onSaved();
    onClose();
  };

  return (
    <Drawer
      open={memo != null}
      title={isNew ? '新增记账单' : '修改记账单'}
      size={420}
      onClose={onClose}
      destroyOnHidden
      footer={
        <Space style={{ float: 'right' }}>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            loading={create.isPending || update.isPending}
            onClick={() => void submit()}
          >
            保存
          </Button>
        </Space>
      }
    >
      <Form<FormValues>
        key={memo === 'new' ? 'new' : (memo?.id ?? 'closed')}
        form={form}
        layout="vertical"
        initialValues={
          memo && memo !== 'new'
            ? {
                date: dayjs(memo.date),
                summary: memo.summary,
                debitAccountId: memo.debitAccountId,
                creditAccountId: memo.creditAccountId,
                amount: memo.amount,
                departmentId: memo.departmentId,
              }
            : { date: dayjs(), summary: '', amount: null }
        }
        onFinish={() => void submit()}
      >
        <Form.Item name="date" label="日期" rules={[{ required: true, message: '请选择日期' }]}>
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="summary" label="摘要" rules={[{ required: true, message: '请输入摘要' }]}>
          <Input maxLength={100} autoFocus />
        </Form.Item>
        <Form.Item
          name="debitAccountId"
          label="借方科目"
          rules={[{ required: true, message: '请选择借方科目' }]}
        >
          <AccountSelect />
        </Form.Item>
        {needsDept && (
          <Form.Item
            name="departmentId"
            label="部门"
            rules={[{ required: true, message: '这个科目需要选择部门' }]}
          >
            <DimensionSelect type="department" />
          </Form.Item>
        )}
        <Form.Item
          name="creditAccountId"
          label="贷方科目"
          rules={[{ required: true, message: '请选择贷方科目' }]}
        >
          <AccountSelect />
        </Form.Item>
        <Form.Item name="amount" label="金额" rules={[{ required: true, message: '请输入金额' }]}>
          <MoneyInput placeholder="0.00" allowNegative={false} />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
