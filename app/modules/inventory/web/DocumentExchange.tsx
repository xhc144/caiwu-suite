import { useRef, useState } from 'react';
import { Alert, Button, Checkbox, Modal, Select, Space, Table } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePermission, useSubmission, useTab, useUnsavedChanges } from '@caiwu/web-kit';
import { formatMoney } from '@caiwu/core';
import { EXCHANGE_LIMITS } from '../exchange';
import { api } from './api';
import { useRefresh } from './common';

export default function DocumentExchange({
  documents,
  onImported,
}: {
  documents: readonly { id: number; number: string }[];
  onImported?: () => void;
}) {
  const client = useQueryClient();
  const { active } = useTab();
  const allDocuments = useQuery(api.documents.queryOptions({}));
  const refresh = useRefresh();
  const importPermission = usePermission('inventory.import');
  const editPermission = usePermission('inventory.edit');
  const canImport = importPermission && editPermission;
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [file, setFile] = useState<unknown>();
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [allowNegative, setAllowNegative] = useState(false);
  const reading = useRef(0);
  const preview = useMutation(api.importDocumentsPreview.mutationOptions());
  const save = useMutation(api.importDocuments.mutationOptions());
  const submission = useSubmission();
  const payload = { file, requestKey, allowNegative };
  const busy = preview.isPending || submission.isSubmitting;
  const clear = () => {
    setFile(undefined);
    setFileName('');
    setError('');
    setAllowNegative(false);
    setRequestKey(crypto.randomUUID());
    preview.reset();
  };
  const doImport = async () => {
    if (!preview.data || preview.data.errors.length || file === undefined) {
      setError('请先选择文件并完成无错误的预览校验');
      setOpen(true);
      return false;
    }
    if (preview.data.shortages.length && !allowNegative) {
      setError('转入将造成负库存，请核对差额，默认取消');
      setOpen(true);
      return false;
    }
    if (
      !window.confirm(`确认新增 ${preview.data.rows.length} 张单据及其库存影响？所有单据一起保存。`)
    )
      return false;
    try {
      return await submission.submit(async () => {
        await save.mutateAsync({ ...payload, confirmation: preview.data!.confirmation });
        clear();
        setOpen(false);
        await refresh();
        onImported?.();
      });
    } catch {
      return false;
    }
  };
  useUnsavedChanges({
    title: '多单文件转入',
    dirty: file !== undefined || busy,
    version: `${requestKey}:${allowNegative}`,
    save: doImport,
    discard: () => {
      if (busy) throw new Error('单据正在转入，请等待结果后再关闭');
      clear();
    },
  });
  const read = async (selectedFile: File) => {
    const version = ++reading.current;
    preview.reset();
    setFile(undefined);
    setFileName('');
    setError('');
    try {
      if (selectedFile.size > EXCHANGE_LIMITS.bytes) throw new Error('单据文件不能超过 5 MB');
      const parsed: unknown = JSON.parse(await selectedFile.text());
      if (version !== reading.current) return;
      setFile(parsed);
      setFileName(selectedFile.name);
      setAllowNegative(false);
      setRequestKey(crypto.randomUUID());
    } catch (e) {
      if (version !== reading.current) return;
      setError(
        e instanceof SyntaxError
          ? '文件不是有效的单据 JSON 文件'
          : e instanceof Error
            ? e.message
            : '文件读取失败',
      );
    }
  };
  return (
    <Space wrap>
      <Select
        aria-label="多单转出选择"
        mode="multiple"
        value={selected}
        onChange={setSelected}
        placeholder="选择要转出的单据"
        maxTagCount="responsive"
        style={{ minWidth: 260, maxWidth: 500 }}
        options={
          allDocuments.data?.map((d) => ({
            value: d.id,
            label: `${d.kind === 'receipt' ? '入库' : '出库'} / ${d.warehouse_name} / ${d.number}`,
          })) ?? documents.map((d) => ({ value: d.id, label: d.number }))
        }
        showSearch={{
          filterOption: (input, option) => String(option?.label ?? '').includes(input),
        }}
      />
      <Button
        disabled={!selected.length || submission.isSubmitting}
        loading={submission.isSubmitting}
        onClick={() =>
          void submission
            .submit(async () => {
              const data = await client.fetchQuery(
                api.exportDocuments.queryOptions({ ids: selected }),
              );
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
              );
              const link = document.createElement('a');
              link.href = url;
              link.download = `出入库单-${new Date().toISOString().replaceAll(':', '-')}.json`;
              link.click();
              window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            })
            .catch(() => undefined)
        }
      >
        多单文件转出
      </Button>
      {canImport && <Button onClick={() => setOpen(true)}>多单文件转入</Button>}
      <Modal
        title="多单文件转入：核对头行后整批保存"
        open={open && active}
        mask={false}
        width={1100}
        onCancel={() => setOpen(false)}
        footer={
          <Space>
            <Button disabled={busy} onClick={() => setOpen(false)}>
              返回（保留文件）
            </Button>
            <Button
              disabled={busy || file === undefined}
              loading={preview.isPending}
              onClick={() => {
                setError('');
                preview.mutate(payload);
              }}
            >
              预览全部单据
            </Button>
            <Button
              type="primary"
              disabled={
                busy ||
                !preview.data ||
                !!preview.data.errors.length ||
                (!!preview.data.shortages.length && !allowNegative)
              }
              loading={save.isPending}
              onClick={() => void doImport()}
            >
              确认整批转入
            </Button>
          </Space>
        }
      >
        <p>
          选择本软件“多单文件转出”生成的 JSON 文件，最多 200 张、5000
          行。按仓库、产品和科目编码匹配当前账套，调拨及反冲必须完整选择关联两单。转入保留业务头行和成对关联，新增为未审核单据；原单即使已审核或已核算，凭证与核算结果仍由当前账套重新处理。已有同号单据不会被覆盖。
        </p>
        <input
          type="file"
          aria-label="多单转入文件"
          accept=".json,application/json"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
          }}
        />
        {fileName && <p>待转入文件：{fileName}；返回或保存失败时保留文件。</p>}
        {file !== undefined && (
          <Button disabled={busy} onClick={clear}>
            清除待转入文件
          </Button>
        )}
        {error && <Alert type="error" title={error} />}
        {preview.data && (
          <>
            {!!(
              preview.data.relations.transfers.length || preview.data.relations.reversals.length
            ) && (
              <Alert
                type="info"
                title={`关联：${preview.data.relations.transfers.length} 张调拨、${preview.data.relations.reversals.length} 组反冲，将在同一批次恢复`}
              />
            )}
            <Alert
              type={preview.data.errors.length ? 'error' : 'success'}
              title={`预览 ${preview.data.rows.length} 张单据，${preview.data.errors.length} 个错误；不含税 ${formatMoney(preview.data.totals.netCents)}，税额 ${formatMoney(preview.data.totals.taxCents)}，价税合计 ${formatMoney(preview.data.totals.grossCents)}`}
            />
            <Table
              size="small"
              rowKey="index"
              pagination={false}
              scroll={{ x: 1300, y: 360 }}
              dataSource={preview.data.rows}
              columns={[
                { title: '文件序号', dataIndex: 'index' },
                { title: '方向', render: (_, r) => (r.kind === 'receipt' ? '入库' : '出库') },
                { title: '单号', dataIndex: 'number' },
                { title: '日期', dataIndex: 'date' },
                { title: '仓库编码', dataIndex: 'warehouseCode' },
                { title: '类别', dataIndex: 'category' },
                { title: '操作人', dataIndex: 'operator' },
                { title: '摘要', dataIndex: 'summary' },
                { title: '收付款科目', dataIndex: 'accountCode' },
                { title: '成本科目', dataIndex: 'costAccountCode' },
                { title: '税率%', dataIndex: 'taxRate' },
                {
                  title: '来源',
                  render: (_, r) =>
                    !r.source
                      ? ''
                      : r.source.type === 'contract'
                        ? `采购合同 ${r.source.number}`
                        : `${r.source.kind === 'receipt' ? '入库单' : '出库单'} ${r.source.warehouseCode} / ${r.source.number}`,
                },
                { title: '价税合计（元）', render: (_, r) => formatMoney(r.grossCents) },
              ]}
              expandable={{
                expandedRowRender: (r) => (
                  <Table
                    size="small"
                    rowKey={(_, i) => String(i)}
                    pagination={false}
                    dataSource={r.lines}
                    columns={[
                      { title: '产品编号', dataIndex: 'productCode' },
                      { title: '数量', dataIndex: 'quantity' },
                      { title: '单价（元）', dataIndex: 'unitPrice' },
                      {
                        title: '含税口径',
                        render: (_, l) => (l.priceIncludesTax ? '含税' : '不含税'),
                      },
                      { title: '金额（元）', render: (_, l) => formatMoney(l.netCents) },
                      { title: '税额（元）', render: (_, l) => formatMoney(l.taxCents) },
                      { title: '价税合计（元）', render: (_, l) => formatMoney(l.grossCents) },
                      { title: '说明', dataIndex: 'note' },
                    ]}
                  />
                ),
              }}
            />
            {!!preview.data.errors.length && (
              <ul>
                {preview.data.errors.map((e, i) => (
                  <li key={i}>
                    第 {e.document} 张{e.line ? `第 ${e.line} 行` : ''}：{e.message}
                  </li>
                ))}
              </ul>
            )}
            {!!preview.data.shortages.length && (
              <Alert
                type="warning"
                title="转入后库存不足，默认取消"
                description={
                  <>
                    <ul>
                      {preview.data.shortages.map((s, i) => (
                        <li key={i}>
                          {s.number} / {s.productCode}：当前 {s.current}，申请 {s.requested}，差额{' '}
                          {s.difference}
                        </li>
                      ))}
                    </ul>
                    <Checkbox
                      disabled={busy}
                      checked={allowNegative}
                      onChange={(e) => {
                        setAllowNegative(e.target.checked);
                        preview.reset();
                      }}
                    >
                      核对后允许本批负库存（需要相应权限并重新预览）
                    </Checkbox>
                  </>
                }
              />
            )}
          </>
        )}
      </Modal>
    </Space>
  );
}
