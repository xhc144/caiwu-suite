import { useAssetFilters as useUrlFilters } from './common';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Alert, Button, Checkbox, Drawer, Form, Input, Select, Space, Typography } from 'antd';
import { DataTable, PageContainer, type DataColumn } from '@caiwu/ui';
import { formatMoney, qtyFromE6 } from '@caiwu/core';
import { notify, useAccounts, usePermission, useRequiredSession } from '@caiwu/web-kit';
import { api, type Outputs } from './api';
import { Confirm, EmptyError, refresh } from './common';
import { VoucherDeletionPreview } from './VoucherDeletionPreview';
import { useAssetDraft } from './useAssetDraft';
export default function DepreciationPage() {
  const navigate = useNavigate();
  const session = useRequiredSession();
  const [filters, setFilters] = useUrlFilters({ period: session.book.startPeriod, id: 0 });
  const [period, setPeriod] = useState(filters.period);
  const batches = useQuery(api.batches.queryOptions()),
    cards = useQuery(api.list.queryOptions({}));
  const [periodInput, setPeriodInput] = useState(String(period));
  const [show, setShow] = useState(false),
    [skip, setSkip] = useState(false),
    [voucherId, setVoucherId] = useState<number | null>(null),
    [cancelId, setCancelId] = useState<number | null>(null),
    [workId, setWorkId] = useState<number>(),
    [work, setWork] = useState('');
  const preview = useQuery({ ...api.preview.queryOptions({ period }), enabled: show });
  const can = usePermission('fixed-assets.depreciate'),
    canCancel = usePermission('fixed-assets.cancel'),
    canVoucher = usePermission('fixed-assets.voucher');
  const depreciate = useMutation(
    api.depreciate.mutationOptions({
      onSuccess: () => {
        notify.success('本月折旧已保存');
        setShow(false);
        void refresh();
      },
    }),
  );
  const saveWork = useMutation(
    api.setWork.mutationOptions({
      onSuccess: () => {
        notify.success('月工作量已保存');
        setShow(false);
        void refresh();
      },
    }),
  );
  const workDraft = useAssetDraft({
    title: '固定资产月工作量',
    save: async () => {
      if (!workId || !work) {
        notify.warning('请先选择工作量资产并填写当月工作量');
        return false;
      }
      await saveWork.mutateAsync({
        id: workId,
        period: Number(periodInput),
        quantity: work,
      });
    },
    discard: () => {
      setWorkId(undefined);
      setWork('');
    },
  });
  const columns: DataColumn<Outputs['batches'][number]>[] = [
    { key: 'period', title: '计提月份', dataIndex: 'period', width: 120 },
    { key: 'total', title: '折旧合计', dataIndex: 'total', money: true },
    {
      key: 'voucher',
      title: '凭证',
      width: 170,
      render: (_, b) =>
        b.voucher ? (
          <Button
            type="link"
            onClick={() => void navigate(`/m/voucher-entry/edit?id=${b.voucher_id}`)}
          >
            {b.voucher.displayNo}{' '}
            {b.voucher.status === 'pending'
              ? '待审核'
              : b.voucher.status === 'audited'
                ? '已审核'
                : '已过账'}
          </Button>
        ) : b.requiresVoucher ? (
          '未生成'
        ) : (
          '本月无需制证'
        ),
    },
    {
      key: 'op',
      title: '操作',
      noExport: true,
      width: 320,
      render: (_, b) => (
        <Space>
          {canVoucher && b.requiresVoucher && (
            <Button onClick={() => setVoucherId(b.id)}>凭证预览/生成</Button>
          )}
          {canCancel && (
            <Button danger onClick={() => setCancelId(b.id)}>
              取消此月折旧
            </Button>
          )}
        </Space>
      ),
    },
  ];
  return (
    <PageContainer title="计提与取消折旧">
      <Alert
        title="使用当月不提，次月开始。平均年限法按剩余月份分摊到分，尾差随剩余月份分配；工作量法需录入当月工作量。"
        style={{ marginBottom: 16 }}
      />
      <Space wrap style={{ marginBottom: 16 }}>
        <label htmlFor="depreciation-period">计提月份</label>
        <Input
          inputMode="numeric"
          id="depreciation-period"
          value={periodInput}
          onChange={(e) => {
            setPeriodInput(e.target.value);
            setShow(false);
            if (workId || work) workDraft.changed();
          }}
        />
        <Button
          type="primary"
          onClick={() => {
            const chosen = Number(periodInput);
            setPeriod(chosen);
            setFilters({ period: chosen });
            setShow(true);
          }}
        >
          预览本月折旧
        </Button>
      </Space>
      {can && (
        <Form layout="inline" style={{ marginBottom: 16 }}>
          <Form.Item label="工作量资产">
            <Select
              aria-label="工作量资产"
              style={{ width: 240 }}
              value={workId}
              onChange={(value) => {
                setWorkId(value);
                workDraft.changed();
              }}
              options={(cards.data ?? [])
                .filter((c) => c.method === '2')
                .map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))}
            />
          </Form.Item>
          <Form.Item label="当月工作量">
            <Input
              aria-label="当月工作量"
              value={work}
              onChange={(e) => {
                setWork(e.target.value);
                workDraft.changed();
              }}
            />
          </Form.Item>
          <Button
            disabled={!workId || !work}
            loading={workDraft.saving}
            onClick={() => void workDraft.save().catch(() => {})}
          >
            保存工作量
          </Button>
        </Form>
      )}
      {show && preview.data && (
        <>
          {preview.data.existingId ? (
            <Alert title="本月已经计提，不会重复计提" />
          ) : (
            <>
              <DataTable
                tableId="fixed-assets-depreciation-preview"
                rowKey="assetId"
                dataSource={preview.data.rows}
                columns={[
                  { key: 'code', title: '设备编号', dataIndex: 'code', width: 120 },
                  { key: 'name', title: '名称', dataIndex: 'name', width: 160 },
                  {
                    key: 'work',
                    title: '月工作量',
                    width: 110,
                    render: (_, r) => qtyFromE6(r.workE6),
                  },
                  { key: 'amount', title: '应提额', dataIndex: 'amount', money: true },
                  { key: 'issue', title: '异常或说明', dataIndex: 'issue', width: 250 },
                ]}
              />
              <p>本月合计：{formatMoney(preview.data.total)} 元</p>
              <Checkbox checked={skip} onChange={(e) => setSkip(e.target.checked)}>
                已核对缺失数据设备，确认跳过；也可返回补录后重新预览
              </Checkbox>
              {can && (
                <Confirm
                  title={`确认计提 ${period} 月，共 ${formatMoney(preview.data.total)} 元？`}
                  onConfirm={() =>
                    depreciate.mutate({
                      period,
                      token: preview.data!.token,
                      confirm: true,
                      skipMissing: skip,
                    })
                  }
                >
                  确认计提
                </Confirm>
              )}
            </>
          )}
        </>
      )}
      <Typography.Title level={4}>已计提月份</Typography.Title>
      {!!filters.id && <Button onClick={() => setFilters({ id: 0 })}>显示全部月份</Button>}
      <DataTable
        tableId="fixed-assets-batches"
        rowKey="id"
        columns={columns}
        dataSource={(batches.data ?? []).filter((b) => !filters.id || b.id === filters.id)}
      />
      {voucherId != null && <VoucherDrawer id={voucherId} onClose={() => setVoucherId(null)} />}
      {cancelId != null && <CancelDrawer id={cancelId} onClose={() => setCancelId(null)} />}
    </PageContainer>
  );
}
function VoucherDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { byId } = useAccounts();
  const { data } = useQuery(api.voucherPreview.queryOptions({ id }));
  const deletion = useQuery(api.voucherDeletePreview.queryOptions({ id }));
  const generate = useMutation(
    api.generateVoucher.mutationOptions({
      onSuccess: () => {
        notify.success('来源凭证已生成或返回已有凭证');
        void refresh();
        onClose();
      },
    }),
  );
  const remove = useMutation(
    api.deleteVoucher.mutationOptions({
      onSuccess: () => {
        void refresh();
        onClose();
      },
    }),
  );
  return (
    <Drawer open title="折旧凭证预览" size={750} onClose={onClose}>
      <Alert title="生成与来源关联在同一事务内。重复点击返回已有凭证，已审核/过账凭证不能刷新或删除。" />
      <EmptyError error={deletion.error} />
      <Button loading={deletion.isFetching} onClick={() => void deletion.refetch()}>
        重新预览删除影响
      </Button>
      <DataTable
        tableId="fixed-assets-voucher-preview"
        rowKey={(_, i) => String(i)}
        dataSource={data?.lines ?? []}
        columns={[
          { key: 'summary', title: '摘要', dataIndex: 'summary', width: 180 },
          {
            key: 'account',
            title: '科目',
            width: 220,
            render: (_, r) => {
              const a = byId.get(r.accountId ?? 0);
              return a ? `${a.code} ${a.fullName}` : '未设置';
            },
            exportValue: (r) => byId.get(r.accountId ?? 0)?.fullName,
          },
          { key: 'debit', title: '借方', dataIndex: 'debit', money: true },
          { key: 'credit', title: '贷方', dataIndex: 'credit', money: true },
        ]}
      />
      {data && (
        <>
          <p>
            日期：{data.date}；借贷合计均为 {formatMoney(data.total)} 元
          </p>
          <Space>
            <Confirm
              title="确认按以上分录生成凭证？"
              onConfirm={() => generate.mutate({ id, token: data.token })}
            >
              确认生成凭证
            </Confirm>
            {deletion.isSuccess && !deletion.isFetching && deletion.data.voucherDeletion && (
              <Confirm
                title="确认删除待审核来源凭证并执行以上编号调整？"
                danger
                onConfirm={() =>
                  remove.mutate({
                    id,
                    confirm: true,
                    expectedVoucherId: deletion.data.voucherId,
                    voucherDeletion: deletion.data.voucherDeletion ?? undefined,
                  })
                }
              >
                删除待审核凭证
              </Confirm>
            )}
          </Space>
          {deletion.isSuccess && !deletion.isFetching && (
            <VoucherDeletionPreview preview={deletion.data.voucherDeletion} />
          )}
        </>
      )}
    </Drawer>
  );
}
function CancelDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const preview = useQuery(api.cancelPreview.queryOptions({ id }));
  const data = preview.isSuccess && !preview.isFetching ? preview.data : undefined;
  const cancel = useMutation(
    api.cancel.mutationOptions({
      onSuccess: () => {
        notify.success('最后月份折旧已取消，累计数已恢复');
        void refresh();
        onClose();
      },
    }),
  );
  return (
    <Drawer open title="取消折旧预览" size={750} onClose={onClose}>
      <EmptyError error={preview.error} />
      <Button loading={preview.isFetching} onClick={() => void preview.refetch()}>
        重新预览取消影响
      </Button>
      {data && (
        <>
          <Alert
            type="warning"
            title={`将取消 ${data.batch.period} 月折旧，合计 ${formatMoney(data.total)} 元`}
            description="待审核凭证将删除并解除关联；已审核或过账将拒绝。仅支持最后月份逆序取消。"
          />
          <VoucherDeletionPreview preview={data.voucherDeletion} />
          <DataTable
            tableId="fixed-assets-cancel-preview"
            rowKey="asset_id"
            dataSource={data.lines}
            columns={[
              { key: 'code', title: '编号', dataIndex: 'code' },
              { key: 'name', title: '设备', dataIndex: 'name' },
              { key: 'amount', title: '取消金额', dataIndex: 'amount', money: true },
            ]}
          />
          <Confirm
            title={`确认取消 ${data.batch.period} 月并恢复累计月数、工作量、折旧与净值？`}
            danger
            onConfirm={() =>
              cancel.mutate({
                id,
                confirm: true,
                expectedVoucherId: data.batch.voucher_id,
                voucherDeletion: data.voucherDeletion ?? undefined,
              })
            }
          >
            确认取消最后月
          </Confirm>
        </>
      )}
    </Drawer>
  );
}
