import { useState } from 'react';
import { Alert, Button, InputNumber, Modal, Select, Space, Table, Typography } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { formatMoney } from '@caiwu/core';
import {
  coreApi,
  notify,
  queryClient,
  useAccounts,
  usePermission,
  useVoucherTypes,
} from '@caiwu/web-kit';
import { AccountSelect, PeriodPicker } from '@caiwu/ui';
import type { inferRouterOutputs } from '@trpc/server';
import type { CostingRouter } from '../server/router';
import { api } from './api';
import DeletionImpact from './DeletionImpact';

type Config = inferRouterOutputs<CostingRouter>['profitConfig'];
export default function ProfitSettings({ initialPeriod }: { initialPeriod: number }) {
  const [period, setPeriod] = useState(initialPeriod);
  const config = useQuery(api.profitConfig.queryOptions({ period }));
  const allowed = usePermission('costing.voucher');
  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Space>
        <Typography.Text>费用归集与损益结转月份</Typography.Text>
        <PeriodPicker value={period} onChange={(p) => p && setPeriod(p)} />
      </Space>
      {config.error && <Alert type="error" title={config.error.message} />}
      {!allowed ? (
        <Typography.Text>请有成本凭证权限的操作员设置费用、税金归集科目。</Typography.Text>
      ) : (
        !config.isPending &&
        !config.error && (
          <Editor
            key={`${period}:${config.data?.revision ?? 0}`}
            period={period}
            config={config.data ?? null}
          />
        )
      )}
    </Space>
  );
}
function Editor({ period, config }: { period: number; config: Config }) {
  const [expenseAccountId, setExpense] = useState<number | undefined>(config?.expense_account_id);
  const [surchargeAccountId, setSurcharge] = useState<number | undefined>(
    config?.surcharge_account_id,
  );
  const [profitAccountId, setProfit] = useState<number | undefined>(config?.profit_account_id);
  const [requested, setRequested] = useState(false);
  const [operation, setOperation] = useState<'generate' | 'delete' | null>(null);
  const [voucherTypeId, setType] = useState<number>();
  const [number, setNumber] = useState<number | null>(null);
  const types = useVoucherTypes();
  const { byId } = useAccounts();
  const policy = useQuery(coreApi.voucherPolicy.get.queryOptions());
  const preview = useQuery(
    api.previewProfitTransfer.queryOptions({ period }, { enabled: requested, retry: false }),
  );
  const deletion = useQuery(
    api.previewDeleteProfitTransfer.queryOptions(
      { period },
      { enabled: operation === 'delete', retry: false },
    ),
  );
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: api.profitConfig.queryKey() });
    void queryClient.invalidateQueries({ queryKey: api.profit.queryKey() });
    void queryClient.invalidateQueries({ queryKey: coreApi.vouchers.list.queryKey() });
  };
  const save = useMutation(
    api.saveProfitConfig.mutationOptions({
      onSuccess: () => {
        notify.success('费用税金归集设置已保存');
        refresh();
      },
    }),
  );
  const generate = useMutation(
    api.generateProfitTransfer.mutationOptions({
      onSuccess: () => {
        notify.success('净利润结转凭证已保存');
        refresh();
      },
    }),
  );
  const remove = useMutation(
    api.deleteProfitTransfer.mutationOptions({
      onSuccess: () => {
        notify.success('净利润结转已取消');
        refresh();
      },
    }),
  );
  const selectedType = voucherTypeId ?? types[0]?.id;
  const manual = policy.data?.numbering === 'manual';
  const unchanged =
    config?.expense_account_id === expenseAccountId &&
    config?.surcharge_account_id === surchargeAccountId &&
    config?.profit_account_id === profitAccountId;
  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Alert
        type="info"
        title="销售费用和附加税按完整月份的不含税销售收入分摊，收入为零时按数量分摊"
        description="查询部分日期、仓库或产品不会重复分配全部费用。销项税不作为费用重复扣减。销售净利仅用于销售分析；下方净利润结转将结清本账套应转本年利润的全部损益余额（含未过账正式凭证）。"
      />
      <Space wrap>
        <label>
          销售费用科目{' '}
          <AccountSelect
            aria-label="销售费用科目"
            value={expenseAccountId}
            disabled={!!config?.voucher_id}
            onChange={(id) => setExpense(id ?? undefined)}
          />
        </label>
        <label>
          销售附加税科目{' '}
          <AccountSelect
            aria-label="销售附加税科目"
            value={surchargeAccountId}
            disabled={!!config?.voucher_id}
            onChange={(id) => setSurcharge(id ?? undefined)}
          />
        </label>
        <label>
          本年利润科目{' '}
          <AccountSelect
            aria-label="本年利润科目"
            value={profitAccountId}
            disabled={!!config?.voucher_id}
            onChange={(id) => setProfit(id ?? undefined)}
          />
        </label>
        <Button
          loading={save.isPending}
          disabled={
            !expenseAccountId || !surchargeAccountId || !profitAccountId || !!config?.voucher_id
          }
          onClick={() =>
            save.mutate({
              period,
              expenseAccountId: expenseAccountId!,
              surchargeAccountId: surchargeAccountId!,
              profitAccountId: profitAccountId!,
              revision: config?.revision ?? 0,
            })
          }
        >
          保存费用税金设置
        </Button>
        {!config?.voucher_id && (
          <Button
            disabled={!config || !unchanged}
            loading={preview.isFetching}
            onClick={() => {
              if (requested) void preview.refetch();
              else setRequested(true);
            }}
          >
            预览净利润结转
          </Button>
        )}
        {config?.voucher_id && (
          <>
            <a href={`/m/voucher-entry/edit?id=${config.voucher_id}`}>查看本月净利润结转凭证</a>
            <Button danger onClick={() => setOperation('delete')}>
              取消净利润结转
            </Button>
          </>
        )}
      </Space>
      {(preview.error || policy.error) && (
        <Alert type="error" title={(preview.error ?? policy.error)?.message} />
      )}
      {preview.data && !preview.error && (
        <>
          <Typography.Text>
            本次结转净利润：{formatMoney(preview.data.netProfitCents)} 元
          </Typography.Text>
          <Table
            rowKey={(_, i) => String(i)}
            pagination={false}
            dataSource={preview.data.lines}
            columns={[
              {
                title: '科目',
                key: 'account',
                render: (_, r) => {
                  const a = r.accountId ? byId.get(r.accountId) : null;
                  return a ? `${a.code} ${a.name}` : '';
                },
              },
              { title: '借方', key: 'debit', render: (_, r) => formatMoney(r.debit ?? 0) },
              { title: '贷方', key: 'credit', render: (_, r) => formatMoney(r.credit ?? 0) },
            ]}
          />
          <Space>
            <Select
              aria-label="利润结转凭证类型"
              style={{ width: 150 }}
              value={selectedType}
              onChange={setType}
              options={types.map((t) => ({ value: t.id, label: t.name }))}
            />
            {manual && (
              <InputNumber
                aria-label="利润结转凭证编号"
                min={1}
                precision={0}
                value={number}
                onChange={setNumber}
              />
            )}
            <Button
              type="primary"
              disabled={!unchanged || !selectedType || (manual && !number)}
              onClick={() => setOperation('generate')}
            >
              生成净利润结转凭证
            </Button>
          </Space>
        </>
      )}
      <Modal
        title={operation === 'delete' ? '取消净利润结转' : '确认净利润结转'}
        open={!!operation}
        okText="确认利润操作"
        cancelText="返回检查"
        confirmLoading={generate.isPending || remove.isPending}
        onCancel={() => setOperation(null)}
        okButtonProps={{
          disabled:
            operation === 'delete' && (!deletion.data || !!deletion.error || deletion.isFetching),
        }}
        onOk={() => {
          if (operation === 'generate' && preview.data && selectedType)
            generate.mutate({
              period,
              fingerprint: preview.data.fingerprint,
              voucherTypeId: selectedType,
              ...(manual && number ? { number } : {}),
              confirmed: true,
            });
          if (operation === 'delete' && deletion.data)
            remove.mutate({
              period,
              confirmed: true,
              voucherDeletion: { confirmed: true, plan: deletion.data },
            });
        }}
      >
        {operation === 'delete' ? (
          <>
            {deletion.error && <Alert type="error" title={deletion.error.message} />}
            <DeletionImpact plan={deletion.data ?? null} />
          </>
        ) : (
          <Typography.Paragraph>
            将按预览清零应结转的损益余额，保存为待审核凭证。请核对未过账业务及分录后确认。
          </Typography.Paragraph>
        )}
      </Modal>
    </Space>
  );
}
