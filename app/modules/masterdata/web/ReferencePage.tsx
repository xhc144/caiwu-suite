import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Space,
  Switch,
  Tabs,
  Typography,
} from 'antd';
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AccountSelect,
  DataTable,
  FilterBar,
  PageContainer,
  useUrlFilters,
  type DataColumn,
} from '@caiwu/ui';
import { notify, usePermission } from '@caiwu/web-kit';
import {
  ReferenceKindSchema,
  type ReferenceInput,
  type ReferenceKind,
  type ReferenceRow,
} from '../shared';
import { api } from './api';
import { refresh, run, useConfirm, useUnsaved } from './common';

const kindNames: Record<ReferenceKind, string> = {
  voucherTypes: '凭证类型',
  settlementMethods: '结算类别',
  currencies: '外币与汇率',
  summaries: '摘要库',
};
export default function ReferencePage() {
  const [filters, setFilters] = useUrlFilters({ kind: 'voucherTypes', keyword: '' });
  const parsed = ReferenceKindSchema.safeParse(filters.kind);
  const kind = parsed.success ? parsed.data : 'voucherTypes';
  const list = useQuery(api.reference.list.queryOptions({ kind }));
  const [editing, setEditing] = useState<ReferenceRow | 'new' | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);
  const canEdit = usePermission('masterdata.reference.edit');
  const remove = useMutation(api.reference.remove.mutationOptions());
  const ask = useConfirm();
  const columns: DataColumn<ReferenceRow>[] = [
    {
      key: 'code',
      title: '编码',
      dataIndex: 'code',
      width: 160,
    },
    ...(kind === 'voucherTypes'
      ? [{ key: 'shortName', title: '简称（凭证字）', dataIndex: 'shortName', width: 120 }]
      : []),
    {
      key: 'name',
      title: kind === 'summaries' ? '短语' : kind === 'voucherTypes' ? '全称' : '名称',
      dataIndex: 'name',
      width: 260,
    },
    {
      key: 'category',
      title: kind === 'summaries' ? '类别 / 快捷键 / 使用次数' : '说明',
      width: 220,
      render: (_, r) =>
        kind === 'summaries' ? `${r.category} / ${r.shortcut} / ${r.useCount}` : (r.symbol ?? ''),
    },
    { key: 'sort', title: '排序', dataIndex: 'sort', width: 70 },
    {
      key: 'disabled',
      title: '状态',
      width: 100,
      render: (_, r) => (r.isBase ? '本位币' : r.disabled ? '停用' : '在用'),
    },
    {
      key: 'actions',
      title: '操作',
      width: 220,
      render: (_, r) => (
        <Space>
          <Button type="link" onClick={() => setEditing(r)}>
            {canEdit ? '编辑' : '查看'}
          </Button>
          {kind === 'currencies' && !r.isBase && (
            <Button type="link" onClick={() => setCurrency(r.code)}>
              汇率
            </Button>
          )}
          {canEdit && (
            <Button
              type="link"
              danger
              onClick={() =>
                run(
                  (async () => {
                    if (
                      !(await ask(
                        `确认删除 ${r.code} ${r.name}？使用中的记录和最后一个可用类别将受到保护。`,
                      ))
                    )
                      return;
                    await remove.mutateAsync({ kind, id: r.id, code: r.code, confirmed: true });
                    await refresh();
                    notify.success('已删除');
                  })(),
                )
              }
            >
              删除
            </Button>
          )}
        </Space>
      ),
    },
  ];
  const rows = (list.data ?? []).filter((r) =>
    `${r.code} ${r.name} ${r.pinyin} ${r.category} ${r.shortcut}`
      .toLowerCase()
      .includes(filters.keyword.toLowerCase()),
  );
  return (
    <PageContainer
      title="参考档案"
      extra={
        canEdit && (
          <Button type="primary" onClick={() => setEditing('new')}>
            新增{kindNames[kind]}
          </Button>
        )
      }
    >
      <Tabs
        activeKey={kind}
        items={Object.entries(kindNames).map(([key, label]) => ({ key, label }))}
        onChange={(next) => setFilters({ kind: next, keyword: '' })}
      />
      {kind === 'voucherTypes' && (
        <Alert
          style={{ marginBottom: 16 }}
          type="info"
          title="简称用于凭证头显示，全称用于说明。借贷必有、必无科目等约束暂未提供，不影响现有 core 的保存校验。"
        />
      )}
      {kind === 'currencies' && (
        <Alert
          style={{ marginBottom: 16 }}
          type="info"
          title="本页仅维护币种和期间汇率，不改变账套本位币。当前共享层凭证核算以 CNY 为本位币。"
        />
      )}
      <FilterBar
        key={kind}
        initialValues={{ keyword: filters.keyword }}
        onSearch={(v: { keyword: string }) => setFilters({ keyword: v.keyword ?? '' })}
      >
        <Form.Item name="keyword" label="查找">
          <Input placeholder="编码、名称、拼音或快捷键" allowClear />
        </Form.Item>
      </FilterBar>
      <DataTable
        tableId={`masterdata.reference.${kind}`}
        rowKey="code"
        columns={columns}
        dataSource={rows}
        loading={list.isLoading}
      />
      {editing && (
        <ReferenceDrawer
          key={`${kind}:${editing === 'new' ? 'new' : editing.code}`}
          kind={kind}
          item={editing}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
        />
      )}
      {currency && (
        <RatesDrawer currency={currency} canEdit={canEdit} onClose={() => setCurrency(null)} />
      )}
    </PageContainer>
  );
}

