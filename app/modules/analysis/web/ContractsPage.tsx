import { useRef, useState, type KeyboardEvent } from 'react';
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
import { centsToYuan, formatMoney } from '@caiwu/core';
import {
  queryClient,
  showError,
  useAccounts,
  usePermission,
  useRequiredSession,
  useHotkey,
  useUnsavedChanges,
} from '@caiwu/web-kit';
import { DataTable, DimensionSelect, PageContainer, type DataColumn } from '@caiwu/ui';
import { ContractInputSchema } from '../contracts';
import {
  parseContractEditorMoney,
  readContractDraft,
  type ContractEditorValues,
} from '../contract-editor-values';
import { api } from './api';
import {
  downloadWorkbook,
  NoPermission,
  printTable,
  ReportError,
  useReportFilters,
} from './common';
import ContractImportDrawer from './ContractImportDrawer';
import {
  CONTRACT_SEARCH_FIELDS,
  matchesContractCondition,
  contractConditionError,
  type ContractSearchField,
  type ContractSearchOperator,
} from '../contract-search';

// 服务端推导出的详情类型从查询结果传入组件。
type Detail = NonNullable<ReturnType<typeof useContract>['data']>;
function useContract(id: number) {
  return useQuery({ ...api.contracts.get.queryOptions({ id }), enabled: id > 0 });
}
async function refreshContracts() {
  await queryClient.invalidateQueries({ queryKey: api.contracts.pathKey() });
}
function ContractEditor({
  original,
  copy = false,
  close,
}: {
  original: Detail | null;
  copy?: boolean;
  close: () => void;
}) {
  const session = useRequiredSession();
  const { modal } = App.useApp();
  const saving = useRef(false);
  const { accounts } = useAccounts();
  const [form] = Form.useForm<ContractEditorValues>();
  const [dirty, setDirty] = useState(false);
  const [draftStorageError, setDraftStorageError] = useState(false);
  const [inputError, setInputError] = useState('');
  const [version, setVersion] = useState(0);
  const [draftRevision, setDraftRevision] = useState(copy ? 0 : (original?.revision ?? 0));
  const draftKey = `caiwu.analysis.contract.${session.bookId}.${session.user.id}.${copy ? 'copy-' : ''}${original?.id ?? 'new'}`;
  const [recovered, setRecovered] = useState<Partial<ContractEditorValues> | null>(() => {
    try {
      return readContractDraft(JSON.parse(localStorage.getItem(draftKey) ?? 'null'));
    } catch {
      return null;
    }
  });
  const clearDraft = () => {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* 存储不可用时仍可保存合同。 */
    }
  };
  const save = useMutation(
    api.contracts.save.mutationOptions({
      onSuccess: async () => {
        setDirty(false);
        clearDraft();
        await refreshContracts();
        close();
      },
    }),
  );
  const initial: Partial<ContractEditorValues> = original
    ? {
        id: copy ? undefined : original.id,
        expectedRevision: copy ? 0 : original.revision,
        code: copy ? '' : original.code,
        name: original.name,
        partnerId: original.partner_id,
        accountId: original.account_id,
        signedDate: original.signed_date,
        kind: original.kind,
        amount: centsToYuan(original.amount),
        opening: centsToYuan(original.opening),
        description: original.description,
        remark: original.remark,
        remark2: original.remark2,
      }
    : {
        expectedRevision: 0,
        code: '',
        name: '',
        signedDate: `${Math.floor(session.book.startPeriod / 100)}-${String(session.book.startPeriod % 100).padStart(2, '0')}-01`,
        kind: 'receipt',
        amount: '0.00',
        opening: '0.00',
        description: '',
        remark: '',
        remark2: '',
      };
  const saveNow = async () => {
    if (saving.current || save.isPending) return false;
    saving.current = true;
    setInputError('');
    let prepared = false;
    try {
      const values = await form.validateFields();
      const parsed = ContractInputSchema.safeParse({
        ...values,
        amount: parseContractEditorMoney(values.amount, '合同金额'),
        opening: parseContractEditorMoney(values.opening, '期初收付款'),
        id: copy ? undefined : original?.id,
        expectedRevision: draftRevision,
      });
      if (!parsed.success) {
        setInputError(parsed.error.issues.map((i) => i.message).join('；'));
        return false;
      }
      prepared = true;
      await save.mutateAsync(parsed.data);
      return true;
    } catch (error) {
      if (!prepared && error instanceof Error) {
        setInputError(error.message);
      }
      return false;
    } finally {
      saving.current = false;
    }
  };
  const discard = () => {
    clearDraft();
    setDirty(false);
    close();
  };
  useUnsavedChanges({
    title: original ? `合同 ${original.code}` : '新增合同',
    dirty,
    version,
    save: saveNow,
    discard,
  });
  useHotkey('Ctrl+S', () => {
    void saveNow();
  });
  const closeEditor = () => {
    if (saving.current || save.isPending) return;
    if (!dirty) {
      close();
      return;
    }
    const dialog = modal.confirm({
      title: '合同尚未保存',
      content: '保存后关闭，或放弃本次修改。保存失败会保留当前输入。',
      okText: '保存后关闭',
      cancelText: '继续编辑',
      onOk: async () => {
        if (!(await saveNow())) throw new Error('合同未保存');
      },
      footer: (_, { OkBtn, CancelBtn }) => (
        <>
          <Button
            onClick={() => {
              if (saving.current) return;
              dialog.destroy();
              discard();
            }}
          >
            放弃修改
          </Button>
          <CancelBtn />
          <OkBtn />
        </>
      ),
    });
  };
  const closeFromTextArea = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    closeEditor();
  };
  return (
    <Drawer
      title={
        copy ? `拷加合同 ${original?.code}` : original ? `修改合同 ${original.code}` : '新增合同'
      }
      open
      size={620}
      onClose={closeEditor}
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
      {recovered && (
        <Alert
          type="warning"
          title="发现尚未保存的合同草稿"
          description="可恢复此前输入；若合同已被其他窗口修改，保存时仍会检查版本。"
          action={
            <Space>
              <Button
                disabled={save.isPending}
                onClick={() => {
                  if (saving.current) return;
                  form.setFieldsValue(recovered);
                  setDraftRevision(recovered.expectedRevision ?? draftRevision);
                  setDirty(true);
                  setVersion((v) => v + 1);
                  setRecovered(null);
                }}
              >
                恢复合同草稿
              </Button>
              <Button
                disabled={save.isPending}
                onClick={() => {
                  if (saving.current) return;
                  clearDraft();
                  setRecovered(null);
                }}
              >
                放弃旧草稿
              </Button>
            </Space>
          }
        />
      )}
      {draftStorageError && (
        <Alert type="warning" title="本机恢复副本无法更新，当前输入仍保留，请及时正式保存合同" />
      )}
      {inputError && (
        <Alert type="error" title="金额或合同资料有误，尚未保存" description={inputError} />
      )}
      {save.isError && (
        <Alert
          type="error"
          title="合同未保存，当前输入仍保留"
          description="请根据提示修改后重试；也可以稍后恢复草稿。"
        />
      )}
      {copy && (
        <Alert
          type="info"
          title="拷加保留合同资料，请填写新的合同号；不会复制审核状态及分录关联。"
        />
      )}
      <Form
        form={form}
        disabled={save.isPending}
        layout="vertical"
        initialValues={initial}
        onValuesChange={(_, values) => {
          setDirty(true);
          setInputError('');
          setVersion((v) => v + 1);
          try {
            localStorage.setItem(
              draftKey,
              JSON.stringify({
                ...values,
                expectedRevision: draftRevision,
                id: copy ? undefined : original?.id,
              }),
            );
            setDraftStorageError(false);
          } catch {
            setDraftStorageError(true);
          }
        }}
        onFinish={() => {
          void saveNow();
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
          <Input inputMode="decimal" onFocus={(e) => e.target.select()} />
        </Form.Item>
        <Form.Item name="opening" label="期初收付款" rules={[{ required: true }]}>
          <Input inputMode="decimal" onFocus={(e) => e.target.select()} />
        </Form.Item>
        <Form.Item name="description" label="合同说明">
          <Input.TextArea rows={4} maxLength={4000} onKeyDown={closeFromTextArea} />
        </Form.Item>
        <Form.Item name="remark" label="备注1">
          <Input.TextArea maxLength={500} onKeyDown={closeFromTextArea} />
        </Form.Item>
        <Form.Item name="remark2" label="备注2">
          <Input.TextArea maxLength={500} onKeyDown={closeFromTextArea} />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
function ContractDetails({
  contract,
  onEdit,
  onCopy,
  move,
  close,
}: {
  contract: Detail;
  onEdit: () => void;
  onCopy: () => void;
  move: (direction: 'first' | 'previous' | 'next' | 'last') => void;
  close: () => void;
}) {
  const { modal } = App.useApp();
  const canReview = usePermission('analysis.contract.review');
  const canEdit = usePermission('analysis.contract.edit');
  const canLink = usePermission('analysis.contract.link');
  const canExport = usePermission('analysis.export');
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
  const confirmRemove = () =>
    modal.confirm({
      title: `删除合同 ${contract.code}？`,
      content: '删除后无法恢复；已审核或已使用合同会被拒绝。',
      okText: '确认删除',
      cancelText: '取消',
      onOk: () => remove.mutateAsync({ ...version, confirmed: true }),
    });
  useHotkey(
    'Ctrl+D',
    () => {
      confirmRemove();
    },
    { enabled: canEdit && !busy, allowInInput: false },
  );
  const exportLines = async () => {
    const result = await queryClient.fetchQuery({
      ...api.contracts.exportLines.queryOptions({ id: contract.id }),
      staleTime: 0,
    });
    downloadWorkbook(result.base64, `${contract.code}-收付明细`);
  };
  const printLines = async () => {
    await queryClient.fetchQuery({ ...api.printAllowed.queryOptions('contracts'), staleTime: 0 });
    const detail = await queryClient.fetchQuery({
      ...api.contracts.get.queryOptions({ id: contract.id }),
      staleTime: 0,
    });
    await printTable(
      '合同收付明细',
      `${detail.code} ${detail.name}；${detail.partnerName}；仅明确关联分录；金额单位：元`,
      ['日期', '凭证', '科目', '摘要', '借方', '贷方', '收付款', '交易币种', '状态'],
      detail.lines.map((r) => [
        r.date,
        r.displayNo,
        r.accountCode,
        r.summary,
        formatMoney(r.debit),
        formatMoney(r.credit),
        formatMoney(r.amount),
        r.currency,
        r.status === 'posted' && !r.voided ? '已过账' : '已失效，请处理',
      ]),
    );
  };
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
          { key: 'remark', label: '备注1', children: contract.remark || '未填写', span: 2 },
          { key: 'remark2', label: '备注2', children: contract.remark2 || '未填写', span: 2 },
        ]}
      />
      <Space wrap>
        <Button disabled={busy} onClick={() => move('first')}>
          首条合同
        </Button>
        <Button disabled={busy} onClick={() => move('previous')}>
          上条合同
        </Button>
        <Button disabled={busy} onClick={() => move('next')}>
          下条合同
        </Button>
        <Button disabled={busy} onClick={() => move('last')}>
          末条合同
        </Button>
        <Button disabled={busy} onClick={() => void refreshContracts()}>
          重取合同
        </Button>
        {canEdit && (
          <Button disabled={busy} onClick={onCopy}>
            拷加合同
          </Button>
        )}
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
          <Button danger disabled={busy} onClick={confirmRemove}>
            删除合同
          </Button>
        )}
      </Space>
      <h3>明确关联的收付款分录</h3>
      {canExport && (
        <Space>
          <Button onClick={() => void exportLines().catch(showError)}>导出合同收付明细</Button>
          <Button onClick={() => void printLines().catch(showError)}>打印合同收付明细</Button>
        </Space>
      )}
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
  const [editing, setEditing] = useState<{ original: Detail | null; copy?: boolean } | null>(null);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [reviewed, setReviewed] = useState('all');
  const [condition, setCondition] = useState<{
    field: ContractSearchField;
    operator: ContractSearchOperator;
    value: string;
  }>();
  const [field, setField] = useState<ContractSearchField>('code');
  const [operator, setOperator] = useState<ContractSearchOperator>('contains');
  const [conditionValue, setConditionValue] = useState('');
  const canExport = usePermission('analysis.export');
  const query = useQuery({ ...api.contracts.list.queryOptions(), enabled: canView });
  const selected = useContract(canView ? filters.id : 0);
  const rows = (query.data ?? []).filter(
    (r) =>
      (!search ||
        [r.code, r.name, r.partnerName, r.description, r.remark, r.remark2].some((v) =>
          v.toLowerCase().includes(search.toLowerCase()),
        )) &&
      (kind === 'all' || r.kind === kind) &&
      (reviewed === 'all' || Boolean(r.reviewed_by) === (reviewed === 'yes')) &&
      (!condition ||
        matchesContractCondition(r, condition.field, condition.operator, condition.value)),
  );
  const move = (direction: 'first' | 'previous' | 'next' | 'last') => {
    if (!rows.length || editing) return;
    const current = rows.findIndex((r) => r.id === filters.id);
    const index =
      direction === 'first'
        ? 0
        : direction === 'last'
          ? rows.length - 1
          : direction === 'next'
            ? Math.min(rows.length - 1, current + 1)
            : Math.max(0, current - 1);
    setFilters({ id: rows[index]!.id });
  };
  const exportArchive = async () => {
    const result = await queryClient.fetchQuery({
      ...api.contracts.exportArchive.queryOptions(),
      staleTime: 0,
    });
    downloadWorkbook(result.base64, '合同档案');
  };
  const printArchive = async () => {
    await queryClient.fetchQuery({ ...api.printAllowed.queryOptions('contracts'), staleTime: 0 });
    const archive = await queryClient.fetchQuery({
      ...api.contracts.archive.queryOptions(),
      staleTime: 0,
    });
    await printTable(
      '合同档案',
      `本位币 ${archive.baseCurrency}；取数时间 ${archive.generatedAt}`,
      [
        '合同号',
        '名称',
        '客供',
        '签订日期',
        '类型',
        '合同金额',
        '期初收付',
        '说明',
        '备注1',
        '备注2',
        '录入人',
        '审核人',
      ],
      archive.rows.map((r) => [
        r.code,
        r.name,
        `${r.partnerCode} ${r.partnerName}`,
        r.signed_date,
        r.kind === 'receipt' ? '收款' : '付款',
        formatMoney(r.amount),
        formatMoney(r.opening),
        r.description,
        r.remark,
        r.remark2,
        r.creatorName,
        r.reviewerName ?? '未审核',
      ]),
    );
  };
  useHotkey('Ctrl+A', () => setEditing({ original: null }), {
    enabled: canEdit && !editing && !importing,
    allowInInput: false,
  });
  useHotkey(
    'Ctrl+K',
    () => {
      if (selected.data) setEditing({ original: selected.data, copy: true });
    },
    { enabled: canEdit && !editing && !importing, allowInInput: false },
  );
  useHotkey(
    'Ctrl+F',
    () => {
      void refreshContracts();
    },
    { enabled: !editing && !importing, allowInInput: false },
  );
  useHotkey(
    'Ctrl+R',
    () => {
      void selected.refetch();
    },
    { enabled: !editing && !importing && filters.id > 0, allowInInput: false },
  );
  useHotkey(
    'Ctrl+Q',
    () => {
      setFilters({ id: 0 });
      requestAnimationFrame(() => document.getElementById('contract-search')?.focus());
    },
    {
      enabled: !editing && !importing,
      allowInInput: false,
    },
  );
  useHotkey(
    'Ctrl+P',
    () => {
      void printArchive().catch(showError);
    },
    { enabled: canExport && !editing && !importing, allowInInput: false },
  );
  useHotkey('Ctrl+Home', () => move('first'), {
    enabled: !editing && !importing,
    allowInInput: false,
  });
  useHotkey('Ctrl+End', () => move('last'), {
    enabled: !editing && !importing,
    allowInInput: false,
  });
  useHotkey('ArrowUp', () => move('previous'), {
    enabled: !editing && !importing,
    allowInInput: false,
  });
  useHotkey('ArrowDown', () => move('next'), {
    enabled: !editing && !importing,
    allowInInput: false,
  });
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
        <Space wrap>
          {canExport && (
            <>
              <Button onClick={() => void exportArchive().catch(showError)}>
                导出合同档案Excel
              </Button>
              <Button onClick={() => void printArchive().catch(showError)}>打印合同档案</Button>
            </>
          )}
          {canEdit && <Button onClick={() => setImporting(true)}>导入合同档案</Button>}
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
          <Space wrap style={{ marginBottom: 12 }}>
            <Input
              id="contract-search"
              aria-label="合同定位查询"
              placeholder="合同号、名称、客供、说明或备注"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 350 }}
            />
            <Select
              aria-label="合同类型筛选"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'all', label: '全部类型' },
                { value: 'receipt', label: '收款' },
                { value: 'payment', label: '付款' },
              ]}
            />
            <Select
              aria-label="合同审核筛选"
              value={reviewed}
              onChange={setReviewed}
              options={[
                { value: 'all', label: '全部状态' },
                { value: 'yes', label: '已审核' },
                { value: 'no', label: '未审核' },
              ]}
            />
            <Button disabled={!rows.length} onClick={() => move('first')}>
              定位首条结果
            </Button>
            <span>共 {rows.length} 条</span>
          </Space>
          <Space wrap style={{ marginBottom: 12 }}>
            <Select
              aria-label="定位字段"
              value={field}
              onChange={(next) => {
                setField(next);
                if (next === 'amount' || next === 'opening') setOperator('equal');
              }}
              options={Object.entries(CONTRACT_SEARCH_FIELDS).map(([value, label]) => ({
                value,
                label,
              }))}
              style={{ width: 150 }}
            />
            <Select
              aria-label="定位条件"
              value={operator}
              onChange={setOperator}
              options={[
                ...(field === 'amount' || field === 'opening'
                  ? []
                  : [{ value: 'contains', label: '包含' }]),
                { value: 'equal', label: '等于' },
                { value: 'greater', label: '大于' },
                { value: 'less', label: '小于' },
                { value: 'empty', label: '为空' },
                { value: 'notEmpty', label: '非空' },
              ]}
              style={{ width: 110 }}
            />
            <Input
              aria-label="定位值"
              placeholder="金额按元填写，日期YYYY-MM-DD"
              value={conditionValue}
              onChange={(e) => setConditionValue(e.target.value)}
              style={{ width: 280 }}
            />
            <Button
              onClick={() => {
                const error = contractConditionError(field, operator, conditionValue);
                if (error) showError(error);
                else setCondition({ field, operator, value: conditionValue });
              }}
            >
              应用定位条件
            </Button>
            <Button disabled={!condition} onClick={() => setCondition(undefined)}>
              清除定位条件
            </Button>
          </Space>
          {query.isError && <ReportError error={query.error} retry={() => void query.refetch()} />}
          <DataTable
            tableId="analysis-contracts"
            rowKey="id"
            dataSource={rows}
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
              onCopy={() => setEditing({ original: selected.data, copy: true })}
              move={move}
            />
          )}
          {importing && (
            <ContractImportDrawer close={() => setImporting(false)} imported={refreshContracts} />
          )}
          {editing && (
            <ContractEditor
              key={`${editing.copy ? 'copy-' : ''}${editing.original?.id ?? 'new'}`}
              original={editing.original}
              copy={editing.copy}
              close={() => setEditing(null)}
            />
          )}
        </>
      )}
    </PageContainer>
  );
}
