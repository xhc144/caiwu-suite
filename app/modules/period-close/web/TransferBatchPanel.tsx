import { Alert, Button, Card, Checkbox, InputNumber, Modal, Popconfirm, Space, Tag } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { formatMoney } from '@caiwu/core';
import { queryClient, useAccounts, usePermission } from '@caiwu/web-kit';
import { api } from './api';

const STATUS_LABELS = {
  active: '进行中',
  failed: '本项失败，等待选择',
  completed: '批次已结束',
  stopped: '已停止，已完成项保留',
} as const;
const RESULT_LABELS = {
  generated: '已生成待审核凭证',
  existing: '已有凭证，未重复生成',
  zero: '转出为零，未生成凭证',
  skipped: '明确跳过，未生成凭证',
} as const;

export default function TransferBatchPanel({
  period,
  ruleIds,
  disabled = false,
}: {
  period: number;
  ruleIds: number[];
  disabled?: boolean;
}) {
  const navigate = useNavigate();
  const canGenerate = usePermission('period-close.transfer.generate');
  const { byId } = useAccounts();
  const definitions = useQuery(api.rules.queryOptions());
  const latest = useQuery({ ...api.transferBatch.queryOptions({ period }), enabled: !!period });
  const batch = latest.data;
  const preview = useQuery({
    ...api.transferBatchPreview.queryOptions({
      id: batch?.id ?? '00000000-0000-4000-8000-000000000000',
    }),
    enabled: !!batch && batch.state.status !== 'completed' && batch.state.status !== 'stopped',
  });
  const [orderConfirmation, setOrderConfirmation] = useState('');
  const [stepConfirmation, setStepConfirmation] = useState('');
  const [openedStep, setOpenedStep] = useState('');
  const [voucherNumber, setVoucherNumber] = useState<{ key: string; value: number | null }>({
    key: '',
    value: null,
  });
  const selectionKey = `${period}:${[...ruleIds].sort((a, b) => a - b).join(',')}`;
  const stepKey = `${batch?.id}:${batch?.revision}:${preview.data?.preview?.previewToken}`;
  const refresh = () => void queryClient.invalidateQueries();
  const start = useMutation(api.startTransferBatch.mutationOptions({ onSuccess: refresh }));
  const execute = useMutation(api.executeTransferBatch.mutationOptions({ onSuccess: refresh }));
  const decide = useMutation(api.decideTransferBatch.mutationOptions({ onSuccess: refresh }));
  const busy = disabled || start.isPending || execute.isPending || decide.isPending;
  const ongoing = batch && (batch.state.status === 'active' || batch.state.status === 'failed');
  const next = batch?.state.plan[batch.state.cursor];
  const item = preview.data?.preview?.items[0];
  const needsNumber =
    preview.data?.preview?.numbering === 'manual' &&
    !!item &&
    !item.zero &&
    !item.existingVoucherId;
  const currentNumber = voucherNumber.key === stepKey ? voucherNumber.value : null;
  const error = batch?.state.error ?? preview.data?.error;
  const selection = definitions.data?.filter((r) => ruleIds.includes(r.id)) ?? [];
  return (
    <Card title="逐项结转（失败后可继续）" size="small" style={{ margin: '12px 0' }}>
      <p>
        每项先预览再生成；失败时保留已完成项，可重试、跳过后继续或停止。后续金额按实际已完成的结转重新计算，关闭页面后可恢复。
      </p>
      {!ongoing && canGenerate && (
        <Space orientation="vertical">
          <div>
            本次顺序：
            {selection.map((r) => `${r.order}. ${r.code} ${r.name}`).join(' → ') ||
              '请先勾选结转类型'}
          </div>
          <Checkbox
            checked={orderConfirmation === selectionKey}
            onChange={(e) => setOrderConfirmation(e.target.checked ? selectionKey : '')}
          >
            已确认逐项结转顺序；失败后由我选择是否继续
          </Checkbox>
          <Button
            disabled={
              busy ||
              latest.isFetching ||
              !period ||
              !ruleIds.length ||
              orderConfirmation !== selectionKey
            }
            loading={start.isPending}
            onClick={() => start.mutate({ period, ruleIds, confirmed: true })}
          >
            开始逐项结转
          </Button>
        </Space>
      )}
      {batch && (
        <>
          <p>
            <Tag
              color={
                batch.state.status === 'failed'
                  ? 'error'
                  : batch.state.status === 'completed'
                    ? 'success'
                    : 'processing'
              }
            >
              {STATUS_LABELS[batch.state.status]}
            </Tag>
            已处理 {batch.state.cursor}/{batch.state.plan.length} 项
          </p>
          <ol>
            {batch.state.plan.map((r) => {
              const result = batch.state.results.find((s) => s.ruleId === r.id);
              return (
                <li key={r.id}>
                  {r.code} {r.name}：
                  {result
                    ? RESULT_LABELS[result.status]
                    : next?.id === r.id
                      ? '当前项'
                      : '尚未处理'}
                  {result?.reason && <span>（{result.reason}）</span>}
                  {result?.voucherId && (
                    <Button
                      type="link"
                      onClick={() => void navigate(`/m/voucher-entry/edit?id=${result.voucherId}`)}
                    >
                      查看凭证
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
          {error && (
            <Alert
              type="error"
              showIcon
              title={`${next?.code ?? ''} ${error.message}`}
              description={error.hint}
              style={{ marginBottom: 12 }}
            />
          )}
          {ongoing && canGenerate && (
            <Space wrap>
              {batch.state.status === 'active' && (
                <Button
                  disabled={busy || preview.isFetching || !item}
                  loading={preview.isFetching}
                  onClick={() => {
                    setStepConfirmation('');
                    setVoucherNumber({ key: stepKey, value: null });
                    setOpenedStep(stepKey);
                  }}
                >
                  预览当前结转 {next?.code}
                </Button>
              )}
              {batch.state.status === 'active' && error && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    decide.mutate({
                      id: batch.id,
                      revision: batch.revision,
                      decision: 'retry',
                      confirmed: true,
                    })
                  }
                >
                  重新检查本项
                </Button>
              )}
              {batch.state.status === 'failed' && (
                <>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      decide.mutate({
                        id: batch.id,
                        revision: batch.revision,
                        decision: 'retry',
                        confirmed: true,
                      })
                    }
                  >
                    重新检查并重试本项
                  </Button>
                  <Popconfirm
                    title={`跳过 ${next?.code} 并继续其余结转？`}
                    description="本项不生成凭证，后续将按实际成功项重新预览；跳过记录会保存。"
                    onConfirm={() =>
                      decide.mutate({
                        id: batch.id,
                        revision: batch.revision,
                        decision: 'skip',
                        confirmed: true,
                      })
                    }
                  >
                    <Button disabled={busy}>跳过失败项，继续其余结转</Button>
                  </Popconfirm>
                </>
              )}
              <Popconfirm
                title="停止本批次？"
                description="已完成的结转凭证保留；尚未处理的项目不会生成凭证。"
                onConfirm={() =>
                  decide.mutate({
                    id: batch.id,
                    revision: batch.revision,
                    decision: 'stop',
                    confirmed: true,
                  })
                }
              >
                <Button disabled={busy}>停止本批次</Button>
              </Popconfirm>
              <Button disabled={busy} onClick={refresh}>
                恢复 / 刷新批次
              </Button>
            </Space>
          )}
          {batch.state.status === 'completed' && (
            <Alert
              type={batch.state.results.some((r) => r.status === 'skipped') ? 'warning' : 'success'}
              title={
                batch.state.results.some((r) => r.status === 'skipped')
                  ? '批次已结束，存在跳过项，请核对后补转'
                  : '本批次结转已处理完毕'
              }
              description="已生成凭证为待审核；请其他操作员审核后再过账。"
              showIcon
            />
          )}
        </>
      )}
      <Modal
        open={!!batch && openedStep === stepKey && !!item && batch.state.status === 'active'}
        title={`逐项结转预览：${item?.code ?? ''}`}
        width={900}
        okText="确认生成本项并继续"
        cancelText="取消"
        confirmLoading={execute.isPending}
        okButtonProps={{
          disabled: stepConfirmation !== stepKey || !canGenerate || (needsNumber && !currentNumber),
        }}
        onCancel={() => setOpenedStep('')}
        onOk={() => {
          if (batch && preview.data?.preview)
            execute.mutate({
              id: batch.id,
              revision: batch.revision,
              previewToken: preview.data.preview.previewToken,
              confirmed: true,
              number: needsNumber && currentNumber ? currentNumber : undefined,
            });
        }}
      >
        <p>按已成功的前序结转计算；失败项没有进入基数。</p>
        {needsNumber && (
          <p>
            <label>
              本项凭证号{' '}
              <InputNumber
                aria-label="本项凭证号"
                min={1}
                max={2147483647}
                precision={0}
                value={currentNumber}
                onChange={(value) => setVoucherNumber({ key: stepKey, value })}
              />
            </label>
          </p>
        )}
        {item?.zero ? (
          <p>转出为零，本项不生成空凭证。</p>
        ) : item?.existingVoucherId ? (
          <p>本项已有凭证，不重复生成。</p>
        ) : (
          <>
            <p>
              借方 {formatMoney(item?.debit ?? 0)} / 贷方 {formatMoney(item?.credit ?? 0)}
            </p>
            {item?.lines.map((line, index) => (
              <p key={index}>
                {byId.get(line.accountId!)?.code} {byId.get(line.accountId!)?.name}：借{' '}
                {formatMoney(line.debit)}，贷 {formatMoney(line.credit)}
                {line.currency ? `，${line.currency} ${formatMoney(line.fcAmount ?? 0)}` : ''}
                {line.quantity && line.quantity !== '0' ? `，数量 ${line.quantity}` : ''}
              </p>
            ))}
          </>
        )}
        <Checkbox
          checked={stepConfirmation === stepKey}
          onChange={(e) => setStepConfirmation(e.target.checked ? stepKey : '')}
        >
          已确认本项金额和分录，执行后再预览下一项
        </Checkbox>
      </Modal>
    </Card>
  );
}
