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
import { formatMoney, nextPeriod, sumCents } from '@caiwu/core';
import { queryClient, usePermission } from '@caiwu/web-kit';
import { PageContainer, useUrlFilters } from '@caiwu/ui';
import type { CalculationInput, CalculationResult, CostRow } from '../shared';
import { api } from './api';
import FormalBatches from './FormalBatches';

export default function CalculationPage() {
  const context = useQuery(api.context.queryOptions());
  const [filters, setFilters] = useUrlFilters({ id: 0 });
  const [period, setPeriod] = useState<number | null>(null);
  const [adjust, setAdjust] = useState(false);
  const [requested, setRequested] = useState<CalculationInput | null>(null);
  const [formalView, setFormalView] = useState<{
    result: CalculationResult;
    label: string;
  } | null>(null);
  const [publishIntent, setPublishIntent] = useState<{
    result: CalculationResult;
    requestKey: string;
  } | null>(null);
  const [publishRequest, setPublishRequest] = useState<{
    fingerprint: string;
    adjustZeroQuantity: boolean;
    requestKey: string;
  } | null>(null);
  const [notice, setNotice] = useState('');
  const current = period ?? context.data?.nextCalculationPeriod ?? 202601;
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
  const canSave = usePermission('costing.worksheet');
  const canCalculate = usePermission('costing.calculate');
  const publish = useMutation(
    api.commit.mutationOptions({
      onSuccess: (r) => {
        setPublishIntent(null);
        setRequested(null);
        setFormalView(null);
        setPeriod(nextPeriod(r.period));
        setNotice(`${r.period} 正式成本核算已发布，本月库存已锁定；凭证尚未生成。`);
        void queryClient.invalidateQueries();
      },
    }),
  );
  const usablePreview =
    !filters.id &&
    !formalView &&
    !!preview.data &&
    !preview.isFetching &&
    !preview.isError &&
    requested?.period === current &&
    requested.adjustZeroQuantity === adjust &&
    preview.data.period === current;
  const result = formalView?.result ?? (filters.id ? selected.data?.result : preview.data);

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
          type="warning"
          showIcon
          title="正式发布后，本月库存单据、期初和盘点将锁定"
          description="先试算并核对，再确认正式发布。保存试算仅保存预览；正式发布写入库存成本及月末结存，凭证生成仍待后续功能。撤销只能从最后有效月份开始。"
        />
        {notice && <Alert type="success" showIcon title={notice} />}
        {context.error && <Alert type="error" title={context.error.message} />}
        {context.data?.reason && <Alert type="error" title={context.data.reason} />}
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
              setFormalView(null);
              setNotice('');
              if (requested?.period === current && requested.adjustZeroQuantity === adjust)
                void preview.refetch();
              else setRequested({ period: current, adjustZeroQuantity: adjust });
            }}
          >
            重新试算
          </Button>
          {canSave && usablePreview && !!preview.data?.rows.length && (
            <Button
              loading={save.isPending}
              onClick={() =>
                save.mutate({
                  period: preview.data!.period,
                  adjustZeroQuantity: preview.data!.adjustZeroQuantity,
                  fingerprint: preview.data!.fingerprint,
                })
              }
            >
              保存试算
            </Button>
          )}
          {canCalculate &&
            usablePreview &&
            context.data?.canCommit &&
            context.data.nextCalculationPeriod === current && (
              <Button
                type="primary"
                onClick={() => {
                  publish.reset();
                  const result = preview.data!;
                  const samePreview =
                    publishRequest?.fingerprint === result.fingerprint &&
                    publishRequest.adjustZeroQuantity === result.adjustZeroQuantity;
                  const requestKey =
                    samePreview && publishRequest ? publishRequest.requestKey : crypto.randomUUID();
                  setPublishRequest({
                    fingerprint: result.fingerprint,
                    adjustZeroQuantity: result.adjustZeroQuantity,
                    requestKey,
                  });
                  setPublishIntent({ result, requestKey });
                }}
              >
                发布正式核算
              </Button>
            )}
        </Space>
        {formalView && (
          <Alert
            type="info"
            title={formalView.label}
            description="这里显示发布时保存的核算结果；当前有效成本请查看利润表。"
          />
        )}
        {error && <Alert type="error" title={error.message} />}
        {!filters.id && !formalView && preview.data && (
          <Alert
            type={usablePreview ? 'info' : 'warning'}
            title={`${preview.data.period} 成本试算${usablePreview ? ' · 尚未正式发布' : ' · 请重新试算后操作'}`}
          />
        )}
        {worksheets.error && <Alert type="error" title={worksheets.error.message} />}
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
            locale={{
              emptyText: formalView
                ? '本批次为空月正式核算记录'
                : '本月没有库存数据，可确认按空月正式核算',
            }}
          />
        )}
        <FormalBatches
          latestBatchId={context.data?.latestBatchId}
          historyValid={context.data?.historyValid ?? false}
          onView={(result, label) => {
            setFormalView({ result, label });
            setFilters({ id: 0 });
          }}
          onCancelled={(p) => {
            setFormalView(null);
            setRequested(null);
            setFilters({ id: 0 });
            setPeriod(p);
            setNotice(`${p} 正式成本核算已撤销，库存已恢复核算前态。`);
          }}
        />
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
                  <Button
                    onClick={() => {
                      setFormalView(null);
                      setFilters({ id: r.id });
                    }}
                  >
                    查看试算
                  </Button>
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
        title={publishIntent ? `确认发布 ${publishIntent.result.period} 正式成本核算？` : '确认正式发布'}
        open={!!publishIntent}
        okText="确认发布并锁定本月"
        cancelText="返回核对"
        confirmLoading={publish.isPending}
        cancelButtonProps={{ disabled: publish.isPending }}
        closable={!publish.isPending}
        maskClosable={false}
        onCancel={() => setPublishIntent(null)}
        onOk={() => {
          if (!publishIntent) return;
          publish.mutate({
            period: publishIntent.result.period,
            adjustZeroQuantity: publishIntent.result.adjustZeroQuantity,
            fingerprint: publishIntent.result.fingerprint,
            requestKey: publishIntent.requestKey,
            confirmed: true,
          });
        }}
      >
        {publishIntent && (
          <Space orientation="vertical">
            {publishIntent.result.rows.length === 0 && (
              <Alert
                type="warning"
                showIcon
                title="本月没有库存数据，将按空月正式核算"
                description="确认后将保存空月正式核算记录并锁定本月，下一月可继续核算；不会补造库存期初或结存。"
              />
            )}
            <Typography.Paragraph>
              核算范围为本月全部仓库和产品。出库成本{' '}
              {formatMoney(sumCents(publishIntent.result.rows.map((r) => r.issuedCents)))}；{' '}
              月末结存{' '}
              {formatMoney(sumCents(publishIntent.result.rows.map((r) => r.closingCents)))}。
            </Typography.Paragraph>
            <Typography.Paragraph>
              确认后将正式写入库存成本、盘点调整和月末结存，并锁定本月库存。来源有变化时会拒绝本次发布，请重新试算。
            </Typography.Paragraph>
            {publish.error && <Alert type="error" title={publish.error.message} />}
          </Space>
        )}
      </Modal>
    </PageContainer>
  );
}