function ReferenceDrawer({
  kind,
  item,
  canEdit,
  onClose,
}: {
  kind: ReferenceKind;
  item: ReferenceRow | 'new';
  canEdit: boolean;
  onClose: () => void;
}) {
  const [form] = Form.useForm<ReferenceInput>();
  const [dirty, setDirty] = useState(false);
  const save = useMutation(api.reference.save.mutationOptions());
  const isNew = item === 'new';
  const submit = async () => {
    const v = await form.validateFields();
    await save.mutateAsync({ ...v, kind, id: isNew ? undefined : item.id });
    setDirty(false);
    await refresh();
    onClose();
    notify.success('已保存');
  };
  const unsaved = useUnsaved(dirty, submit, () => {
    form.resetFields();
    setDirty(false);
  });
  return (
    <>
      <Drawer
        open
        title={`${isNew ? '新增' : '编辑'}${kindNames[kind]}`}
        size={500}
        onClose={() => unsaved.guard(onClose)}
        footer={
          <Space>
            <Button onClick={() => unsaved.guard(onClose)}>取消</Button>
            {canEdit && (
              <Button type="primary" loading={save.isPending} onClick={() => run(submit())}>
                保存
              </Button>
            )}
          </Space>
        }
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={isNew ? { kind, sort: 0, disabled: false } : { ...item, kind }}
          onValuesChange={() => setDirty(true)}
          disabled={!canEdit}
        >
          <Form.Item
            name="code"
            label="编码"
            rules={[{ required: true, message: '请输入唯一编码' }]}
          >
            <Input disabled={!isNew && kind === 'currencies'} />
          </Form.Item>
          {kind === 'voucherTypes' && (
            <Form.Item
              name="shortName"
              label="简称（凭证字）"
              rules={[{ required: true, message: '请输入凭证简称' }]}
            >
              <Input maxLength={4} />
            </Form.Item>
          )}
          <Form.Item
            name="name"
            label={kind === 'summaries' ? '摘要短语' : kind === 'voucherTypes' ? '全称' : '名称'}
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input />
          </Form.Item>
          {kind === 'currencies' && (
            <Form.Item name="symbol" label="符号">
              <Input />
            </Form.Item>
          )}
          {kind === 'summaries' && (
            <>
              <Form.Item name="category" label="类别">
                <Input />
              </Form.Item>
              <Form.Item name="shortcut" label="快捷检索词">
                <Input />
              </Form.Item>
            </>
          )}
          <Form.Item name="sort" label="排序">
            <InputNumber min={0} />
          </Form.Item>
          {kind !== 'summaries' && (
            <Form.Item name="disabled" label="停用" valuePropName="checked">
              <Switch disabled={!isNew && item.isBase} />
            </Form.Item>
          )}
        </Form>
      </Drawer>
      {unsaved.dialog}
    </>
  );
}

function RatesDrawer({
  currency,
  canEdit,
  onClose,
}: {
  currency: string;
  canEdit: boolean;
  onClose: () => void;
}) {
  const [form] = Form.useForm<{ period: number; rate: string; accountId: number | null }>();
  const [applicable, setApplicable] = useState<number>(202601);
  const rates = useQuery(api.reference.rates.queryOptions({ currency }));
  const rate = useQuery(
    api.reference.applicableRate.queryOptions({ currency, period: applicable }),
  );
  const save = useMutation(api.reference.saveRate.mutationOptions());
  useEffect(() => {
    if (rates.data && !form.isFieldTouched('accountId'))
      form.setFieldValue('accountId', rates.data.accountId);
  }, [form, rates.data]);
  return (
    <Drawer
      open
      title={`${currency} 期间汇率`}
      size={600}
      onClose={onClose}
      footer={
        canEdit && (
          <Button
            type="primary"
            onClick={() =>
              run(
                (async () => {
                  const v = await form.validateFields();
                  await save.mutateAsync({ ...v, currency, accountId: v.accountId ?? null });
                  await refresh();
                  notify.success('汇率已保存');
                })(),
              )
            }
          >
            保存汇率
          </Button>
        )
      }
    >
      <Typography.Paragraph>适用规则：查询期间或之前最近一次设置的汇率。</Typography.Paragraph>
      <Space>
        <Typography.Text>查询期间</Typography.Text>
        <InputNumber
          aria-label="查询汇率期间"
          value={applicable}
          onChange={(v) => v && setApplicable(v)}
        />
        <Typography.Text>适用汇率：{rate.data ?? '未设置'}</Typography.Text>
      </Space>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ period: 202601, accountId: rates.data?.accountId ?? null }}
        disabled={!canEdit}
      >
        <Form.Item name="period" label="期间（年月）" rules={[{ required: true }]}>
          <InputNumber />
        </Form.Item>
        <Form.Item name="rate" label="十进制汇率" rules={[{ required: true }]}>
          <Input placeholder="7.123456" />
        </Form.Item>
        <Form.Item name="accountId" label="汇兑损益科目">
          <AccountSelect allowClear />
        </Form.Item>
        {rates.data?.accountId && (
          <Typography.Paragraph>当前汇兑损益科目 ID：{rates.data.accountId}</Typography.Paragraph>
        )}
      </Form>
      <DataTable
        tableId="masterdata.rates"
        rowKey="period"
        columns={[
          { key: 'period', title: '期间', dataIndex: 'period', width: 120 },
          { key: 'rate', title: '汇率', dataIndex: 'rate', width: 200 },
        ]}
        dataSource={rates.data?.rates ?? []}
      />
    </Drawer>
  );
}
