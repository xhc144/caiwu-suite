import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Space } from 'antd';
import { DataTable, PageContainer } from '@caiwu/ui';
import { notify, queryClient, useDimensionItems, useSubmission } from '@caiwu/web-kit';
import { centsToYuan, qtyFromE6 } from '@caiwu/core';
import { api, type Outputs } from './api';
import { Confirm, refresh } from './common';
import { createOpeningWorkbook, readOpeningWorkbook } from './opening-workbook';
import type { Workbook } from 'exceljs';
import { useAssetDraft } from './useAssetDraft';
import ResetAssets from './ResetAssets';
import RestoreResetAssets from './RestoreResetAssets';

async function downloadWorkbook(workbook: Workbook, filename: string) {
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(buffer)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function OpeningPage() {
  const [loaded, setLoaded] = useState<
    | (ReturnType<typeof readOpeningWorkbook> & {
        filename: string;
        preview: Outputs['importPreview'];
      })
    | null
  >(null);
  const [reading, setReading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [fileError, setFileError] = useState('');
  const generation = useRef(0);
  const masters = useQuery(api.masters.queryOptions()),
    { items: departments, loading: departmentsLoading } = useDimensionItems('department');
  const preview = useMutation(api.importPreview.mutationOptions());
  const confirm = useMutation(api.importConfirm.mutationOptions());
  const draft = useAssetDraft({
    title: loaded ? `期初卡片待导入：${loaded.filename}` : '期初卡片导入',
    save: async () => {
      if (reading || !loaded) {
        notify.error('请先选择文件并完成期初数据预览');
        return false;
      }
      const r = await confirm.mutateAsync({
        rows: loaded.rows,
        token: loaded.preview.token,
        confirm: true,
      });
      notify.success(`导入 ${r.imported} 张，跳过 ${r.skipped} 张`);
      generation.current++;
      setLoaded(null);
      await refresh();
    },
    discard: () => {
      generation.current++;
      setLoaded(null);
      setReading(false);
      setFileError('');
    },
  });
  const enableSubmission = useSubmission();
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const enable = useMutation(
    api.enable.mutationOptions({ onSuccess: () => notify.success('固定资产已开通，现有数据保留') }),
  );
  const template = async () => downloadWorkbook(await createOpeningWorkbook(), '固定资产期初模板');
  const load = async (file: File) => {
    const current = ++generation.current;
    draft.changed();
    setLoaded(null);
    setFileError('');
    setReading(true);
    try {
      const { Workbook } = await import('exceljs');
      const wb = new Workbook();
      try {
        await wb.xlsx.load(await file.arrayBuffer());
      } catch (error) {
        throw new Error('无法读取 Excel 文件，请检查 XLSX 格式', { cause: error });
      }
      const parsed = readOpeningWorkbook(wb, { masters: masters.data ?? [], departments });
      if (generation.current !== current) return;
      const result = await preview.mutateAsync({ rows: parsed.rows });
      if (generation.current === current)
        setLoaded({ ...parsed, filename: file.name, preview: result });
    } catch (error) {
      if (generation.current === current)
        setFileError(error instanceof Error ? error.message : '无法读取 Excel 文件，请检查格式');
    } finally {
      if (generation.current === current) setReading(false);
    }
  };
  const exportOpening = async () => {
    setExporting(true);
    try {
      const { cards, masters, departments, accessories } = await queryClient.fetchQuery({
        ...api.exportOpening.queryOptions(),
        staleTime: 0,
      });
      if (!cards.length) {
        notify.error('没有卡片可导出');
        return;
      }
      const code = (id: number) => masters.find((m) => m.id === id)?.code ?? '';
      const workbook = await createOpeningWorkbook(
        cards.map((c) => ({
          values: [
            c.code,
            c.name,
            code(c.category_id),
            code(c.status_id),
            code(c.purpose_id),
            departments.find((d) => d.id === c.department_id)?.code ?? '',
            c.acquired,
            c.use_date,
            centsToYuan(c.base_original),
            c.rate,
            c.method,
            String(c.life_months),
            centsToYuan(c.opening_depreciation),
            String(c.opening_months),
            c.totalWork,
            qtyFromE6(c.opening_work_e6),
            c.model,
            c.unit,
            c.quantity,
            c.life_months < 30 ? '是' : '否',
            centsToYuan(c.residual),
            c.reference,
            c.manufacturer,
            c.installation,
            c.manufactured ?? '',
            c.machine_code,
            c.custodian,
            c.currency_code,
            c.foreign_original,
          ],
          accessories: accessories
            .filter((a) => a.asset_id === c.id)
            .map((a) => ({
              code: a.code,
              name: a.name,
              quantity: qtyFromE6(a.quantity_e6),
              unitPrice: a.unit_price,
              note: a.note,
            })),
        })),
      );
      await downloadWorkbook(workbook, '固定资产期初卡片');
    } catch (error) {
      notify.error(error instanceof Error ? error.message : '期初卡片导出失败，请重试');
    } finally {
      setExporting(false);
    }
  };
  return (
    <PageContainer title="期初导入与开通">
      <Alert
        title="正常开通与期初导入保留已有数据。重导相同卡片会跳过；同编号不同期初数据拒绝覆盖。首次计提前完成导入。"
        description="使用年限单位是月；少于 30 月请复核并填「是」。方法码 1 为平均年限法，2 为工作量法。附属设备填入同名工作表，设备编号必须与期初卡片一致；单价保留十进制，数量最多六位小数，日期填 YYYY-MM-DD。旧单表文件仍可导入。"
      />
      <Space wrap style={{ margin: '16px 0' }}>
        <ResetAssets />
        <RestoreResetAssets />
        <Button
          loading={enableSubmission.isSubmitting}
          onClick={() => void enableSubmission.submit(() => enable.mutateAsync()).catch(() => {})}
        >
          开通（保留数据）
        </Button>
        <Button onClick={() => void template().catch(() => notify.error('模板生成失败，请重试'))}>
          下载 Excel 模板
        </Button>
        <label>
          <span>选择 Excel 文件：</span>
          <input
            aria-label="选择期初 Excel"
            type="file"
            accept=".xlsx"
            disabled={draft.saving || masters.isPending || departmentsLoading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void load(file);
              else {
                generation.current++;
                setLoaded(null);
                setReading(false);
                setFileError('');
                draft.clear();
              }
            }}
          />
        </label>
        <Button disabled={exporting} onClick={() => void exportOpening()}>
          导出期初卡片
        </Button>
      </Space>
      <Alert
        type="warning"
        title="破坏性重置暂不可用。请使用保留数据开通或期初导入，已有资产记录不会被清空。"
      />
      <p>
        基础资料使用编码匹配。类别、用途、状态和部门在资产基础档案维护。
        {loaded?.filename}
      </p>
      {reading && <p role="status">正在读取文件并校验期初数据…</p>}
      {fileError && <Alert type="error" title={fileError} />}
      <DataTable
        tableId="fixed-assets-import-preview"
        rowKey="row"
        dataSource={
          loaded?.preview.rows.map((r) => ({ ...r, name: r.data?.name ?? '', data: undefined })) ??
          []
        }
        columns={[
          { key: 'row', title: 'Excel 行', dataIndex: 'row' },
          { key: 'code', title: '设备编号', dataIndex: 'code' },
          { key: 'name', title: '设备名称', dataIndex: 'name' },
          { key: 'status', title: '状态', dataIndex: 'status' },
          {
            key: 'accessories',
            title: '附属设备数',
            render: (_, r) =>
              loaded?.rows.find((v) => v.row === r.row)?.data.accessories?.length ?? 0,
          },
          { key: 'error', title: '逐行错误', dataIndex: 'error', width: 500 },
        ]}
      />
      {!!loaded?.accessoryRows.length && (
        <DataTable
          tableId="fixed-assets-accessory-import-preview"
          rowKey={(r) => `${r.assetCode}-${r.data.code}`}
          dataSource={loaded.accessoryRows}
          columns={[
            { key: 'row', title: '附属表行', dataIndex: 'row' },
            { key: 'parent', title: '设备编号', dataIndex: 'assetCode' },
            { key: 'code', title: '附属编号', render: (_, r) => r.data.code },
            { key: 'name', title: '附属名称', render: (_, r) => r.data.name },
            { key: 'quantity', title: '数量', render: (_, r) => r.data.quantity },
            { key: 'price', title: '单价（元）', render: (_, r) => r.data.unitPrice },
            { key: 'note', title: '说明', render: (_, r) => r.data.note },
          ]}
        />
      )}
      {loaded && !reading && !draft.saving && (
        <Confirm
          title={`确认将 ${loaded.preview.count} 张有效期初卡片及附属设备入库？所有行须通过校验。`}
          onConfirm={() => void draft.save().catch(() => {})}
        >
          确认期初入库
        </Confirm>
      )}
    </PageContainer>
  );
}
