import { BusinessError, today, periodOfDate } from '@caiwu/core';
import { useInvoiceFilters } from './useInvoiceFilters';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
} from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  coreApi,
  queryClient,
  showError,
  usePermission,
  useUnsavedChanges,
  useVoucherTypes,
} from '@caiwu/web-kit';
import { DataTable, FilterBar, MoneyText, PageContainer, PeriodPicker } from '@caiwu/ui';
import type { Direction, PlanInput } from '../shared';
import type { InvoiceRouter } from '../server/router';
import type { inferRouterOutputs } from '@trpc/server';
import { api } from './api';
import { invoiceColumns, Nav, QueryError } from './common';
import AllocationFields from './AllocationFields';
import RevokeButton from './RevokeButton';
type Plan = inferRouterOutputs<InvoiceRouter>['previewVoucher'];
export default function ProcessPage() {
  const [filters, setFilters] = useInvoiceFilters({
    direction: 'input',
    period: periodOfDate(today()),
    ids: '',
    generationId: 0,
  });
  const direction: Direction = filters.direction === 'output' ? 'output' : 'input';
  const list = useQuery(api.list.queryOptions({ direction, period: filters.period || undefined }));
  const groups = useQuery(api.groups.queryOptions({ id: filters.generationId || undefined }));
  const types = useVoucherTypes();
  const [selected, setSelected] = useState<React.Key[]>(
    filters.ids.split(',').filter(Boolean).map(Number),
  );
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestId, setRequestId] = useState('');
  const [newAccountsConfirmed, setNewAccountsConfirmed] = useState(false);
  const [regenerateConfirmed, setRegenerateConfirmed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editVersion, setEditVersion] = useState(0);
  const previewGeneration = useRef(0);
  const discardPreview = useCallback(() => {
    previewGeneration.current++;
    setPlan(null);
    setRequestId('');
    setNewAccountsConfirmed(false);
    setRegenerateConfirmed(false);
    setLoading(false);
  }, []);
  useEffect(() => {
    discardPreview();
  }, [direction, filters.period, list.data, discardPreview]);
  useEffect(
    () => () => {
      previewGeneration.current++;
    },
    [],
  );
  const [form] = Form.useForm<Omit<PlanInput, 'selection'>>();
  const regenerate = Form.useWatch('regenerate', form) as boolean | undefined;
  const can = usePermission('invoice.voucher');
  const canCreateAccounts = usePermission('invoice.account');
  const draft = useQuery({ ...api.processDraft.queryOptions(), enabled: can });
  const saveDraft = useMutation(
    api.saveProcessDraft.mutationOptions({
      onSuccess: () =>
        void queryClient.invalidateQueries({ queryKey: api.processDraft.queryKey() }),
    }),
  );
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: api.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: api.groups.queryKey() }),
      queryClient.invalidateQueries({ queryKey: api.vat.queryKey() }),
      queryClient.invalidateQueries({ queryKey: coreApi.accounts.list.queryKey() }),
    ]);
  const generate = useMutation(
    api.generate.mutationOptions({
      onSuccess: () => {
        discardPreview();
        setSelected([]);
        setDirty(false);
        form.setFieldValue('allocations', []);
        void queryClient.invalidateQueries({ queryKey: api.processDraft.queryKey() });
        void refresh();
      },
    }),
  );
  const revoke = useMutation(api.revoke.mutationOptions({ onSuccess: () => void refresh() }));
  const selection = (list.data ?? [])
    .filter((r) => selected.includes(r.id))
    .map((r) => ({ id: r.id, revision: r.revision }));
  const busy = generate.isPending || revoke.isPending || saveDraft.isPending;
  const markDirty = () => {
    setDirty(true);
    setEditVersion((v) => v + 1);
    discardPreview();
  };
  const persistDraft = async () => {
    await saveDraft.mutateAsync({
      direction,
      period: filters.period,
      selected: selected.map(Number),
      values: form.getFieldsValue(),
    });
    setDirty(false);
  };
  const restoreDraft = () => {
    const d = draft.data;
    if (!d || busy) return;
    setFilters({ direction: d.direction, period: d.period });
    setSelected(d.selected);
    form.resetFields();
    form.setFieldsValue(d.values);
    setDirty(false);
    discardPreview();
  };
  useUnsavedChanges({
    title: '发票制证输入',
    dirty,
    version: editVersion,
    save: async () => {
      if (busy) return false;
      await persistDraft();
      return true;
    },
    discard: () => {
      form.resetFields();
      setSelected([]);
      setDirty(false);
      discardPreview();
    },
  });
  async function preview(v: Omit<PlanInput, 'selection'>) {
    const generation = ++previewGeneration.current;
    setPlan(null);
    setNewAccountsConfirmed(false);
    setRegenerateConfirmed(false);
    setLoading(true);
    try {
      const p = await queryClient.fetchQuery({
        ...api.previewVoucher.queryOptions({ ...v, selection }),
        staleTime: 0,
      });
      if (generation !== previewGeneration.current) return;
      setRequestId(crypto.randomUUID());
      setPlan(p);
    } catch (e) {
      if (generation === previewGeneration.current) showError(e);
    } finally {
      if (generation === previewGeneration.current) setLoading(false);
    }
  }
  return (
    <PageContainer title="发票处理" subtitle="先审核发票，再预览并确认来源凭证；新凭证状态为待审核">
      <Nav />
      <FilterBar
        initialValues={{ direction, period: filters.period }}
        onSearch={(v) => {
          if (busy) return;
          if (dirty) {
            showError(
              new BusinessError({
                code: 'INVOICE_UNSAVED',
                message: '制证输入尚未保存，不能切换查询范围',
                hint: '先保存制证输入，或点击“放弃制证输入”后再查询',
              }),
            );
            return;
          }
          setFilters(v);
          discardPreview();
          setSelected([]);
          form.setFieldValue('allocations', []);
          setDirty(false);
        }}
      >
        <Form.Item label="方向" name="direction">
          <Select
            style={{ width: 140 }}
            options={[
              { value: 'input', label: '进项' },
              { value: 'output', label: '销项' },
            ]}
          />
        </Form.Item>
        <Form.Item name="period" label="归属月份">
          <PeriodPicker />
        </Form.Item>
      </FilterBar>
      <Alert
        type="info"
        title="红字按原借贷方向记负数；凭证按账套编号方式保存"
        description="已转出库的销项票在此生成收入凭证，销售成本另行核算。月汇总为所选同月份发票生成一张凭证；全部重新生成须选择原汇总凭证的全部来源发票。已审核或过账凭证不能重新生成；撤销收入凭证保留出库单。"
      />
      <QueryError error={list.error} retry={list.refetch} />
      <QueryError error={draft.error} retry={draft.refetch} />
      {draft.data && (
        <Alert
          type="info"
          title="有已保存的制证输入"
          action={
            <Popconfirm
              title="恢复已保存输入并放弃当前未保存的修改？"
              disabled={!dirty || busy}
              onConfirm={restoreDraft}
            >
              <Button
                disabled={busy}
                onClick={() => {
                  if (!dirty) restoreDraft();
                }}
              >
                恢复制证输入
              </Button>
            </Popconfirm>
          }
        />
      )}
      <DataTable
        tableId="invoice-process"
        rowKey="id"
        columns={invoiceColumns}
        dataSource={list.data ?? []}
        loading={list.isPending}
        rowSelection={{
          selectedRowKeys: selected,
          onChange: (keys) => {
            setSelected(keys);
            form.setFieldValue(
              'allocations',
              (form.getFieldValue('allocations') as PlanInput['allocations'])?.filter((a) =>
                keys.includes(a.invoiceId),
              ) ?? [],
            );
            markDirty();
          },
          getCheckboxProps: (r) => ({
            disabled:
              busy ||
              (r.state !== 'audited' &&
                r.state !== 'issued' &&
                !(regenerate && r.state === 'generated')) ||
              r.invoiceStatus !== 'normal',
          }),
        }}
      />
      {can && (
        <Form
          name="invoice-process-voucher"
          form={form}
          layout="inline"
          disabled={busy}
          initialValues={{ mode: 'monthly', date: today(), regenerate: false, allocations: [] }}
          onValuesChange={(changed) => {
            if (changed.regenerate === false) {
              const available = (list.data ?? [])
                .filter((r) => r.state === 'audited' || r.state === 'issued')
                .map((r) => r.id);
              setSelected((keys) => keys.filter((id) => available.includes(Number(id))));
              form.setFieldValue(
                'allocations',
                (form.getFieldValue('allocations') as PlanInput['allocations'])?.filter((a) =>
                  available.includes(a.invoiceId),
                ) ?? [],
              );
            }
            markDirty();
          }}
          onFinish={(v) => void preview(v)}
          style={{ margin: '20px 0' }}
        >
          <Form.Item label="凭证日期" name="date" rules={[{ required: true }]}>
            <Input type="date" />
          </Form.Item>
          <Form.Item label="凭证字" name="voucherTypeId" rules={[{ required: true }]}>
            <Select
              style={{ width: 140 }}
              options={types
                .filter((t) => !t.disabled)
                .map((t) => ({ value: t.id, label: t.name }))}
            />
          </Form.Item>
          <Form.Item name="mode" label="制证方式">
            <Select
              style={{ width: 200 }}
              options={[
                { value: 'individual', label: '每票一张凭证' },
                { value: 'monthly', label: '本月所选汇总一张' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="firstNumber"
            label="手工起始凭证号"
            getValueFromEvent={(value) => value ?? undefined}
          >
            <InputNumber min={1} precision={0} placeholder="自动编号留空" />
          </Form.Item>
          <Form.Item name="regenerate" valuePropName="checked">
            <Checkbox>全部重新生成（包含已制证发票）</Checkbox>
          </Form.Item>
          <Form.Item name="allocations" style={{ width: '100%' }}>
            <AllocationFields selection={selection} />
          </Form.Item>
          <Button
            htmlType="submit"
            aria-label="预览分录"
            aria-busy={loading}
            loading={loading}
            disabled={loading || !selection.length}
          >
            预览分录
          </Button>
          <Button
            onClick={() => {
              void persistDraft().catch(() => undefined);
            }}
            loading={saveDraft.isPending}
            disabled={busy || !dirty}
          >
            保存制证输入
          </Button>
          <Popconfirm
            title="放弃尚未保存的制证输入？"
            onConfirm={() => {
              form.resetFields();
              setSelected([]);
              setDirty(false);
              discardPreview();
            }}
          >
            <Button disabled={busy || !dirty}>放弃制证输入</Button>
          </Popconfirm>
        </Form>
      )}
      {plan && (
        <Card title="凭证预览（尚未保存）">
          <p>
            纳税人口径：
            {
              {
                general: '一般纳税人（用户声明）',
                small: '小规模纳税人（用户声明）',
                other: '其他口径（用户声明）',
              }[plan.settings.taxpayerBasis]
            }
            ；进项税额：
            {plan.settings.inputTaxTreatment === 'separate' ? '单列税科目' : '计入非抵扣成本/费用'}
            。凭证日期 {plan.date}，发票月份 {plan.period}。
          </p>
          {plan.replacements.length > 0 && (
            <Card size="small" title="将整体撤销并重新生成">
              <ul>
                {plan.replacements.map((r) => (
                  <li key={r.groupId}>
                    {r.displayNo}，来源发票 {r.members.map((m) => m.id).join('、')}
                  </li>
                ))}
              </ul>
              {plan.deletionPlan?.impacts
                .filter((i) => i.oldNumber !== i.number)
                .map((i) => (
                  <p key={i.id}>
                    凭证 #{i.id} 编号 {i.oldNumber} → {i.number}
                  </p>
                ))}
              <Checkbox
                checked={regenerateConfirmed}
                disabled={busy}
                onChange={(e) => setRegenerateConfirmed(e.target.checked)}
              >
                已核对原凭证与编号影响，确认撤销并重新生成
              </Checkbox>
              <p>撤销与新凭证一起保存；任一步失败均保留原凭证和发票关联。</p>
            </Card>
          )}
          {plan.newAccounts.length > 0 && (
            <Card size="small" title="拟新增往来下级科目（尚未保存）">
              <p>
                以下科目将在确认生成时与凭证一起保存；取消预览不会新增。新科目继承结算上级的核算设置，辅助项使用参数中统一指定值。
              </p>
              <ul>
                {plan.newAccounts.map((a) => (
                  <li key={a.code}>
                    {a.code} {a.fullName}
                  </li>
                ))}
              </ul>
              <Checkbox
                checked={newAccountsConfirmed}
                disabled={!canCreateAccounts || busy}
                onChange={(e) => setNewAccountsConfirmed(e.target.checked)}
              >
                已核对并同意新增以上科目
              </Checkbox>
              {!canCreateAccounts && <p>缺少“制证时确认新增往来下级科目”权限，请联系管理员。</p>}
            </Card>
          )}
          {plan.groups.map((g, i) => (
            <div key={i}>
              <h4>
                第 {i + 1} 张，来源发票 {g.ids.join('、')}
              </h4>
              <DataTable
                tableId="invoice-voucher-preview"
                rowKey={(_, idx) => String(idx)}
                dataSource={g.lines}
                columns={[
                  { key: 'summary', title: '摘要', dataIndex: 'summary', width: 260 },
                  { key: 'accountCode', title: '科目编码', dataIndex: 'accountCode', width: 120 },
                  { key: 'accountName', title: '科目', dataIndex: 'accountName', width: 200 },
                  {
                    key: 'dims',
                    title: '辅助项',
                    width: 170,
                    dataIndex: 'dimensionText',
                  },
                  { key: 'debit', title: '借方', dataIndex: 'debit', money: true, width: 130 },
                  { key: 'credit', title: '贷方', dataIndex: 'credit', money: true, width: 130 },
                  { key: 'currency', title: '币种', dataIndex: 'currency', width: 90 },
                  {
                    key: 'fcAmount',
                    title: '原币金额',
                    dataIndex: 'fcAmount',
                    money: true,
                    width: 130,
                  },
                  { key: 'exchangeRate', title: '汇率', dataIndex: 'exchangeRate', width: 100 },
                  { key: 'quantity', title: '数量', dataIndex: 'quantity', width: 100 },
                  { key: 'unitPrice', title: '单价', dataIndex: 'unitPrice', width: 120 },
                ]}
              />
              <Space>
                借方合计 <MoneyText value={g.debit} /> 贷方合计 <MoneyText value={g.credit} />
              </Space>
            </div>
          ))}
          <Popconfirm
            title={`确认生成 ${plan.groups.length} 张来源凭证？`}
            onConfirm={() =>
              generate.mutate({
                selection: plan.selection,
                date: plan.date,
                voucherTypeId: plan.voucherTypeId,
                mode: plan.mode,
                fingerprint: plan.fingerprint,
                requestId,
                newAccountsConfirmed,
                regenerate: plan.regenerate,
                regenerateConfirmed,
                allocations: plan.allocations,
                firstNumber: plan.firstNumber,
                deletionPlan: plan.deletionPlan ?? undefined,
              })
            }
          >
            <Button
              type="primary"
              loading={generate.isPending}
              disabled={
                generate.isPending ||
                (plan.newAccounts.length > 0 && (!canCreateAccounts || !newAccountsConfirmed)) ||
                (plan.replacements.length > 0 && !regenerateConfirmed)
              }
            >
              确认生成凭证
            </Button>
          </Popconfirm>
          <Button disabled={generate.isPending} onClick={discardPreview}>
            取消预览
          </Button>
        </Card>
      )}
      <h4>来源凭证批次</h4>
      <QueryError error={groups.error} retry={groups.refetch} />
      {(groups.data ?? []).map((g) => (
        <Card key={g.id} size="small" title={`批次 #${g.id}`} style={{ marginBottom: 12 }}>
          <Space wrap>
            <span>来源发票：{g.detail.ids.join('、')}</span>
            {g.voucher ? (
              <>
                <Link to={`/m/voucher-entry/edit?id=${g.voucher.id}`}>{g.voucher.displayNo}</Link>
                <span>
                  {
                    { draft: '草稿', pending: '待审核', audited: '已审核', posted: '已过账' }[
                      g.voucher.status
                    ]
                  }
                </span>
                <Link to={`/m/voucher-book?period=${g.voucher.period}&status=${g.voucher.status}`}>
                  去凭证处理
                </Link>
                {can && g.voucher.status === 'pending' && (
                  <RevokeButton
                    id={g.id}
                    expectedRevision={g.voucher.revision}
                    pending={revoke.isPending}
                    onConfirm={revoke.mutateAsync}
                  />
                )}
              </>
            ) : (
              <span>已整体撤销</span>
            )}
            {g.detail.ids.map((id) => (
              <Link key={id} to={`/m/invoice/${g.detail.settings.direction}?id=${id}`}>
                查看发票 #{id}
              </Link>
            ))}
          </Space>
        </Card>
      ))}
      {groups.isSuccess && !groups.data.length && <p>尚未生成来源凭证。</p>}
    </PageContainer>
  );
}
