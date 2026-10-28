import { useState } from 'react';
import { Alert, Button, Drawer, Input, Radio, Select, Space, Typography } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import { DIMENSION_TYPES, formatMoney } from '@caiwu/core';
import { useRequiredSession } from '@caiwu/web-kit';
import { DataTable, DimensionSelect } from '@caiwu/ui';
import { IMPORT_FIELDS, type ImportInput, type ImportMapping } from '../bulk-shared';
import type { DocumentFilter } from '../shared';
import { api, refresh } from './api';
import { useCashierConfirm } from './common';
import { readImportFile, type ImportFile } from './import-file';

type Selection = { id: number; revision: number }[];
export default function BulkTools({
  selection,
  filter,
  onChanged,
}: {
  selection: Selection;
  filter: DocumentFilter;
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState<'delete' | 'import' | null>(null);
  return (
    <>
      <Button danger onClick={() => setOpen('delete')}>
        批量删除
      </Button>
      <Button onClick={() => setOpen('import')}>导入文件</Button>
      {open === 'delete' && (
        <DeleteDrawer
          selection={selection}
          filter={filter}
          onClose={() => setOpen(null)}
          onChanged={onChanged}
        />
      )}
      {open === 'import' && <ImportDrawer onClose={() => setOpen(null)} onChanged={onChanged} />}
    </>
  );
}
function DeleteDrawer({
  selection,
  filter,
  onClose,
  onChanged,
}: {
  selection: Selection;
  filter: DocumentFilter;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [mode, setMode] = useState<'selection' | 'range'>(selection.length ? 'selection' : 'range');
  const [from, setFrom] = useState(filter.from ?? '');
  const [to, setTo] = useState(filter.to ?? '');
  const [confirm, holder] = useCashierConfirm();
  const preview = useMutation(api.previewDelete.mutationOptions());
  const commit = useMutation(
    api.deleteDocuments.mutationOptions({
      onSuccess: () => {
        void refresh();
        onChanged?.();
      },
    }),
  );
  const invalidate = () => {
    preview.reset();
    commit.reset();
  };
  return (
    <Drawer open title="批量删除出纳单据" size={900} onClose={onClose}>
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <Alert
          type="warning"
          showIcon
          title="删除后不能恢复，请先核对范围。已结账、已勾账、已生成凭证的单据会跳过，并列明原因。"
        />
        <Radio.Group
          value={mode}
          onChange={(e) => {
            setMode(e.target.value);
            invalidate();
          }}
          options={[
            {
              label: `已选单据（${selection.length}张）`,
              value: 'selection',
              disabled: !selection.length,
            },
            { label: '当前筛选条件中的日期范围', value: 'range' },
          ]}
        />
        {mode === 'range' && (
          <Space wrap>
            <label>
              删除日期从{' '}
              <Input
                aria-label="删除日期从"
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  invalidate();
                }}
              />
            </label>
            <label>
              删除日期到{' '}
              <Input
                aria-label="删除日期到"
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  invalidate();
                }}
              />
            </label>
          </Space>
        )}
        <Button
          loading={preview.isPending}
          disabled={commit.isPending || (mode === 'range' && (!from || !to))}
          onClick={() => {
            commit.reset();
            preview.mutate(
              mode === 'selection' ? { selection } : { filter: { ...filter, from, to } },
            );
          }}
        >
          预览删除范围
        </Button>
        {preview.data && !commit.data && (
          <>
            <Alert
              type="info"
              title={`范围内 ${preview.data.rows.length} 张：可删除 ${preview.data.eligible} 张，跳过 ${preview.data.skipped} 张。预览后新增的单据不会加入本次删除。`}
            />
            <DataTable
              tableId="cashier.bulk-delete-preview"
              rowKey="id"
              dataSource={preview.data.rows}
              exportName="出纳批量删除预览"
              columns={[
                { key: 'number', title: '单号', dataIndex: 'number', width: 120 },
                { key: 'date', title: '日期', dataIndex: 'date', width: 110 },
                { key: 'summary', title: '摘要', dataIndex: 'summary', width: 180 },
                { key: 'amount', title: '金额', dataIndex: 'amount', money: true },
                {
                  key: 'reason',
                  title: '处理',
                  render: (_, r) => r.reason ?? '可删除',
                  exportValue: (r) => r.reason ?? '可删除',
                  width: 280,
                },
              ]}
            />
            <Button
              danger
              type="primary"
              disabled={!preview.data.eligible}
              loading={commit.isPending}
              onClick={async () => {
                if (!preview.data) return;
                if (
                  !(await confirm({
                    title: '第一次确认：核对删除范围',
                    content: `本次预览共 ${preview.data.rows.length} 张，预计删除 ${preview.data.eligible} 张。请核对上表日期、单号及跳过原因。`,
                    confirmText: '已核对范围',
                  }))
                )
                  return;
                if (
                  !(await confirm({
                    title: '第二次确认：执行删除',
                    content:
                      '删除后不能恢复。提交时再次检查单据版本、凭证、勾账和期间，变化的单据将跳过。',
                    confirmText: '删除',
                  }))
                )
                  return;
                commit.mutate({
                  previewToken: preview.data.previewToken,
                  rangeConfirmed: '已核对范围',
                  deleteConfirmed: '删除',
                });
              }}
            >
              核对并批量删除
            </Button>
          </>
        )}
        {commit.data && (
          <>
            <Alert
              type="success"
              title={`本次删除 ${commit.data.deleted.length} 张，跳过 ${commit.data.skipped.length} 张`}
              description={
                commit.data.deleted.length
                  ? `已删除单号：${commit.data.deleted.map((id) => `CN-${String(id).padStart(6, '0')}`).join('、')}`
                  : '没有单据被删除。'
              }
            />
            <DataTable
              tableId="cashier.bulk-delete-result"
              rowKey="id"
              dataSource={commit.data.skipped}
              exportName="出纳批量删除跳过明细"
              columns={[
                { key: 'number', title: '单号', dataIndex: 'number' },
                { key: 'date', title: '日期', dataIndex: 'date' },
                { key: 'summary', title: '摘要', dataIndex: 'summary' },
                { key: 'reason', title: '跳过原因', dataIndex: 'reason', width: 320 },
              ]}
            />
          </>
        )}
      </Space>
      {holder}
    </Drawer>
  );
}

