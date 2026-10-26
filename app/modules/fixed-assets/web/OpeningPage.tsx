import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, Button, Space } from 'antd';
import { DataTable, PageContainer, exportToExcel } from '@caiwu/ui';
import { notify, useDimensionItems } from '@caiwu/web-kit';
import { parseMoney, centsToYuan, qtyFromE6 } from '@caiwu/core';
import { api } from './api';
import { Confirm, refresh } from './common';
const headers = [
  '设备编号',
  '设备名称',
  '类别编码',
  '状态编码',
  '用途编码',
  '部门编码',
  '购置日期',
  '使用日期',
  '原值（元）',
  '残值率',
  '方法码',
  '使用年限（月）',
  '期初累计折旧（元）',
  '期初累计月数',
  '总工作量',
  '期初累计工作量',
  '规格型号',
  '单位',
  '数量',
  '少于30月已复核（是/否）',
  '预计残值（元，可空）',
  '参考编号',
];
export default function OpeningPage() {
  const [rows, setRows] = useState<{ row: number; data: unknown }[]>([]),
    [filename, setFilename] = useState('');
  const masters = useQuery(api.masters.queryOptions()),
    { items: departments } = useDimensionItems('department');
  const preview = useMutation(api.importPreview.mutationOptions());
  const previewRows = preview.mutate,
    resetPreview = preview.reset;
  useEffect(() => {
    if (rows.length) previewRows({ rows });
    else resetPreview();
  }, [rows, previewRows, resetPreview]);
  const confirm = useMutation(
    api.importConfirm.mutationOptions({
      onSuccess: (r) => {
        notify.success(`导入 ${r.imported} 张，跳过 ${r.skipped} 张`);
        setRows([]);
        void refresh();
      },
    }),
  );
  const enable = useMutation(
    api.enable.mutationOptions({ onSuccess: () => notify.success('固定资产已开通，现有数据保留') }),
  );
  const template = () =>
    exportToExcel({
      fileName: '固定资产期初模板',
      columns: headers.map((title, i) => ({ title, value: (r: string[]) => r[i] })),
      rows: [],
    });
  const load = async (file: File) => {
    const { Workbook } = await import('exceljs');
    const wb = new Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0];
    if (!ws) {
      notify.error('工作簿没有工作表');
      return;
    }
    if (headers.some((h, i) => ws.getRow(1).getCell(i + 1).text !== h)) {
      notify.error('模板列名不符，请使用本页 Excel 模板');
      return;
    }
    const imported: { row: number; data: unknown }[] = [];
    ws.eachRow((r, i) => {
      if (i === 1) return;
      const v = (n: number) => {
        const cell = r.getCell(n);
        return cell.value instanceof Date
          ? cell.value.toISOString().slice(0, 10)
          : cell.text.trim();
      };
      const mid = (kind: string, code: string) =>
        masters.data?.find((m) => m.kind === kind && m.code === code)?.id ?? 0;
      imported.push({
        row: i,
        data: {
          code: v(1),
          name: v(2),
          categoryId: mid('category', v(3)),
          statusId: mid('status', v(4)),
          purposeId: mid('purpose', v(5)),
          departmentId: departments.find((d) => d.code === v(6))?.id ?? 0,
          acquired: v(7),
          useDate: v(8),
          original: parseMoney(v(9)) ?? -1,
          rate: v(10),
          method: v(11),
          lifeMonths: Number(v(12)),
          openingDepreciation: parseMoney(v(13) || '0') ?? -1,
          openingMonths: Number(v(14) || '0'),
          totalWork: v(15) || '0',
          openingWork: v(16) || '0',
          model: v(17),
          unit: v(18) || '台',
          quantity: v(19) || '1',
          confirmShortLife: v(20) === '是',
          residual: v(21) ? (parseMoney(v(21)) ?? -1) : undefined,
          reference: v(22),
        },
      });
    });
    setFilename(file.name);
    setRows(imported);
  };
  const exportOpening = async () => {
    const cards = await import('@caiwu/web-kit').then(({ queryClient }) =>
      queryClient.fetchQuery(api.list.queryOptions({ includeDisposed: true })),
    );
    if (!cards.length) {
      notify.error('没有卡片可导出');
      return;
    }
    const code = (id: number) => masters.data?.find((m) => m.id === id)?.code ?? '';
    await exportToExcel({
      fileName: '固定资产期初卡片',
      columns: headers.map((title, i) => ({ title, value: (r: string[]) => r[i] })),
      rows: cards.map((c) => [
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
      ]),
    });
  };
  return (
    <PageContainer title="期初导入与开通">
      <Alert
        title="正常开通与期初导入保留已有数据。重导相同卡片会跳过；同编号不同期初数据拒绝覆盖。首次计提前完成导入。"
        description="使用年限单位是月；少于 30 月的行请先复核，再在模板的复核列填写「是」。方法码 1 为平均年限法，2 为工作量法；数量最多六位小数，日期填 YYYY-MM-DD。"
      />
      <Space wrap style={{ margin: '16px 0' }}>
        <Button onClick={() => enable.mutate()}>开通（保留数据）</Button>
        <Button onClick={() => void template()}>下载 Excel 模板</Button>
        <label>
          <span>选择 Excel 文件：</span>
          <input
            aria-label="选择期初 Excel"
            type="file"
            accept=".xlsx"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file)
                void load(file).catch(() => notify.error('无法读取 Excel 文件，请检查格式'));
            }}
          />
        </label>
        <Button onClick={() => void exportOpening()}>导出期初卡片</Button>
        <Button disabled>破坏性重置（不可用）</Button>
      </Space>
      <Alert
        type="warning"
        title="当前 core 未提供完整在线备份、恢复及排他锁接口，因此破坏性重置已禁用。"
      />
      <p>
        基础资料使用编码匹配。类别/用途/状态在资产基础档案维护，部门来自 core 部门维度。{filename}
      </p>
      <DataTable
        tableId="fixed-assets-import-preview"
        rowKey="row"
        dataSource={preview.data?.rows.map((r) => ({ ...r, data: undefined })) ?? []}
        columns={[
          { key: 'row', title: 'Excel 行', dataIndex: 'row' },
          { key: 'code', title: '设备编号', dataIndex: 'code' },
          { key: 'status', title: '状态', dataIndex: 'status' },
          { key: 'error', title: '逐行错误', dataIndex: 'error', width: 500 },
        ]}
      />
      {preview.data && !preview.isPending && (
        <Confirm
          title={`确认将 ${preview.data.count} 张有效期初卡片入库？所有行须通过校验。`}
          onConfirm={() => confirm.mutate({ rows, token: preview.data!.token, confirm: true })}
        >
          确认期初入库
        </Confirm>
      )}
    </PageContainer>
  );
}
