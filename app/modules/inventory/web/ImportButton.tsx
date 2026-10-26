import { useState } from 'react';
import { Alert, Button, Checkbox, Modal, Space, Typography } from 'antd';
import { useMutation } from '@tanstack/react-query';
import { usePermission } from '@caiwu/web-kit';
import { api } from './api';
import { Grid, useRefresh } from './common';
import type { DocumentInput } from '../shared';
const aliases: Record<string, string> = {
  产品编号: 'code',
  产品名称: 'name',
  名称: 'name',
  规格: 'specification',
  计量单位: 'unit',
  默认入库价: 'receiptPrice',
  默认出库价: 'issuePrice',
  计划价: 'planPrice',
  费用分摊系数: 'allocationFactor',
  存货科目编码: 'inventoryAccountCode',
  存货科目ID: 'inventoryAccountId',
  销售科目编码: 'salesAccountCode',
  销售科目ID: 'salesAccountId',
  数量: 'quantity',
  单价: 'unitPrice',
  含税单价: 'priceIncludesTax',
  说明: 'note',
};
export default function ImportButton({
  kind,
  warehouseId,
  revision,
  document,
  onSaved,
}: {
  kind: 'products' | 'opening' | 'document';
  warehouseId?: number;
  revision?: number;
  document?: DocumentInput;
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false),
    [rows, setRows] = useState<Record<string, unknown>[]>([]),
    [error, setError] = useState(''),
    [overwrite, setOverwrite] = useState(false);
  const preview = useMutation(api.importPreview.mutationOptions()),
    save = useMutation(api.importSave.mutationOptions());
  const refresh = useRefresh();
  const canImport = usePermission('inventory.import');
  const canEdit = usePermission('inventory.edit');
  const can = canImport && canEdit;
  const payload = { kind, warehouseId, revision, document, rows, overwrite };
  const read = async (file: File) => {
    preview.reset();
    setError('');
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Excel 文件不能超过 5 MB');
      const { Workbook } = await import('exceljs');
      const wb = new Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws || ws.rowCount > 1001) throw new Error('请选择最多 1000 行数据的 Excel 工作表');
      const headers = ws.getRow(1).values;
      const names = Array.isArray(headers)
        ? headers.slice(1).map((v) => aliases[String(v)] ?? String(v))
        : [];
      if (!names.length) throw new Error('缺少首行列名');
      const next: Record<string, unknown>[] = [];
      ws.eachRow((row, index) => {
        if (index === 1) return;
        const out: Record<string, unknown> = {};
        for (const [i, key] of names.entries()) {
          const value = row.getCell(i + 1).value;
          if (value != null && typeof value === 'object')
            throw new Error(`第 ${index} 行含公式或复合单元格，请粘贴为纯值`);
          const name = key === 'code' && kind !== 'products' ? 'productCode' : key;
          const s = value == null ? '' : String(value);
          out[name] = ['inventoryAccountId', 'salesAccountId'].includes(name)
            ? s === ''
              ? null
              : Number(s)
            : ['priceIncludesTax', 'disabled'].includes(name)
              ? s === '是' || s === 'true' || s === '停用'
              : s;
        }
        next.push(out);
      });
      setRows(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : '文件读取失败');
    }
  };
  return (
    <>
      {can && <Button onClick={() => setOpen(true)}>Excel 导入预览</Button>}
      <Modal
        title="Excel 导入：先预览再确认保存"
        open={open}
        width={950}
        onCancel={() => setOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button
              disabled={!rows.length}
              loading={preview.isPending}
              onClick={() => preview.mutate(payload)}
            >
              预览校验
            </Button>
            <Button
              type="primary"
              disabled={!preview.data || !!preview.data.errors.length}
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
        <Typography.Paragraph>
          {kind === 'products'
            ? '列名：产品编号、产品名称、规格、计量单位、默认入库价、默认出库价、计划价、费用分摊系数、存货科目编码、销售科目编码。已有产品覆盖时保留稳定 ID。'
            : '列名：产品编号、数量、单价（元）' +
              (kind === 'document'
                ? '、含税口径（是/否）、说明。单据头取当前编辑内容。'
                : '。确认覆盖将完整替换当前仓库期初。')}
        </Typography.Paragraph>
        <input
          aria-label="导入Excel文件"
          type="file"
          accept=".xlsx"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
          }}
        />
        {(kind !== 'document' || document?.id) && (
          <Checkbox
            checked={overwrite}
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
        {preview.data && (
          <>
            <Alert
              type={preview.data.errors.length ? 'error' : 'success'}
              title={`预览 ${preview.data.rows.length} 行，${preview.data.errors.length} 个错误`}
            />
            <Grid
              id="import-errors"
              title="导入逐行错误"
              rows={preview.data.errors.map((e, i) => ({ ...e, key: String(i) }))}
              columns={[
                { key: 'row', title: 'Excel行', dataIndex: 'row' },
                { key: 'message', title: '错误', dataIndex: 'message' },
              ]}
            />
            <pre style={{ maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(preview.data.rows, null, 2)}
            </pre>
          </>
        )}
      </Modal>
    </>
  );
}
