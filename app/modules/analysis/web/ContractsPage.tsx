import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
} from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { formatMoney } from '@caiwu/core';
import {
  queryClient,
  showError,
  useAccounts,
  usePermission,
  useRequiredSession,
  useTab,
} from '@caiwu/web-kit';
import { DataTable, DimensionSelect, MoneyInput, PageContainer, type DataColumn } from '@caiwu/ui';
import { ContractInputSchema, type ContractInput } from '../contracts';
import { api } from './api';
import { NoPermission, ReportError, useReportFilters } from './common';

// 服务端推导出的详情类型从查询结果传入组件。
type Detail = NonNullable<ReturnType<typeof useContract>['data']>;
function useContract(id: number) {
  return useQuery({ ...api.contracts.get.queryOptions({ id }), enabled: id > 0 });
}
async function refreshContracts() {
  await queryClient.invalidateQueries({ queryKey: api.contracts.pathKey() });
}
function useUnsaved(dirty: boolean) {
  const tab = useTab();
  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const key = (e: KeyboardEvent) => {
      if (
        tab.active &&
        e.ctrlKey &&
        e.key === 'F4' &&
        !window.confirm('合同有修改未保存，放弃修改并关闭吗？')
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    const click = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const close =
        target
          ?.closest('.ant-tabs-tab-remove')
          ?.closest('[data-node-key]')
          ?.getAttribute('data-node-key') === tab.key;
      if (
        (target?.closest('a[href]') || close) &&
        !window.confirm('合同有修改未保存，放弃修改并离开吗？')
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('beforeunload', unload);
    window.addEventListener('keydown', key, true);
    window.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('click', click, true);
    };
  }, [dirty, tab.active, tab.key]);
}
function ContractEditor({ original, close }: { original: Detail | null; close: () => void }) {
  const session = useRequiredSession();
  const { accounts } = useAccounts();
  const [form] = Form.useForm<ContractInput>();
  const [dirty, setDirty] = useState(false);
  useUnsaved(dirty);
  const save = useMutation(
    api.contracts.save.mutationOptions({
      onSuccess: async () => {
        setDirty(false);
        await refreshContracts();
        close();
      },
    }),
  );
  const initial: Partial<ContractInput> = original
    ? {
        id: original.id,
        expectedRevision: original.revision,
        code: original.code,
        name: original.name,
        partnerId: original.partner_id,
        accountId: original.account_id,
        signedDate: original.signed_date,
        kind: original.kind,
        amount: original.amount,
        opening: original.opening,
        description: original.description,
        remark: original.remark,
      }
    : {
        expectedRevision: 0,
        code: '',
        name: '',
        signedDate: `${Math.floor(session.book.startPeriod / 100)}-${String(session.book.startPeriod % 100).padStart(2, '0')}-01`,
        kind: 'receipt',
        amount: 0,
        opening: 0,
        description: '',
        remark: '',
      };
  return (
    <Drawer
      title={original ? `修改合同 ${original.code}` : '新增合同'}
      open
      size={620}
      onClose={() => {
        if (!save.isPending && (!dirty || window.confirm('合同有修改未保存，放弃修改吗？')))
          close();
      }}
      maskClosable={!save.isPending}
      extra={
        <Button
          type="primary"
          onClick={() => form.submit()}
          disabled={save.isPending}
          aria-busy={save.isPending}
        >
          保存合同
        </Button>
      }
    >
      <Form
        form={form}
        disabled={save.isPending}
        layout="vertical"
        initialValues={initial}
        onValuesChange={() => setDirty(true)}
        onFinish={(values) => {
          const parsed = ContractInputSchema.safeParse({
            ...values,
            id: original?.id,
            expectedRevision: original?.revision ?? 0,
          });
          if (!parsed.success)
            return showError(parsed.error.issues.map((i) => i.message).join('；'));
          save.mutate(parsed.data);
        }}
      >
        <Form.Item
          name="code"
          label="合同号"
          rules={[{ required: true, whitespace: true, message: '请输入合同号' }]}
        >
          <Input maxLength={40} />
        </Form.Item>
        <Form.Item
          name="name"
          label="合同名称"
          rules={[{ required: true, whitespace: true, message: '请输入合同名称' }]}
        >
          <Input maxLength={100} />
        </Form.Item>
        <Form.Item
          name="partnerId"
          label="客供"
          rules={[{ required: true, message: '请选择客供' }]}
        >
          <DimensionSelect type="partner" />
        </Form.Item>
        <Form.Item
          name="accountId"
          label="收付款科目"
          rules={[{ required: true, message: '请选择收付款科目' }]}
        >
          <Select
            showSearch={{ optionFilterProp: 'label' }}
            options={accounts
              .filter(
                (a) =>
                  a.isLeaf &&
                  !a.disabled &&
                  (a.isCash || a.isBank) &&
                  a.dimensions.some((d) => d.type === 'partner'),
              )
              .map((a) => ({ value: a.id, label: `${a.code} ${a.fullName}` }))}
          />
        </Form.Item>
        <Alert
          type="info"
          title="收付款科目须启用客供核算；关联整条已过账现金银行分录，不拆分金额。期初收付款为账套启用日前累计。"
        />
        <Form.Item name="signedDate" label="签订日期" rules={[{ required: true }]}>
          <Input type="date" />
        </Form.Item>
        <Form.Item name="kind" label="收付款类型">
          <Select
            options={[
              { value: 'receipt', label: '收款' },
              { value: 'payment', label: '付款' },
            ]}
          />
        </Form.Item>
        <Form.Item name="amount" label="合同金额" rules={[{ required: true }]}>
          <MoneyInput allowNegative={false} />
        </Form.Item>
        <Form.Item name="opening" label="期初收付款" rules={[{ required: true }]}>
          <MoneyInput allowNegative={false} />
        </Form.Item>
        <Form.Item name="description" label="合同说明">
          <Input.TextArea rows={4} maxLength={4000} />
        </Form.Item>
        <Form.Item name="remark" label="备注">
          <Input.TextArea maxLength={500} />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
function ContractDetails({
  contract,
  onEdit,
  close,
}: {
  contract: Detail;
  onEdit: () => void;
  close: () => void;
}) {
  const { modal } = App.useApp();
  const canReview = usePermission('analysis.contract.review');
  const canEdit = usePermission('analysis.contract.edit');
  const canLink = usePermission('analysis.contract.link');
  const [voucherId, setVoucherId] = useState<number | null>(null);
  const [searched, setSearched] = useState(0);
  const candidates = useQuery({
    ...api.contracts.candidates.queryOptions({ id: contract.id, voucherId: searched }),
    enabled: canLink && searched > 0,
  });
  const review = useMutation(api.contracts.review.mutationOptions({ onSuccess: refreshContracts }));
  const link = useMutation(api.contracts.link.mutationOptions({ onSuccess: refreshContracts }));
  const unlink = useMutation(api.contracts.unlink.mutationOptions({ onSuccess: refreshContracts }));
  const remove = useMutation(
    api.contracts.remove.mutationOptions({
      onSuccess: async () => {
        await refreshContracts();
        close();
      },
    }),
  );
  const version = { id: contract.id, expectedRevision: contract.revision };
  const busy = review.isPending || link.isPending || unlink.isPending || remove.isPending;
  return (
    <Drawer title={`合同 ${contract.code}`} open size={840} onClose={close}>
      <Descriptions
        column={2}
        items={[
          { key: 'name', label: '名称', children: contract.name },
          { key: 'partner', label: '客供', children: contract.partnerName },
          { key: 'date', label: '签订日期', children: contract.signed_date },
          { key: 'kind', label: '类型', children: contract.kind === 'receipt' ? '收款' : '付款' },
          { key: 'amount', label: '合同金额', children: formatMoney(contract.amount) },
          { key: 'opening', label: '期初收付款', children: formatMoney(contract.opening) },
          { key: 'account', label: '收付款科目', children: contract.accountCode },
          { key: 'creator', label: '录入人', children: contract.creatorName },
          { key: 'reviewer', label: '审核人', children: contract.reviewerName ?? '未审核' },
          { key: 'due', label: '原始到期日 / 逾期天数', children: '未知' },
          {
            key: 'description',
            label: '合同说明',
            children: contract.description || '未填写',
            span: 2,
          },
          { key: 'remark', label: '备注', children: contract.remark || '未填写', span: 2 },
        ]}
      />
      <Space wrap>
        {canEdit && (
          <Button
            onClick={onEdit}
            disabled={busy || !!contract.reviewed_by || contract.lines.length > 0}
          >
            修改合同
          </Button>
        )}
        {canReview && (
          <Button
            disabled={busy}
            onClick={() => review.mutate({ ...version, reviewed: !contract.reviewed_by })}
          >
            {contract.reviewed_by ? '取消合同审核' : '审核合同'}
          </Button>
        )}
        {canEdit && (
          <Button
            danger
            disabled={busy}
            onClick={() =>
              modal.confirm({
                title: `删除合同 ${contract.code}？`,
                content: '删除后无法恢复；已审核或已使用合同会被拒绝。',
                okText: '确认删除',
                cancelText: '取消',
                onOk: () => remove.mutateAsync({ ...version, confirmed: true }),
              })
            }
          >
            删除合同
          </Button>
        )}
      </Space>
      <h3>明确关联的收付款分录</h3>
      <DataTable
        tableId="analysis-contract-lines"
        rowKey="line_id"
        dataSource={contract.lines}
        pagination={false}
        columns={[
          { key: 'date', title: '日期', dataIndex: 'date' },
          {
            key: 'no',
            title: '凭证',
            render: (_, l) => (
              <Link to={`/m/voucher-entry/edit?id=${l.voucherId}`}>{l.displayNo}</Link>
            ),
          },
          { key: 'summary', title: '摘要', dataIndex: 'summary' },
          { key: 'amount', title: '收付款', dataIndex: 'amount', money: true },
          {
            key: 'status',
            title: '状态',
            render: (_, l) => (l.status === 'posted' && !l.voided ? '已过账' : '已失效，请处理'),
          },
          {
            key: 'unlink',
            title: '操作',
            render: (_, l) =>
              canLink && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    modal.confirm({
                      title: '取消这条分录与合同的关联？',
                      content: '不会修改凭证；取消后此分录不再计入合同收付款。',
                      okText: '确认取消关联',
                      cancelText: '保留关联',
                      onOk: () =>
                        unlink.mutateAsync({ ...version, lineId: l.line_id, confirmed: true }),
                    })
                  }
                >
                  取消关联
                </Button>
              ),
          },
        ]}
      />
      {canLink && (
        <>
          <Alert
            type="info"
            title="先审核合同，再查询凭证ID并选择具体分录。凭证ID取自凭证链接的 id 参数；原始到期日未知。"
          />
          <Space>
            <label htmlFor="contract-voucher-id">凭证ID</label>
            <InputNumber
              id="contract-voucher-id"
              min={1}
              precision={0}
              value={voucherId}
              onChange={setVoucherId}
            />
            <Button disabled={!voucherId || busy} onClick={() => setSearched(voucherId ?? 0)}>
              查询凭证分录
            </Button>
          </Space>
          {candidates.isError && (
            <ReportError error={candidates.error} retry={() => void candidates.refetch()} />
          )}
          {candidates.data && (
            <>
              <p>
                {candidates.data.date} {candidates.data.displayNo}
              </p>
              <DataTable
                tableId="analysis-contract-candidates"
                rowKey="lineId"
                dataSource={candidates.data.lines}
                pagination={false}
                columns={[
                  { key: 'account', title: '科目', dataIndex: 'accountCode' },
                  { key: 'summary', title: '摘要', dataIndex: 'summary' },
                  { key: 'debit', title: '借方', dataIndex: 'debit', money: true },
                  { key: 'credit', title: '贷方', dataIndex: 'credit', money: true },
                  {
                    key: 'action',
                    title: '关联',
                    render: (_, l) =>
                      l.reason ? (
                        l.reason
                      ) : (
                        <Button
                          disabled={busy || !contract.reviewed_by}
                          onClick={() =>
                            link.mutate({ ...version, voucherId: searched, lineId: l.lineId })
                          }
                        >
                          关联此分录
                        </Button>
                      ),
                  },
                ]}
              />
            </>
          )}
        </>
      )}
    </Drawer>
  );
}
export default function ContractsPage() {
  const canView = usePermission('analysis.contract.view');
  const canEdit = usePermission('analysis.contract.edit');
  const [filters, setFilters] = useReportFilters({ id: 0 });
  const [editing, setEditing] = useState<{ original: Detail | null } | null>(null);
  const query = useQuery({ ...api.contracts.list.queryOptions(), enabled: canView });
  const selected = useContract(canView ? filters.id : 0);
  const columns: DataColumn<NonNullable<typeof query.data>[number]>[] = [
    {
      key: 'code',
      title: '合同号',
      render: (_, r) => (
        <Button type="link" onClick={() => setFilters({ id: r.id })}>
          {r.code}
        </Button>
      ),
    },
    { key: 'name', title: '名称', dataIndex: 'name' },
    { key: 'partner', title: '客供', dataIndex: 'partnerName' },
    { key: 'signed', title: '签订日期', dataIndex: 'signed_date' },
    { key: 'kind', title: '类型', render: (_, r) => (r.kind === 'receipt' ? '收款' : '付款') },
    { key: 'amount', title: '合同金额', dataIndex: 'amount', money: true },
    { key: 'opening', title: '期初收付', dataIndex: 'opening', money: true },
    { key: 'review', title: '状态', render: (_, r) => (r.reviewed_by ? '已审核' : '未审核') },
  ];
  return (
    <PageContainer
      title="合同档案管理"
      extra={
        <Space>
          {canEdit && (
            <Button type="primary" onClick={() => setEditing({ original: null })}>
              新增合同
            </Button>
          )}
          <Button onClick={() => void refreshContracts()}>刷新合同</Button>
          <Link to="/m/analysis/contract-balances">合同账款查询</Link>
        </Space>
      }
    >
      {!canView ? (
        <NoPermission />
      ) : (
        <>
          {query.isError && <ReportError error={query.error} retry={() => void query.refetch()} />}
          <DataTable
            tableId="analysis-contracts"
            rowKey="id"
            dataSource={query.data ?? []}
            columns={columns}
            loading={query.isFetching}
          />
          {selected.isError && (
            <ReportError error={selected.error} retry={() => void selected.refetch()} />
          )}
          {selected.data && filters.id > 0 && !editing && (
            <ContractDetails
              key={selected.data.id}
              contract={selected.data}
              close={() => setFilters({ id: 0 })}
              onEdit={() => setEditing({ original: selected.data })}
            />
          )}
          {editing && (
            <ContractEditor
              key={editing.original?.id ?? 'new'}
              original={editing.original}
              close={() => setEditing(null)}
            />
          )}
        </>
      )}
    </PageContainer>
  );
}
