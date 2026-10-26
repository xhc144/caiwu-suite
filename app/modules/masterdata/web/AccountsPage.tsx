import {
  App,
  Alert,
  Button,
  Checkbox,
  Col,
  Drawer,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Account, DimensionTypeId } from '@caiwu/core';
import { DIMENSION_TYPES } from '@caiwu/core';
import {
  AccountSelect,
  DataTable,
  DimensionSelect,
  FilterBar,
  PageContainer,
  useUrlFilters,
  type DataColumn,
} from '@caiwu/ui';
import { notify, queryClient, useAccounts, usePermission } from '@caiwu/web-kit';
import type { AccountInput } from '../shared';
import { api } from './api';
import { collectConfirmations, ExcelActions, refresh, run, useConfirm, useUnsaved } from './common';

const auxTypes = DIMENSION_TYPES.filter((d) => d.id !== 'cashflow');
type AuxType = 'project' | 'partner' | 'department' | 'person';
type AccountTreeNode = { key: number; title: string; children?: AccountTreeNode[] };
type Values = Omit<AccountInput, 'dimensions' | 'confirmations'> & {
  aux: Partial<
    Record<AuxType, { enabled: boolean; required: boolean; defaultItemId: number | null }>
  >;
};

export default function AccountsPage() {
  const [filters, setFilters] = useUrlFilters({ keyword: '' });
  const [filterForm] = Form.useForm<{ keyword: string }>();
  const list = useQuery(api.accounts.list.queryOptions({ keyword: filters.keyword }));
  const info = useQuery(api.info.queryOptions());
  const { accounts } = useAccounts();
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [batch, setBatch] = useState(false);
  const [money, setMoney] = useState(false);
  const canEdit = usePermission('masterdata.accounts.edit');
  const ask = useConfirm();
  const remove = useMutation(api.accounts.remove.mutationOptions());
  const rebuild = useMutation(api.accounts.rebuild.mutationOptions());
  const treeData = useMemo(() => {
    const tree = (parentId: number | null): AccountTreeNode[] =>
      accounts
        .filter((a) => a.parentId === parentId)
        .map((a) => ({
          key: a.id,
          title: `${a.code} ${a.name}${a.disabled ? '（停用）' : ''}`,
          children: tree(a.id),
        }));
    return tree(null);
  }, [accounts]);
  const columns: DataColumn<Account>[] = [
    { key: 'code', title: '编码', dataIndex: 'code', width: 120 },
    { key: 'name', title: '名称', dataIndex: 'name', width: 160 },
    { key: 'fullName', title: '全名', dataIndex: 'fullName', width: 220 },
    { key: 'level', title: '级次', dataIndex: 'level', width: 70 },
    {
      key: 'category',
      title: '类别',
      width: 100,
      render: (_, a) => info.data?.categories.find((c) => c.id === a.categoryId)?.name,
    },
    {
      key: 'direction',
      title: '方向',
      width: 70,
      render: (_, a) => (a.direction === 'debit' ? '借' : '贷'),
    },
    {
      key: 'flags',
      title: '核算属性',
      width: 300,
      render: (_, a) => (
        <Space size={0} wrap>
          {a.isCash && <Tag>现金</Tag>}
          {a.isBank && <Tag>银行</Tag>}
          {a.cashflowRequired && <Tag>现金流量必填</Tag>}
          {a.isPartner && <Tag>往来</Tag>}
          {a.currency && <Tag>{a.currency}</Tag>}
          {a.quantityUnit && <Tag>数量：{a.quantityUnit}</Tag>}
          {a.dimensions.map((d) => (
            <Tag key={d.type}>
              {DIMENSION_TYPES.find((t) => t.id === d.type)?.name}
              {d.required ? '必填' : '选填'}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      key: 'status',
      title: '状态',
      width: 90,
      render: (_, a) => (a.disabled ? '停用' : a.isLeaf ? '在用末级' : '汇总'),
    },
    {
      key: 'actions',
      title: '操作',
      width: 130,
      render: (_, a) => (
        <Space>
          <Button type="link" onClick={() => setEditing(a)}>
            {canEdit ? '编辑' : '查看'}
          </Button>
          {canEdit && (
            <Button
              type="link"
              danger
              onClick={() =>
                run(
                  (async () => {
                    const impact = await queryClient.fetchQuery(
                      api.accounts.deleteImpact.queryOptions({ id: a.id }),
                    );
                    if (await ask(impact.message)) {
                      await remove.mutateAsync({ id: a.id, confirmed: true });
                      await refresh();
                    }
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
  return (
    <PageContainer
      title="科目维护"
      subtitle={`本账套编码级次：${info.data?.book.codeScheme.join('-') ?? ''}`}
      extra={
        <Space>
          <ExcelActions kind="accounts" />
          {canEdit && (
            <>
              <Button onClick={() => setMoney(true)}>货币资金范围</Button>
              <Button onClick={() => setBatch(true)}>批量增加下级</Button>
              <Button
                onClick={() =>
                  run(
                    rebuild.mutateAsync().then(async () => {
                      await refresh();
                      notify.success('全名整理完成');
                    }),
                  )
                }
              >
                整理全名
              </Button>
              <Button type="primary" onClick={() => setEditing('new')}>
                新增科目
              </Button>
            </>
          )}
        </Space>
      }
    >
      <FilterBar
        form={filterForm}
        initialValues={{ keyword: filters.keyword }}
        onSearch={(v: { keyword: string }) => setFilters({ keyword: v.keyword ?? '' })}
        extra={
          <Button
            onClick={() => {
              const keyword = filterForm.getFieldValue('keyword') ?? '';
              run(
                queryClient
                  .fetchQuery(api.accounts.list.queryOptions({ keyword, locate: true }))
                  .then(() => setFilters({ keyword })),
              );
            }}
          >
            定位
          </Button>
        }
      >
        <Form.Item name="keyword" label="查找">
          <Input placeholder="编码、名称、拼音、助记码" allowClear />
        </Form.Item>
      </FilterBar>
      <Space style={{ marginBottom: 16 }}>
        <Typography.Text>快速查看科目</Typography.Text>
        <AccountSelect
          aria-label="快速查看科目"
          style={{ width: 320 }}
          onChange={(id) => {
            const a = accounts.find((a) => a.id === id);
            if (a) setEditing(a);
          }}
        />
      </Space>
      <div style={{ display: 'grid', gridTemplateColumns: '260px minmax(0,1fr)', gap: 16 }}>
        <div style={{ maxHeight: 650, overflow: 'auto' }}>
          <nav aria-label="科目树">
            <AccountTree
              nodes={treeData}
              onSelect={(id) => {
                const a = accounts.find((a) => a.id === id);
                if (a) setEditing(a);
              }}
            />
          </nav>
        </div>
        <DataTable
          tableId="masterdata.accounts"
          rowKey="id"
          loading={list.isLoading}
          columns={columns}
          dataSource={list.data ?? []}
        />
      </div>
      {editing && (
        <AccountDrawer
          key={editing === 'new' ? 'new' : editing.id}
          account={editing}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
        />
      )}
      {batch && <BatchDrawer onClose={() => setBatch(false)} />}
      {money && <MoneyDrawer onClose={() => setMoney(false)} />}
    </PageContainer>
  );
}

function AccountTree({
  nodes,
  onSelect,
}: {
  nodes: AccountTreeNode[];
  onSelect: (id: number) => void;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.children?.length ? (
          <details key={node.key} open>
            <summary style={{ cursor: 'pointer', padding: '5px 0' }}>
              {node.title}
              <Button
                size="small"
                type="link"
                onClick={(e) => {
                  e.preventDefault();
                  onSelect(node.key);
                }}
              >
                查看
              </Button>
            </summary>
            <div style={{ paddingLeft: 14 }}>
              <AccountTree nodes={node.children} onSelect={onSelect} />
            </div>
          </details>
        ) : (
          <div key={node.key}>
            <Button
              type="link"
              style={{ paddingInline: 4, whiteSpace: 'normal', height: 'auto', textAlign: 'left' }}
              onClick={() => onSelect(node.key)}
            >
              {node.title}
            </Button>
          </div>
        ),
      )}
    </>
  );
}

function AccountDrawer({
  account,
  canEdit,
  onClose,
}: {
  account: Account | 'new';
  canEdit: boolean;
  onClose: () => void;
}) {
  const [form] = Form.useForm<Values>();
  const [dirty, setDirty] = useState(false);
  const info = useQuery(api.info.queryOptions());
  const save = useMutation(api.accounts.save.mutationOptions());
  const ask = useConfirm();
  const [similar, setSimilar] = useState<Account[]>([]);
  const isNew = account === 'new';
  const defaults: Values = isNew
    ? { code: '', name: '', direction: 'debit', aux: {} }
    : {
        ...account,
        aux: Object.fromEntries(
          auxTypes.map((t) => {
            const d = account.dimensions.find((d) => d.type === t.id);
            return [
              t.id,
              {
                enabled: !!d,
                required: d?.required ?? true,
                defaultItemId: d?.defaultItemId ?? null,
              },
            ];
          }),
        ),
      };
  const submit = async () => {
    const v = await form.validateFields();
    const { aux, ...fields } = v;
    const data: AccountInput = {
      ...fields,
      id: isNew ? undefined : account.id,
      dimensions: auxTypes.flatMap((t) => {
        const d = aux?.[t.id as AuxType];
        return d?.enabled
          ? [
              {
                type: t.id as AuxType,
                required: d.required ?? true,
                defaultItemId: d.defaultItemId ?? null,
              },
            ]
          : [];
      }),
    };
    const preview = await queryClient.fetchQuery(api.accounts.preview.queryOptions(data));
    setSimilar(preview.similar);
    const confirmations = await collectConfirmations(preview.warnings, ask);
    if (confirmations == null) throw new Error('用户取消确认');
    await save.mutateAsync({ ...data, confirmations });
    setDirty(false);
    await refresh();
    notify.success('科目已保存');
    onClose();
  };
  const unsaved = useUnsaved(dirty, submit, () => {
    form.resetFields();
    setDirty(false);
  });
  return (
    <>
      <Drawer
        open
        title={isNew ? '新增科目' : '编辑科目'}
        size={660}
        onClose={() => unsaved.guard(onClose)}
        destroyOnHidden
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
          initialValues={defaults}
          onValuesChange={() => setDirty(true)}
          disabled={!canEdit}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="code"
                label="科目编码"
                rules={[{ required: true, message: '请输入编码' }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="name"
                label="科目名称"
                rules={[{ required: true, message: '请输入名称' }]}
              >
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="categoryId" label="类别（下级须同上级）">
                <Select
                  allowClear
                  options={info.data?.categories.map((c) => ({ value: c.id, label: c.name }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="direction" label="余额方向" rules={[{ required: true }]}>
                <Select
                  options={[
                    { value: 'debit', label: '借' },
                    { value: 'credit', label: '贷' },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="mnemonic" label="助记码">
            <Input />
          </Form.Item>
          <Space wrap>
            {(['isCash', 'isBank', 'cashflowRequired', 'isPartner', 'disabled'] as const).map(
              (key, i) => (
                <Form.Item key={key} name={key} valuePropName="checked">
                  <Checkbox>{['现金', '银行', '现金流量必填', '往来', '停用'][i]}</Checkbox>
                </Form.Item>
              ),
            )}
          </Space>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="currency" label="外币币种">
                <Select
                  allowClear
                  options={info.data?.currencies
                    .filter((c) => !c.isBase && !c.disabled)
                    .map((c) => ({ value: c.code, label: `${c.code} ${c.name}` }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="quantityUnit" label="数量单位">
                <Input placeholder="留空不启用数量核算" />
              </Form.Item>
            </Col>
          </Row>
          {auxTypes.map((t) => (
            <Row key={t.id} gutter={12} align="middle">
              <Col span={6}>
                <Form.Item name={['aux', t.id, 'enabled']} valuePropName="checked">
                  <Checkbox>启用{t.name}</Checkbox>
                </Form.Item>
              </Col>
              <Col span={5}>
                <Form.Item name={['aux', t.id, 'required']} valuePropName="checked">
                  <Checkbox>{t.name}必填</Checkbox>
                </Form.Item>
              </Col>
              <Col span={13}>
                <Form.Item name={['aux', t.id, 'defaultItemId']} label={`默认${t.name}`}>
                  <DimensionSelect type={t.id as DimensionTypeId} />
                </Form.Item>
              </Col>
            </Row>
          ))}
          {similar.length > 0 && (
            <Alert
              type="info"
              title="相似名称科目"
              description={similar.map((a) => `${a.code} ${a.fullName}`).join('；')}
            />
          )}
          <Typography.Paragraph type="secondary">
            已有凭证或期初的科目仅可调整名称、助记码、默认项或停用；核算语义改变会被拒绝。新增后可保留页面继续增加科目。
          </Typography.Paragraph>
        </Form>
      </Drawer>
      {unsaved.dialog}
    </>
  );
}

function BatchDrawer({ onClose }: { onClose: () => void }) {
  const [form] = Form.useForm<{ parentId: number; start: number; names: string }>();
  const [preview, setPreview] = useState<AccountInput[]>([]);
  const [snapshot, setSnapshot] = useState<{
    parentId: number;
    start: number;
    names: string[];
  } | null>(null);
  const save = useMutation(api.accounts.batch.mutationOptions());
  const previewBatch = useMutation(api.accounts.batchPreview.mutationOptions());
  const ask = useConfirm();
  const previewRows = async () => {
    const v = await form.validateFields();
    const data = {
      ...v,
      names: v.names
        .split('\n')
        .map((n) => n.trim())
        .filter(Boolean),
    };
    setPreview(await previewBatch.mutateAsync(data));
    setSnapshot(data);
  };
  return (
    <Drawer
      open
      title="批量增加下级"
      size={640}
      onClose={onClose}
      footer={
        <Space>
          <Button onClick={() => run(previewRows())}>预览编码</Button>
          <Button
            type="primary"
            disabled={!snapshot}
            onClick={() =>
              run(
                (async () => {
                  if (!snapshot) return;
                  const warnings = (
                    await Promise.all(
                      preview.map((a) =>
                        queryClient.fetchQuery(api.accounts.preview.queryOptions(a)),
                      ),
                    )
                  ).flatMap((p) => p.warnings);
                  const duplicates = preview
                    .filter((a, i) => preview.some((b, j) => j < i && b.name === a.name))
                    .map((a) => ({
                      key: `duplicateName:${a.code}`,
                      message: `批内名称 ${a.name} 重复，仍单独建立 ${a.code}？`,
                    }));
                  const confirmations = await collectConfirmations(
                    [
                      ...warnings,
                      ...duplicates,
                      { key: 'batch', message: '确认按预览整批建立？任何失败都将撤销全部。' },
                    ],
                    ask,
                  );
                  if (!confirmations) return;
                  await save.mutateAsync({ ...snapshot, confirmations });
                  await refresh();
                  onClose();
                })(),
              )
            }
          >
            确认批量增加
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        title="继承父级核算属性与默认项；父级已有凭证或期初时不允许直接增加下级。"
      />
      <Form
        form={form}
        layout="vertical"
        initialValues={{ start: 1 }}
        onValuesChange={() => {
          setSnapshot(null);
          setPreview([]);
        }}
      >
        <Form.Item name="parentId" label="父级科目" rules={[{ required: true }]}>
          <AccountSelect leafOnly={false} />
        </Form.Item>
        <Form.Item name="start" label="起始序号" rules={[{ required: true }]}>
          <InputNumber min={0} />
        </Form.Item>
        <Form.Item name="names" label="下级名称（每行一个）" rules={[{ required: true }]}>
          <Input.TextArea rows={7} />
        </Form.Item>
      </Form>
      <DataTable
        tableId="masterdata.batch"
        rowKey="code"
        columns={[
          { key: 'code', title: '将创建编码', dataIndex: 'code', width: 180 },
          { key: 'name', title: '名称', dataIndex: 'name', width: 260 },
        ]}
        dataSource={preview}
      />
    </Drawer>
  );
}

function MoneyDrawer({ onClose }: { onClose: () => void }) {
  const [form] = Form.useForm<{ accountId: number; kind: 'cash' | 'bank' | 'other' }>();
  const roots = useQuery(api.accounts.moneyRoots.queryOptions());
  const { byId } = useAccounts();
  const save = useMutation(api.accounts.confirmMoneyRoot.mutationOptions());
  const ask = useConfirm();
  const { message } = App.useApp();
  return (
    <Drawer
      open
      title="本账套货币资金范围"
      size={600}
      onClose={onClose}
      footer={
        <Button
          type="primary"
          onClick={() =>
            run(
              (async () => {
                const v = await form.validateFields();
                if (
                  !(await ask(
                    '确认所选一级科目在本账套中属于现金、银行存款或其他货币资金？这将允许该层级的货币资金标志。',
                  ))
                )
                  return;
                await save.mutateAsync({ ...v, confirmed: true });
                await refresh();
                void message.success('范围已确认');
              })(),
            )
          }
        >
          确认层级语义
        </Button>
      }
    >
      <Typography.Paragraph>
        初始范围只取制度模板明确标记的现金/银行一级科目。其他货币资金需人工确认，不按编号推断。
      </Typography.Paragraph>
      {roots.data?.map((r) => (
        <Typography.Paragraph key={r.account_id}>
          {byId.get(r.account_id)?.code} {byId.get(r.account_id)?.name}（
          {{ cash: '现金', bank: '银行存款', other: '其他货币资金' }[r.kind]}）
        </Typography.Paragraph>
      ))}
      <Form form={form} layout="vertical" initialValues={{ kind: 'other' }}>
        <Form.Item name="accountId" label="一级资产科目" rules={[{ required: true }]}>
          <AccountSelect leafOnly={false} filter={(a) => a.level === 1} />
        </Form.Item>
        <Form.Item name="kind" label="资金类别">
          <Select
            options={[
              { value: 'cash', label: '现金' },
              { value: 'bank', label: '银行存款' },
              { value: 'other', label: '其他货币资金' },
            ]}
          />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
