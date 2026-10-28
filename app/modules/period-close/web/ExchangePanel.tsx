import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Typography,
} from 'antd';
import type { FormInstance } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { inferRouterOutputs } from '@trpc/server';
import { DIMENSION_TYPES, formatMoney, VOUCHER_STATUS_LABELS } from '@caiwu/core';
import {
  coreApi,
  queryClient,
  useAccounts,
  useDimensionItems,
  usePermission,
  useUnsavedChanges,
  useVoucherTypes,
} from '@caiwu/web-kit';
import { AccountSelect, DimensionSelect } from '@caiwu/ui';
import type { ExchangeSettings } from '../shared';
import type { PeriodCloseRouter } from '../server/router';
import { api } from './api';

type Output = inferRouterOutputs<PeriodCloseRouter>;
export default function ExchangePanel({ period }: { period: number }) {
  const [form] = Form.useForm<ExchangeSettings>();
  const settings = useQuery({
    ...api.exchangeSettings.queryOptions({ period }),
    enabled: !!period,
  });
  const { accounts, byId } = useAccounts();
  const types = useVoucherTypes();
  const canEdit = usePermission('period-close.transfer.edit');
  const canGenerate = usePermission('period-close.transfer.generate');
  const [dirty, setDirty] = useState(false);
  const version = useRef(0);
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<Output['exchangePreview'] | null>(null);
  const [deletion, setDeletion] = useState<Output['deleteExchangePreview'] | null>(null);
  const saved = useRef<ExchangeSettings | null>(null);
  const loadedAt = useRef(0);
  const dimensions = [
    useDimensionItems('project'),
    useDimensionItems('partner'),
    useDimensionItems('department'),
    useDimensionItems('person'),
  ].flatMap((d) => d.items);
  useEffect(() => {
    if (!settings.data || dirty || loadedAt.current === settings.dataUpdatedAt) return;
    loadedAt.current = settings.dataUpdatedAt;
    const data = settings.data.settings ?? {
      period,
      voucherTypeId: types[0]?.id,
      summary: '期末汇兑损益调整',
      accountIds: [],
      rates: [],
    };
    form.setFieldsValue(data);
    saved.current = form.getFieldsValue(true) as ExchangeSettings;
  }, [settings.data, settings.dataUpdatedAt, period, types, form, dirty]);
  const changed = () => {
    version.current += 1;
    setDirty(true);
    setPreview(null);
  };
  const save = useMutation(api.saveExchangeSettings.mutationOptions());
  const persist = async () => {
    const data = await form.validateFields();
    const input = { ...data, period };
    const snapshotVersion = version.current;
    const result = await save.mutateAsync(input);
    const key = api.exchangeSettings.queryKey({ period });
    await queryClient.cancelQueries({ queryKey: key });
    queryClient.setQueryData<Output['exchangeSettings']>(key, (previous) =>
      previous ? { ...previous, settings: input } : previous,
    );
    saved.current = input;
    loadedAt.current = queryClient.getQueryState(key)?.dataUpdatedAt ?? 0;
    if (version.current === snapshotVersion) setDirty(false);
    setNotice(result.message);
    await queryClient.invalidateQueries({ queryKey: key });
  };
  useUnsavedChanges({
    title: '汇兑损益设置',
    dirty: dirty || save.isPending,
    version: version.current,
    save: persist,
    discard: () => {
      form.resetFields();
      if (saved.current) form.setFieldsValue(saved.current);
      setDirty(false);
    },
  });
  const refreshed = (message: string) => {
    setNotice(message);
    setPreview(null);
    setDeletion(null);
    void queryClient.invalidateQueries();
  };
  const generate = useMutation(
    api.generateExchange.mutationOptions({ onSuccess: (r) => refreshed(r.message) }),
  );
  const remove = useMutation(
    api.deleteExchange.mutationOptions({ onSuccess: (r) => refreshed(r.message) }),
  );
  const previewQuery = useQuery({
    ...api.exchangePreview.queryOptions({ period }),
    enabled: false,
  });
  const deletionQuery = useQuery({
    ...api.deleteExchangePreview.queryOptions({ period }),
    enabled: false,
  });
  const existing = settings.data?.existing;
  return (
    <Card title="汇兑损益" role="region" aria-label="汇兑损益" loading={settings.isLoading}>
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          title="选择本期需折算的货币性外币科目，逐项核对期末汇率；先办理汇兑，再办理月度损益结转。"
          description="按科目和辅助项分别折算并四舍五入。凭证只调整本币账面余额，不改变外币和数量，也不作为实际现金收付。"
        />
        {notice && <Alert type="success" title={notice} closable onClose={() => setNotice('')} />}
        {existing && (
          <Typography.Text>
            本期汇兑凭证：{existing.displayNo}（{VOUCHER_STATUS_LABELS[existing.status]}）
          </Typography.Text>
        )}
        <Form
          name="period-close-exchange"
          form={form}
          layout="vertical"
          onValuesChange={changed}
          disabled={!canEdit || !!existing || save.isPending}
        >
          <Form.Item name="voucherTypeId" label="汇兑凭证类型" rules={[{ required: true }]}>
            <Select
              options={types
                .filter((t) => !t.disabled)
                .map((t) => ({ value: t.id, label: `${t.code} ${t.name}` }))}
            />
          </Form.Item>
          {settings.data?.numbering === 'manual' && (
            <Form.Item name="number" label="汇兑凭证号" rules={[{ required: true }]}>
              <InputNumber min={1} max={2147483647} precision={0} />
            </Form.Item>
          )}
          <Form.Item name="summary" label="汇兑凭证摘要" rules={[{ required: true }]}>
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item
            name="accountIds"
            label="需折算的货币性外币科目"
            rules={[{ required: true, type: 'array', min: 1 }]}
          >
            <Select
              mode="multiple"
              placeholder="选择应收、应付、银行存款等需折算的末级科目"
              showSearch={{ optionFilterProp: 'label' }}
              options={accounts
                .filter((a) => a.isLeaf && !a.disabled && a.currency)
                .map((a) => ({ value: a.id, label: `${a.code} ${a.fullName}（${a.currency}）` }))}
            />
          </Form.Item>
          <Form.List name="rates">
            {(fields, { add, remove: removeRate }) => (
              <Space orientation="vertical" style={{ width: '100%' }}>
                {fields.map((field) => (
                  <Card
                    key={field.key}
                    size="small"
                    title={`币种折算设置 ${field.name + 1}`}
                    extra={
                      <Button
                        danger
                        onClick={() => {
                          removeRate(field.name);
                          changed();
                        }}
                      >
                        移除币种
                      </Button>
                    }
                  >
                    <Form.Item
                      name={[field.name, 'currency']}
                      label="折算币种"
                      rules={[{ required: true }]}
                    >
                      <Select
                        options={settings.data?.currencies.map((c) => ({
                          value: c.code,
                          label: `${c.code} ${c.name}`,
                        }))}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'rate']}
                      label="期末汇率（每外币单位折合本币元）"
                      rules={[{ required: true }]}
                    >
                      <Input inputMode="decimal" maxLength={40} placeholder="例如 7.2" />
                    </Form.Item>
                    <RateTarget form={form} index={field.name} />
                  </Card>
                ))}
                <Button
                  onClick={() => {
                    add({ dimensions: {} });
                    changed();
                  }}
                >
                  增加折算币种
                </Button>
              </Space>
            )}
          </Form.List>
          <Button
            style={{ marginTop: 16 }}
            type="primary"
            disabled={!canEdit || !!existing}
            loading={save.isPending}
            onClick={() => {
              void persist().catch(() => {
                /* 表单和统一业务提示保留错误，当前输入继续保留。 */
              });
            }}
          >
            保存汇兑设置
          </Button>
        </Form>
        <Space wrap>
          <Button
            disabled={dirty || !settings.data?.settings}
            loading={previewQuery.isFetching}
            onClick={async () => {
              const r = await previewQuery.refetch();
              if (r.data && !r.error) setPreview(r.data);
            }}
          >
            汇兑损益预览
          </Button>
          <Button
            danger
            disabled={!canGenerate || !existing}
            loading={deletionQuery.isFetching}
            onClick={async () => {
              const r = await deletionQuery.refetch();
              if (r.data && !r.error) setDeletion(r.data);
            }}
          >
            预览撤销汇兑
          </Button>
          {dirty && <Typography.Text type="warning">汇兑设置有未保存修改</Typography.Text>}
        </Space>
      </Space>
      <Modal
        open={!!preview}
        title="汇兑损益预览"
        width={1100}
        onCancel={() => setPreview(null)}
        footer={
          <Space>
            <Button onClick={() => setPreview(null)}>取消</Button>
            <Button
              type="primary"
              disabled={!canGenerate || !!preview?.existingVoucherId || !preview?.lines.length}
              loading={generate.isPending}
              onClick={() =>
                preview &&
                generate.mutate({ period, confirmed: true, previewToken: preview.previewToken })
              }
            >
              确认生成汇兑凭证
            </Button>
          </Space>
        }
      >
        {preview && (
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Typography.Paragraph>{preview.message}</Typography.Paragraph>
            {!!preview.drafts && (
              <Alert type="warning" title={`本期另有 ${preview.drafts} 张草稿，未计入折算基数`} />
            )}
            {preview.existingVoucherId && (
              <Alert type="info" title="本期汇兑凭证已经生成，预览用于核对，不会重复制证" />
            )}
            <Table
              size="small"
              pagination={false}
              scroll={{ x: 1000 }}
              dataSource={preview.rows.map((r, i) => ({ ...r, key: i }))}
              columns={[
                { title: '外币科目', render: (_, r) => `${r.accountCode} ${r.accountName}` },
                {
                  title: '辅助项',
                  render: (_, r) =>
                    Object.entries(r.dimensions)
                      .filter(([k, id]) => k !== 'cashflow' && id != null)
                      .map(([, id]) => {
                        const d = dimensions.find((item) => item.id === id);
                        return d ? `${d.code} ${d.name}` : '辅助项缺失';
                      })
                      .join(' / ') || '无',
                },
                { title: '币种', dataIndex: 'currency' },
                { title: '外币余额', render: (_, r) => formatMoney(r.foreignBalance) },
                { title: '账面本币余额', render: (_, r) => formatMoney(r.bookBalance) },
                { title: '期末汇率', dataIndex: 'rate' },
                { title: '折算后本币余额', render: (_, r) => formatMoney(r.translatedBalance) },
                { title: '本币调整（借正贷负）', render: (_, r) => formatMoney(r.difference) },
              ]}
            />
            <Typography.Text>
              借方 {formatMoney(preview.debit)} / 贷方 {formatMoney(preview.credit)}
            </Typography.Text>
            <Table
              size="small"
              pagination={false}
              dataSource={preview.lines.map((l, i) => ({ ...l, key: i }))}
              columns={[
                {
                  title: '科目',
                  render: (_, l) => {
                    const a = byId.get(l.accountId!);
                    return `${a?.code} ${a?.fullName}`;
                  },
                },
                { title: '摘要', dataIndex: 'summary' },
                { title: '借方', render: (_, l) => formatMoney(l.debit ?? 0) },
                { title: '贷方', render: (_, l) => formatMoney(l.credit ?? 0) },
                {
                  title: '外币调整',
                  render: (_, l) =>
                    l.currency ? `${l.currency} ${formatMoney(l.fcAmount ?? 0)}` : '—',
                },
              ]}
            />
          </Space>
        )}
      </Modal>
      <Modal
        open={!!deletion}
        title="确认撤销汇兑及编号影响"
        onCancel={() => setDeletion(null)}
        footer={
          <Space>
            <Button onClick={() => setDeletion(null)}>取消</Button>
            <Button
              danger
              type="primary"
              loading={remove.isPending}
              onClick={() =>
                deletion && remove.mutate({ period, confirmed: true, plan: deletion.plan })
              }
            >
              确认撤销汇兑
            </Button>
          </Space>
        }
      >
        {deletion && (
          <>
            <Typography.Paragraph>
              将删除本期汇兑凭证 {deletion.displayNo}。已审核或已过账时须先反过账并取消审核。
            </Typography.Paragraph>
            {deletion.plan.impacts.some((i) => i.number !== i.oldNumber) ? (
              <>
                <Alert type="warning" title="删除后将调整下列凭证编号，影响已打印凭证" />
                {deletion.plan.impacts
                  .filter((i) => i.number !== i.oldNumber)
                  .map((i) => (
                    <div key={i.id}>
                      凭证号 {i.oldNumber} → {i.number}
                    </div>
                  ))}
              </>
            ) : (
              <Typography.Paragraph>其余凭证编号不变。</Typography.Paragraph>
            )}
          </>
        )}
      </Modal>
    </Card>
  );
}
function RateTarget({ form, index }: { form: FormInstance<ExchangeSettings>; index: number }) {
  const { byId } = useAccounts();
  const target = byId.get(Form.useWatch(['rates', index, 'gainLossAccountId'], form));
  const categories = useQuery(coreApi.accounts.categories.queryOptions()).data ?? [];
  const pnl = new Set(categories.filter((c) => c.isPnl).map((c) => c.id));
  return (
    <>
      <Form.Item
        name={[index, 'gainLossAccountId']}
        label="汇兑损益科目"
        rules={[{ required: true }]}
      >
        <AccountSelect
          filter={(a) =>
            pnl.has(a.categoryId) && !a.currency && !a.quantityUnit && !a.cashflowRequired
          }
        />
      </Form.Item>
      {target?.dimensions
        .filter((d) => d.type !== 'cashflow')
        .map((d) => (
          <Form.Item
            key={d.type}
            name={[index, 'dimensions', d.type]}
            label={`汇兑损益${DIMENSION_TYPES.find((t) => t.id === d.type)!.name}`}
            rules={[{ required: d.required && !d.defaultItemId }]}
          >
            <DimensionSelect type={d.type} />
          </Form.Item>
        ))}
    </>
  );
}