const aliases: Partial<Record<keyof ImportMapping, string[]>> = {
  account: ['出纳账户', '账户', '账户名称', '科目编码', 'kmbm'],
  currency: ['币种', 'bz'],
  date: ['日期', '业务日期', 'rq'],
  summary: ['摘要', 'zy'],
  receipt: ['收款', '收款金额', '借方', 'jf'],
  payment: ['付款', '付款金额', '贷方', 'df'],
  amount: ['金额'],
  direction: ['收付方向', '方向'],
  oppositeAccount: ['对方科目编码', '对方科目', 'dfkm'],
  foreignAmount: ['原币金额', '外币金额'],
  exchangeRate: ['汇率'],
  refNo: ['票号', '支票号'],
  note: ['说明', '备注', 'sm'],
};
function autoMapping(headers: string[]): ImportMapping {
  const mapping: ImportMapping = {};
  for (const [id, label] of IMPORT_FIELDS) {
    const choices = aliases[id] ?? [DIMENSION_TYPES.find((d) => d.id === id)?.name ?? label];
    const index = headers.findIndex((h) => choices.includes(h));
    if (index >= 0) mapping[id] = index;
  }
  return mapping;
}
function ImportDrawer({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const { book } = useRequiredSession();
  const accounts = useQuery(api.accounts.queryOptions({}));
  const [file, setFile] = useState<(ImportFile & { name: string }) | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [defaultAccountId, setDefaultAccountId] = useState<number>();
  const [dimensions, setDimensions] = useState<NonNullable<ImportInput['defaultDimensions']>>({});
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const preview = useMutation(api.previewImport.mutationOptions());
  const commit = useMutation(
    api.importDocuments.mutationOptions({
      onSuccess: () => {
        void refresh();
        onChanged?.();
      },
    }),
  );
  const invalidate = () => {
    preview.reset();
    commit.reset();
    setConfirmed(false);
  };
  const input = (): ImportInput => ({
    requestKey,
    fileName: file!.name,
    rows: file!.rows,
    mapping,
    defaultAccountId,
    defaultDimensions: dimensions,
  });
  const profileKey = (headers: string[]) =>
    `cashier.import-format:${book.id}:${JSON.stringify(headers)}`;
  return (
    <Drawer open title="导入出纳收付单" size={1000} onClose={onClose}>
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <Alert
          type="info"
          title="第一行是列标题，第二行起为数据。金额按元填写，日期用 YYYY-MM-DD；同一行只填收款或付款。全部行通过检查后一次保存。"
          description="支持 .xlsx、逗号分隔 CSV 和制表符文本。Excel 读取第一张工作表；旧版 .xls 请先另存为 .xlsx。"
        />
        <input
          aria-label="选择导入文件"
          type="file"
          accept=".xlsx,.csv,.txt,.tsv"
          disabled={reading || commit.isPending || !!commit.data}
          onChange={async (e) => {
            const chosen = e.target.files?.[0];
            if (!chosen) return;
            invalidate();
            setError('');
            setFile(null);
            setReading(true);
            try {
              const result = await readImportFile(chosen);
              setFile({ ...result, name: chosen.name });
              let saved: ImportMapping | null = null;
              try {
                saved = JSON.parse(
                  localStorage.getItem(profileKey(result.headers)) ?? 'null',
                ) as ImportMapping | null;
              } catch {
                /* 无存储权限时仍可继续 */
              }
              setMapping(saved ?? autoMapping(result.headers));
              setRequestKey(crypto.randomUUID());
            } catch (err) {
              setError(err instanceof Error ? err.message : '文件无法读取，请检查格式');
            } finally {
              setReading(false);
            }
          }}
        />
        {reading && <span>正在读取文件……</span>}
        {error && <Alert type="error" title={error} />}
        {file && (
          <>
            <Typography.Text>
              {file.name}：{file.rows.length} 行。请核对字段对应列；格式会按当前账套和列标题记住。
            </Typography.Text>
            <Space wrap align="start">
              <label>
                未设置账户列时使用的账户{' '}
                <Select
                  aria-label="默认出纳账户"
                  allowClear
                  value={defaultAccountId}
                  style={{ width: 220 }}
                  disabled={!!commit.data}
                  options={(accounts.data ?? [])
                    .filter((a) => !a.disabled)
                    .map((a) => ({ value: a.id, label: `${a.name}（${a.currency}）` }))}
                  onChange={(v) => {
                    setDefaultAccountId(v);
                    invalidate();
                  }}
                />
              </label>
              {DIMENSION_TYPES.map((d) => (
                <label key={d.id}>
                  默认{d.name}{' '}
                  <DimensionSelect
                    aria-label={`默认${d.name}`}
                    type={d.id}
                    value={dimensions[d.id] ?? undefined}
                    style={{ width: 180 }}
                    disabled={!!commit.data}
                    onChange={(v) => {
                      setDimensions((old) => ({ ...old, [d.id]: v ?? null }));
                      invalidate();
                    }}
                  />
                </label>
              ))}
            </Space>
            <Space wrap align="start">
              {IMPORT_FIELDS.map(([id, label]) => (
                <label
                  key={id}
                  style={{ display: 'inline-flex', flexDirection: 'column', width: 210 }}
                >
                  {DIMENSION_TYPES.find((d) => d.id === id)?.name ?? label}列
                  <Select
                    aria-label={`${DIMENSION_TYPES.find((d) => d.id === id)?.name ?? label}列`}
                    value={mapping[id]}
                    allowClear
                    disabled={!!commit.data}
                    options={file.headers.map((h, i) => ({ value: i, label: `${i + 1}：${h}` }))}
                    onChange={(v: number | undefined) => {
                      setMapping((old) => ({ ...old, [id]: v }));
                      invalidate();
                    }}
                  />
                </label>
              ))}
            </Space>
            <Button
              disabled={!!commit.data || commit.isPending}
              loading={preview.isPending}
              onClick={() => {
                setConfirmed(false);
                try {
                  localStorage.setItem(profileKey(file.headers), JSON.stringify(mapping));
                } catch {
                  /* 不影响预览 */
                }
                preview.mutate(input());
              }}
            >
              检查并预览导入
            </Button>
            {preview.data && (
              <>
                <Alert
                  type={preview.data.errors ? 'error' : preview.data.valid ? 'success' : 'warning'}
                  title={`可导入 ${preview.data.valid} 行，错误 ${preview.data.errors} 行，空行 ${preview.data.empty} 行`}
                  description={
                    preview.data.errors
                      ? '请修正文件或格式映射后重新预览。本次不会跳过错误行保存。'
                      : !preview.data.valid
                        ? '没有符合条件的数据可导入。'
                        : '请逐行核对账户、方向、金额和日期。'
                  }
                />
                <DataTable
                  tableId="cashier.import-preview"
                  rowKey="line"
                  dataSource={preview.data.rows}
                  exportName="出纳导入检查明细"
                  columns={[
                    { key: 'line', title: '文件行号', dataIndex: 'line', width: 90 },
                    { key: 'date', title: '日期', dataIndex: 'date', width: 110 },
                    { key: 'accountName', title: '账户', dataIndex: 'accountName', width: 140 },
                    { key: 'summary', title: '摘要', dataIndex: 'summary', width: 160 },
                    {
                      key: 'direction',
                      title: '收付',
                      render: (_, r) =>
                        r.direction === 'receipt'
                          ? '收款'
                          : r.direction === 'payment'
                            ? '付款'
                            : '',
                      width: 70,
                    },
                    {
                      key: 'amount',
                      title: '本位币金额',
                      dataIndex: 'amount',
                      money: true,
                      render: (_, r) => formatMoney(r.amount),
                    },
                    {
                      key: 'foreignAmount',
                      title: '原币金额',
                      dataIndex: 'foreignAmount',
                      money: true,
                    },
                    {
                      key: 'error',
                      title: '检查结果',
                      render: (_, r) => (r.empty ? '空行，不导入' : (r.error ?? '可导入')),
                      exportValue: (r) => (r.empty ? '空行，不导入' : (r.error ?? '可导入')),
                      width: 280,
                    },
                  ]}
                />
                {preview.data.previewToken && !commit.data && (
                  <>
                    <label>
                      <input
                        aria-label="已核对导入明细"
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />{' '}
                      已核对以上明细，确认全部导入
                    </label>
                    <Button
                      type="primary"
                      disabled={!confirmed}
                      loading={commit.isPending}
                      onClick={() =>
                        commit.mutate({
                          ...input(),
                          previewToken: preview.data!.previewToken!,
                          confirmed: true,
                        })
                      }
                    >
                      确认导入
                    </Button>
                  </>
                )}
              </>
            )}
            {commit.data && (
              <Alert
                type="success"
                title={`已导入 ${commit.data.count} 张出纳单`}
                description="可关闭此窗口查看和生成凭证。重复提交同一次导入不会增加重复单据。"
              />
            )}
          </>
        )}
      </Space>
    </Drawer>
  );
}
