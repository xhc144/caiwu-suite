import { useRef, useState } from 'react';
import { Alert, Button, Checkbox, Modal, Space } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { usePermission } from '@caiwu/web-kit';
import { exportToExcel } from '@caiwu/ui';
import { formatMoney } from '@caiwu/core';
import {
  INVENTORY_IMPORT_COLUMNS,
  importExportColumns,
  readInventoryXlsx,
  type ImportIssue,
} from '../excel';
import { api } from './api';
import { Grid, useRefresh } from './common';
import type { DocumentInput } from '../shared';
export default function ImportButton({
  kind,
  warehouseId,
  revision,
  document,
  onSaved,
  disabled = false,
}: {
  kind: 'products' | 'opening' | 'document';
  warehouseId?: number;
  revision?: number;
  document?: DocumentInput;
  onSaved?: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [rows, setRows] = useState<Record<string, unknown>[]>([]),
    [error, setError] = useState(''),
    [fileErrors, setFileErrors] = useState<ImportIssue[]>([]),
    [rowNumbers, setRowNumbers] = useState<number[]>([]),
    [overwrite, setOverwrite] = useState(false);
  const preview = useMutation(api.importPreview.mutationOptions()),
    save = useMutation(api.importSave.mutationOptions());
  const refresh = useRefresh();
  const canImport = usePermission('inventory.import');
  const canEdit = usePermission('inventory.edit');
  const can = canImport && canEdit;
  const payload = {
    kind,
    warehouseId,
    revision,
    document: document ? { ...document, lines: [] } : undefined,
    rows,
    rowNumbers,
    overwrite,
  };
  const readVersion = useRef(0);
  const read = async (file: File) => {
    const version = ++readVersion.current;
    preview.reset();
    setRows([]);
    setRowNumbers([]);
    setFileErrors([]);
    setError('');
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Excel 文件不能超过 5 MB');
      const result = await readInventoryXlsx(await file.arrayBuffer(), kind);
      if (version !== readVersion.current) return;
      setRows(result.rows);
      setRowNumbers(result.rowNumbers);
      setFileErrors(result.errors);
    } catch (e) {
      if (version === readVersion.current)
        setError(e instanceof Error ? e.message : '文件读取失败');
    }
  };
  const errors = [...fileErrors, ...(preview.data?.errors ?? [])];
  const busy = preview.isPending || save.isPending;

  return (
    <>
      {can && (
        <Button disabled={disabled} onClick={() => setOpen(true)}>
          Excel 导入预览
        </Button>
      )}
      <Modal
        title="Excel 导入：先预览再确认保存"
        open={open}
        width={950}
        onCancel={() => setOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              aria-label="预览校验"
              aria-busy={preview.isPending}
              disabled={busy || !rows.length || !!fileErrors.length || !!error}
              loading={preview.isPending}
              onClick={() => preview.mutate(payload)}
            >
              预览校验
            </Button>
            <Button
              type="primary"
              aria-label="确认保存导入"
              aria-busy={save.isPending}
              disabled={busy || !preview.data || !!errors.length || !rows.length || !!error}
              loading={save.isPending}
              onClick={async () => {
                if (
                  !window.confirm(
                    `确认原子保存 ${rows.length} 行${overwrite ? '并覆盖已有数据' : ''}？`,
                  )
                )
                  return;
                await save.mutateAsync({ ...payload, confirmation: preview.data!.confirmation });
                setOpen(false);
                preview.reset();
                setRows([]);
                await refresh();
                onSaved?.();
              }}
            >
              确认保存导入
            </Button>
          </Space>
        }
      >
        <p>
          列名：
          {INVENTORY_IMPORT_COLUMNS[kind]
            .filter((c) => c.type !== 'id')
            .map((c) => c.title)
            .join('、')}
          。
          {kind === 'document'
            ? '含税口径必须逐行明确填“是”或“否”，不能留空。单据头取当前编辑内容。'
            : '已有数据覆盖需再次预览并确认。'}
          {kind === 'opening'
            ? '期初每行只填所选口径的单价或金额；另一格留空。旧的数量、单价三列表按数量×单价读取。金额最多两位小数。'
            : '无法识别的列会报错；请使用导入模板，金额等只读报表列不能直接回导。'}
        </p>
        <Button
          onClick={() =>
            void exportToExcel({
              fileName: `${kind === 'document' ? '单据明细' : kind === 'opening' ? '库存期初' : '产品'}导入模板`,
              columns: importExportColumns(kind),
              rows: [],
            })
          }
        >
          下载导入模板
        </Button>
        <input
          aria-label="导入Excel文件"
          type="file"
          accept=".xlsx"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
          }}
        />
        {(kind !== 'document' || document?.id) && (
          <Checkbox
            checked={overwrite}
            disabled={busy}
            onChange={(e) => {
              setOverwrite(e.target.checked);
              preview.reset();
            }}
          >
            {kind === 'document'
              ? '确认覆盖当前单据全部明细（需再次预览）'
              : '允许覆盖已有数据（需再次预览）'}
          </Checkbox>
        )}
        {error && <Alert type="error" title={error} />}
        {(preview.data || !!fileErrors.length) && (
          <>
            <Alert
              type={errors.length ? 'error' : 'success'}
              title={`预览 ${preview.data?.rows.length ?? rows.length} 行，${errors.length} 个错误`}
            />
            <Grid
              id="import-errors"
              title="导入逐行错误"
              rows={errors.map((e, i) => ({ ...e, key: String(i) }))}
              columns={[
                { key: 'row', title: 'Excel行', dataIndex: 'row' },
                { key: 'message', title: '错误', dataIndex: 'message' },
              ]}
            />
            {preview.data?.amounts && (
              <Alert
                type="info"
                title={
                  kind === 'opening'
                    ? `期初金额合计 ${formatMoney(preview.data.amounts.netCents)}`
                    : `不含税金额 ${formatMoney(preview.data.amounts.netCents)}，税额 ${formatMoney(preview.data.amounts.taxCents)}，价税合计 ${formatMoney(preview.data.amounts.grossCents)}`
                }
              />
            )}
            <pre style={{ maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(preview.data?.rows ?? rows, null, 2)}
            </pre>
          </>
        )}
      </Modal>
    </>
  );
}
