import { today, periodOfDate } from '@caiwu/core';
import { useInvoiceFilters } from './useInvoiceFilters';
import { useState } from 'react';
import { Link } from 'react-router';
import { Alert, Button, Card, Checkbox, Form, Input, Popconfirm, Select, Space } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { coreApi, queryClient, showError, usePermission, useVoucherTypes } from '@caiwu/web-kit';
import { DataTable, FilterBar, MoneyText, PageContainer, PeriodPicker } from '@caiwu/ui';
import type { Direction, PlanInput } from '../shared';
import type { InvoiceRouter } from '../server/router';
import type { inferRouterOutputs } from '@trpc/server';
import { api } from './api';
import { invoiceColumns, Nav, QueryError } from './common';
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
  const [form] = Form.useForm<{ date: string; voucherTypeId: number; mode: PlanInput['mode'] }>();
  const can = usePermission('invoice.voucher');
  const canCreateAccounts = usePermission('invoice.account');
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
        setPlan(null);
        setSelected([]);
        void refresh();
      },
    }),
  );
  const revoke = useMutation(api.revoke.mutationOptions({ onSuccess: () => void refresh() }));
  const selection = (list.data ?? [])
    .filter((r) => selected.includes(r.id))
    .map((r) => ({ id: r.id, revision: r.revision }));
  async function preview(v: { date: string; voucherTypeId: number; mode: PlanInput['mode'] }) {
    setPlan(null);
    setNewAccountsConfirmed(false);
    setLoading(true);
    try {
      const p = await queryClient.fetchQuery({
        ...api.previewVoucher.queryOptions({ ...v, selection }),
        staleTime: 0,
      });
      setRequestId(crypto.randomUUID());
      setPlan(p);
    } catch (e) {
      showError(e);
    } finally {
      setLoading(false);
    }
  }
  return (
    <PageContainer title="发票处理" subtitle="先审核发票，再预览并确认来源凭证；新凭证状态为待审核">
      <Nav />
      <FilterBar
        initialValues={{ direction, period: filters.period }}
        onSearch={(v) => {
          setFilters(v);
          setPlan(null);
          setSelected([]);
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
        title="红字按原借贷方向记负数；凭证号由 core 分配"
        description="月汇总为所选同月份发票生成一张凭证；撤销将同时回退该凭证全部发票，已审核/过账凭证不能撤销。转出库单尚未实现，当前仅支持生成来源凭证。"
      />
      <QueryError error={list.error} retry={list.refetch} />
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
            setPlan(null);
          },
          getCheckboxProps: (r) => ({
            disabled: r.state !== 'audited' || r.invoiceStatus !== 'normal',
          }),
        }}
      />
      {can && (
        <Form
          name="invoice-process-voucher"
          form={form}
          layout="inline"
          initialValues={{ mode: 'monthly', date: today() }}
          onValuesChange={() => setPlan(null)}
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
          <Button htmlType="submit" loading={loading} disabled={!selection.length}>
            预览分录
          </Button>
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
                disabled={!canCreateAccounts}
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
              })
            }
          >
            <Button
              type="primary"
              loading={generate.isPending}
              disabled={
                plan.newAccounts.length > 0 && (!canCreateAccounts || !newAccountsConfirmed)
              }
            >
              确认生成凭证
            </Button>
          </Popconfirm>
          <Button
            disabled={generate.isPending}
            onClick={() => {
              setPlan(null);
              setNewAccountsConfirmed(false);
            }}
          >
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
                  <Popconfirm
                    title={`整体撤销此凭证及全部 ${g.detail.ids.length} 张发票关联？`}
                    onConfirm={() =>
                      revoke.mutate({
                        id: g.id,
                        expectedRevision: g.voucher!.revision,
                        confirmed: true,
                      })
                    }
                  >
                    <Button danger loading={revoke.isPending}>
                      整体撤销
                    </Button>
                  </Popconfirm>
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
