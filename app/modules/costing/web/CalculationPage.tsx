import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Table,
  Typography,
} from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { formatMoney } from '@caiwu/core';
import { notify, queryClient, usePermission } from '@caiwu/web-kit';
import { PageContainer, useUrlFilters } from '@caiwu/ui';
import type { CalculationInput, CostRow } from '../shared';
import { api } from './api';
import DeletionImpact from './DeletionImpact';

export default function CalculationPage() {
  const context = useQuery(api.context.queryOptions());
  const [filters, setFilters] = useUrlFilters({ id: 0 });
  const [period, setPeriod] = useState<number | null>(null);
  const [adjust, setAdjust] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [requested, setRequested] = useState<CalculationInput | null>(null);
  const current =
    period ?? context.data?.nextCalculationPeriod ?? context.data?.currentPeriod ?? 202601;
  const preview = useQuery(
    api.preview.queryOptions(requested ?? { period: current }, {
      enabled: requested != null,
      retry: false,
    }),
  );
  const selected = useQuery(
    api.worksheet.queryOptions({ id: filters.id || 1 }, { enabled: !!filters.id, retry: false }),
  );
  const worksheets = useQuery(api.worksheets.queryOptions());
  const refresh = () => queryClient.invalidateQueries({ queryKey: api.worksheets.queryKey() });
  const save = useMutation(api.saveWorksheet.mutationOptions({ onSuccess: () => void refresh() }));
  const cancel = useMutation(
    api.cancelWorksheet.mutationOptions({
      onSuccess: () => {
        void refresh();
        void queryClient.invalidateQueries({ queryKey: api.worksheet.queryKey() });
      },
    }),
  );
  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: api.context.queryKey() });
    void queryClient.invalidateQueries({ queryKey: api.profit.queryKey() });
    void queryClient.invalidateQueries({ queryKey: api.worksheet.queryKey() });
    void queryClient.invalidateQueries({ queryKey: api.voucherDocuments.queryKey() });
    void refresh();
  };
  const commit = useMutation(
    api.commit.mutationOptions({
      onSuccess: () => {
        notify.success('成本核算完成，本月库存数据已锁定');
        setCommitOpen(false);
        setRequested(null);
        setFilters({ id: 0 });
        setRequestKey(crypto.randomUUID());
        refreshAll();
      },
    }),
  );
  const cancelPreview = useQuery(
    api.previewCancelCalculation.queryOptions(undefined, { enabled: false, retry: false }),
  );
  const cancelCalculation = useMutation(
    api.cancelCalculation.mutationOptions({
      onSuccess: () => {
        notify.success('已取消最后一次成本核算');
        setCancelOpen(false);
        setRequested(null);
        refreshAll();
      },
    }),
  );
  const canCalculate = usePermission('costing.calculate');
  const canSave = usePermission('costing.worksheet');
  const result = filters.id ? selected.data?.result : preview.data;
  const columns = [
    { title: '仓库', dataIndex: 'warehouseName', key: 'warehouseName' },
    { title: '产品编号', dataIndex: 'productCode', key: 'productCode' },
    { title: '产品名称', dataIndex: 'productName', key: 'productName' },
    ...(['openingQuantity', 'receivedQuantity', 'issuedQuantity', 'closingQuantity'] as const).map(
      (key, i) => ({
        title: ['期初数量', '入库数量', '出库数量', '结存数量'][i],
        dataIndex: key,
        key,
      }),
    ),
    ...(
      [
        'openingCents',
        'receivedCents',
        'issuedCents',
        'countCents',
        'zeroQuantityAdjustmentCents',
        'closingCents',
      ] as const
    ).map((key, i) => ({
      title: ['期初金额', '入库金额', '出库成本', '盘盈亏金额', '零数量调整', '结存金额'][i],
      key,
      render: (_: unknown, row: CostRow) => formatMoney(row[key]),
    })),
    { title: '盘盈亏数量', dataIndex: 'countDifference', key: 'countDifference' },
  ];
  const error = filters.id ? selected.error : preview.error;
  return (
    <PageContainer
      title="成本核算"
      subtitle="月末加权平均；逐仓库、逐产品计算，入库金额按不含税额取数"
    >
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <Alert
          type="info"
          showIcon
          title={
            context.data?.latestBatch
              ? `已核算至 ${context.data.latestBatch.period}，下次核算 ${context.data.nextCalculationPeriod}`
              : '请先试算并核对结果，再正式核算'
          }
          description="正式核算后，本月出入库、期初和盘点数据将被锁定。只能取消最后一次核算；相关凭证已审核或过账时须先取消审核或反过账。"
        />
        <Space wrap>
          <label>
            核算年月{' '}
            <InputNumber aria-label="核算年月" value={current} precision={0} onChange={setPeriod} />
          </label>
          <Checkbox checked={adjust} onChange={(e) => setAdjust(e.target.checked)}>
            自动调整没有数量还有金额的产品
          </Checkbox>
          <Button
            type="primary"
            loading={preview.isFetching}
            onClick={() => {
              setFilters({ id: 0 });
              if (requested?.period === current && requested.adjustZeroQuantity === adjust)
                void preview.refetch();
              else setRequested({ period: current, adjustZeroQuantity: adjust });
            }}
          >
            重新试算
          </Button>
          {canCalculate && (
            <>
              <Button
                type="primary"
                disabled={
                  !result ||
                  !!selected.data?.stale ||
                  (!!filters.id && selected.data?.status !== 'preview')
                }
                loading={commit.isPending}
                onClick={() => setCommitOpen(true)}
              >
                正式核算
              </Button>
              <Button
                danger
                loading={cancelPreview.isFetching}
                disabled={!context.data?.latestBatch}
                onClick={() =>
                  void cancelPreview.refetch().then(({ data }) => {
                    if (data) setCancelOpen(true);
                  })
                }
              >
                取消最后核算
              </Button>
            </>
          )}
          {canSave && !filters.id && preview.data && (
            <Button
              loading={save.isPending}
              onClick={() =>
                save.mutate({
                  period: preview.data!.period,
                  adjustZeroQuantity: requested?.adjustZeroQuantity ?? false,
                  fingerprint: preview.data!.fingerprint,
                })
              }
            >
              保存试算
            </Button>
          )}
        </Space>
        {(error || context.error || cancelPreview.error) && (
          <Alert type="error" title={(error ?? context.error ?? cancelPreview.error)?.message} />
        )}
        {selected.data && !!filters.id && (
          <Alert
            type={selected.data.stale ? 'warning' : 'info'}
            title={`试算 #${selected.data.id} · ${selected.data.status === 'cancelled' ? '已取消' : '未正式核算'}${selected.data.stale ? ' · 来源已变化，请重新试算' : ''}`}
          />
        )}
        {result && (
          <Table<CostRow>
            aria-label="成本试算结果"
            rowKey={(r) => `${r.warehouseId}:${r.productId}`}
            pagination={false}
            scroll={{ x: 1500 }}
            dataSource={result.rows}
            columns={columns}
            locale={{ emptyText: '没有可试算的库存数据' }}
          />
        )}
        <Typography.Title level={4}>已保存试算</Typography.Title>
        <Table
          rowKey="id"
          dataSource={worksheets.data ?? []}
          pagination={false}
          columns={[
            { title: '编号', dataIndex: 'id' },
            { title: '年月', dataIndex: 'period' },
            {
              title: '状态',
              key: 'status',
              render: (_, r) => (r.status === 'cancelled' ? '已取消' : '未正式核算'),
            },
            {
              title: '操作',
              key: 'actions',
              render: (_, r) => (
                <Space>
                  <Button onClick={() => setFilters({ id: r.id })}>查看试算</Button>
                  {canSave && r.status === 'preview' && (
                    <Popconfirm
                      title="取消这份成本试算？"
                      onConfirm={() =>
                        cancel.mutate({ id: r.id, revision: r.revision, confirmed: true })
                      }
                    >
                      <Button danger>取消试算</Button>
                    </Popconfirm>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Space>
      <Modal
        title="确认正式成本核算"
        open={commitOpen}
        onCancel={() => setCommitOpen(false)}
        confirmLoading={commit.isPending}
        okText="确认核算"
        cancelText="返回检查"
        onOk={() => {
          if (!result) return;
          commit.mutate({
            period: result.period,
            adjustZeroQuantity: filters.id
              ? !!selected.data?.adjust_zero_quantity
              : (requested?.adjustZeroQuantity ?? false),
            fingerprint: result.fingerprint,
            confirmed: true,
            requestKey,
          });
        }}
      >
        <Alert
          type="warning"
          showIcon
          title={`将正式核算 ${result?.period ?? ''}，锁定本月库存数据`}
          description="试算来源若有变化，系统会拒绝提交；请重新试算核对后再提交。"
        />
      </Modal>
      <Modal
        title="取消最后一次成本核算"
        open={cancelOpen}
        onCancel={() => setCancelOpen(false)}
        confirmLoading={cancelCalculation.isPending}
        okText="确认取消核算"
        cancelText="返回"
        onOk={() => {
          const value = cancelPreview.data;
          if (!value) return;
          cancelCalculation.mutate({
            batchId: value.batchId,
            revision: value.revision,
            fingerprint: value.fingerprint,
            confirmed: true,
            ...(value.voucherDeletion
              ? { voucherDeletion: { plan: value.voucherDeletion, confirmed: true } }
              : {}),
          });
        }}
      >
        <Typography.Paragraph>
          将取消 {cancelPreview.data?.period}{' '}
          的核算并恢复其前一批库存状态。取消失败时库存及凭证保持原状。
        </Typography.Paragraph>
        <DeletionImpact plan={cancelPreview.data?.voucherDeletion ?? null} />
      </Modal>
    </PageContainer>
  );
}
