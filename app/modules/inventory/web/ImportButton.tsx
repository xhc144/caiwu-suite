import { useRef, useState } from 'react';
import { Alert, Button, Checkbox, Modal, Space } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { usePermission, useTab } from '@caiwu/web-kit';
import { exportToExcel } from '@caiwu/ui';
import { formatMoney } from '@caiwu/core';
import {
  INVENTORY_IMPORT_COLUMNS,
  importExportColumns,
  readInventoryXlsx,
  type ImportIssue,
  type InventoryImportKind,
} from '../excel';
import { api } from './api';
import { Grid, useRefresh, useUnsaved } from './common';
import type { DocumentInput } from '../shared';
export default function ImportButton({
  kind,
  warehouseId,
  revision,
  document,
  onSaved,
  disabled = false,
}: {
  kind: InventoryImportKind;
  warehouseId?: number;
  revision?: number;
  document?: DocumentInput;
  onSaved?: () => void;
  disabled?: boolean;
}) {
  const { active } = useTab();
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
  const submitting = useRef(false);
  const discard = () => {
    setRows([]);
    preview.reset();
    setOpen(false);
  };
  const submit = async (): Promise<boolean> => {
    if (submitting.current || busy) return false;
    if (!preview.data || errors.length || !rows.length || error) {
      setOpen(true);
      return false;
    }
    if (!window.confirm(`确认保存 ${rows.length} 行${overwrite ? '并覆盖已有数据' : ''}？`))
      return false;
    submitting.current = true;
    try {
      await save.mutateAsync({ ...payload, confirmation: preview.data.confirmation });
      discard();
      await refresh();
      onSaved?.();
      return true;
    } finally {
      submitting.current = false;
    }
  };
  useUnsaved(rows.length > 0, {
    title: 'Excel 待导入数据',
    pending: busy,
    version: JSON.stringify({ rows, overwrite, rowNumbers, document }),
    save: submit,
    discard,
  });

  return (
    <>
      {can && (
        <Button disabled={disabled} onClick={() => setOpen(true)}>
          Excel 导入预览
        </Button>
      )}
      <Modal
        title="Excel 导入：先预览再确认保存"
        open={open && active}
        mask={false}
        width={950}
        onCancel={() => {
          if (!busy) setOpen(false);
        }}
        footer={
          <Space>
            <Button disabled={busy} onClick={() => setOpen(false)}>
              取消
            </Button>
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
              onClick={() => void submit()}
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
          {kind === 'contracts'
            ? '每行重复完整合同头，合同号相同的行合并为一张；按仓库、供应商和产品编码匹配。合同只新增，不覆盖已有合同，也不迁移履约和库存。'
            : kind === 'document'
              ? '含税口径必须逐行明确填“是”或“否”，不能留空。单据头取当前编辑内容。'
              : '已有数据覆盖需再次预览并确认。'}
          {kind === 'opening'
            ? '期初每行只填所选口径的单价或金额；另一格留空。旧的数量、单价三列表按数量×单价读取。金额最多两位小数。'
            : '无法识别的列会报错；请使用导入模板，金额等只读报表列不能直接回导。'}
        </p>
        <Button
          onClick={() =>
            void exportToExcel({
              fileName: `${kind === 'contracts' ? '采购合同' : kind === 'document' ? '单据明细' : kind === 'opening' ? '库存期初' : '产品'}导入模板`,
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
        {kind !== 'contracts' && (kind !== 'document' || document?.id) && (
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
            {kind === 'contracts' ? (
              <Grid
                id="import-contracts"
                title="采购合同转入明细"
                rows={(preview.data?.rows ?? rows).map((r, i) => ({ ...r, key: String(i) }))}
                columns={[
                  { key: 'number', title: '合同号', dataIndex: 'number' },
                  { key: 'warehouseCode', title: '仓库编码', dataIndex: 'warehouseCode' },
                  { key: 'supplierCode', title: '供应商编码', dataIndex: 'supplierCode' },
                  { key: 'date', title: '日期', dataIndex: 'date' },
                  { key: 'dueDate', title: '交期', dataIndex: 'dueDate' },
                  { key: 'productCode', title: '产品编号', dataIndex: 'productCode' },
                  { key: 'quantity', title: '数量', dataIndex: 'quantity' },
                  { key: 'unitPrice', title: '单价（元）', dataIndex: 'unitPrice' },
                  { key: 'lineNote', title: '明细说明', dataIndex: 'lineNote' },
                ]}
              />
            ) : (
              <pre style={{ maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(preview.data?.rows ?? rows, null, 2)}
              </pre>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
