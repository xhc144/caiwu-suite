import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Typography,
} from 'antd';
import { printHtml, renderPrintDocument, type PrintJob } from '@caiwu/print';
import { queryClient, showError, usePermission } from '@caiwu/web-kit';
import { downloadBlob } from '@caiwu/ui';
import { PrintOptionsSchema, type LedgerPrintPage, type PrintOptions } from '../printing';
import type { ColumnId, LedgerQuery, LedgerReport } from '../shared';
import { api } from './api';

type Preview = PrintJob & { report: LedgerReport; pages: LedgerPrintPage[]; totalPages: number };

export default function PrintDrawer({
  open,
  onClose,
  query,
  columns,
  report,
  onReport,
  mode = 'print',
}: {
  open: boolean;
  onClose: () => void;
  query: LedgerQuery;
  columns: ColumnId[];
  report?: LedgerReport;
  onReport?: (report: LedgerReport) => void;
  mode?: 'print' | 'export';
}) {
  const [form] = Form.useForm<PrintOptions>();
  const canExport = usePermission('ledgers.export');
  const canPrint = usePermission('ledgers.print');
  const [pending, setPending] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [failure, setFailure] = useState('');
  const [preview, setPreview] = useState<{ source: string; job: Preview; document: string } | null>(
    null,
  );
  const version = useRef(0);
  const source = JSON.stringify({ query, columns });
  const current = preview?.source === source ? preview : null;
  const accountRows = report?.rows ?? current?.job.report.rows ?? [];
  const accountOptions = [
    ...new Map(
      accountRows.map((row) => [
        row.account.split(' ')[0]!,
        { value: row.account.split(' ')[0]!, label: row.account },
      ]),
    ).values(),
  ];
  const load = async () => {
    if (pending) return;
    setFailure('');
    setPreview(null);
    const requestVersion = version.current;
    try {
      const options = PrintOptionsSchema.parse(await form.validateFields());
      setPending(true);
      const job = await queryClient.fetchQuery({
        ...api.print.queryOptions({ ...query, columns, printOptions: options }),
        staleTime: 0,
      });
      const document = renderPrintDocument(job);
      onReport?.(job.report);
      if (requestVersion === version.current) setPreview({ source, job, document });
    } catch (error) {
      if (error && typeof error === 'object' && 'errorFields' in error) return;
      const text = error instanceof Error ? error.message : '打印预览失败，请重试。';
      setFailure(text);
      showError(error);
    } finally {
      setPending(false);
    }
  };
  const print = async () => {
    if (!current || printing) return;
    setPrinting(true);
    try {
      await printHtml(current.job);
    } catch (error) {
      showError(error);
    } finally {
      setPrinting(false);
    }
  };
  const exportSelected = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const accountCodes =
        query.kind === 'vat'
          ? []
          : PrintOptionsSchema.shape.accountCodes.parse(form.getFieldValue('accountCodes'));
      const result = await queryClient.fetchQuery({
        ...api.export.queryOptions({ ...query, columns, accountCodes }),
        staleTime: 0,
      });
      const bytes = Uint8Array.from(atob(result.base64), (value) => value.charCodeAt(0));
      downloadBlob(
        new Blob([bytes], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        result.fileName,
      );
    } catch (error) {
      showError(error);
    } finally {
      setExporting(false);
    }
  };
  return (
    <Drawer
      title={mode === 'print' ? '连续打印与套打' : '批量转出选择'}
      open={open}
      onClose={onClose}
      size="large"
      destroyOnHidden
      footer={
        <Space wrap>
          <Button onClick={onClose}>关闭</Button>
          {canExport && (
            <Button
              onClick={() => void exportSelected()}
              loading={exporting}
              disabled={printing || pending}
            >
              导出所选账簿 Excel
            </Button>
          )}
          {mode === 'print' && canPrint && (
            <Button onClick={() => void load()} loading={pending} disabled={printing || exporting}>
              生成打印预览
            </Button>
          )}
          {mode === 'print' && canPrint && (
            <Button
              type="primary"
              disabled={!current || pending || exporting}
              loading={printing}
              onClick={() => void print()}
            >
              打印已预览账页
            </Button>
          )}
        </Space>
      }
    >
      <Alert
        type="info"
        title={
          mode === 'print'
            ? '每个科目和辅助对象独立换页；承前页、过次页列示本期累计，不重复计算小计。'
            : '按当前期间、辅助核算和币种筛选，选择完整科目账页转出；所选科目的全部明细、小计和累计一起保存。'
        }
        style={{ marginBottom: 16 }}
      />
      <Form
        form={form}
        layout="vertical"
        initialValues={PrintOptionsSchema.parse({})}
        onValuesChange={() => {
          version.current++;
          setPreview(null);
          setFailure('');
        }}
      >
        {query.kind !== 'vat' && (
          <Form.Item
            name="accountCodes"
            label={mode === 'print' ? '连续打印科目' : '转出科目'}
            extra="留空表示当前筛选中的全部科目；辅助对象分别打印。"
          >
            <Select
              mode="multiple"
              allowClear
              options={accountOptions}
              placeholder="当前账簿全部科目"
            />
          </Form.Item>
        )}
        {mode === 'print' && (
          <>
            <Form.Item name="content" label="打印内容">
              <Select
                options={[
                  { value: 'all', label: '当前账簿全部账页' },
                  { value: 'entries', label: '仅有本期发生的科目' },
                  { value: 'balance', label: '有期初余额或本年累计的科目' },
                ]}
              />
            </Form.Item>
            <Space wrap align="start">
              <Form.Item name="paper" label="纸张">
                <Select
                  style={{ width: 100 }}
                  options={['A4', 'A5', 'B5', 'custom'].map((value) => ({
                    value,
                    label: value === 'custom' ? '自定义' : value,
                  }))}
                />
              </Form.Item>
              <Form.Item name="orientation" label="方向">
                <Select
                  style={{ width: 110 }}
                  options={[
                    { value: 'landscape', label: '横向' },
                    { value: 'portrait', label: '纵向' },
                  ]}
                />
              </Form.Item>
              <Form.Item name="rowsPerPage" label="每页明细行数">
                <InputNumber min={1} max={60} precision={0} />
              </Form.Item>
              <Form.Item name="columnsPerPage" label="每张附页栏目数">
                <InputNumber min={1} max={10} precision={0} />
              </Form.Item>
              <Form.Item name="fontSize" label="字号（磅）">
                <InputNumber min={6} max={14} />
              </Form.Item>
            </Space>
            <Space wrap align="start">
              <Form.Item name="widthMm" label="自定义纸宽（毫米）">
                <InputNumber min={80} max={600} />
              </Form.Item>
              <Form.Item name="heightMm" label="自定义纸高（毫米）">
                <InputNumber min={80} max={600} />
              </Form.Item>
              <Form.Item name="rowHeightMm" label="账页行高（毫米）">
                <InputNumber min={3} max={20} placeholder="随字号自动" />
              </Form.Item>
            </Space>
            <Typography.Paragraph type="secondary">
              长摘要自动分行；纸张容纳不足时会减少每页行数。栏目较多时生成正页和附页，日期、凭证号、摘要在各页重复显示。
            </Typography.Paragraph>
            <Space wrap align="start">
              {(
                [
                  ['top', '上'],
                  ['right', '右'],
                  ['bottom', '下'],
                  ['left', '左'],
                ] as const
              ).map(([side, label]) => (
                <Form.Item key={side} name={['margins', side]} label={`${label}边距（毫米）`}>
                  <InputNumber min={0} max={60} />
                </Form.Item>
              ))}
            </Space>
            <Space wrap align="start">
              <Form.Item name="offsetX" label="水平偏移（毫米）">
                <InputNumber min={-60} max={60} />
              </Form.Item>
              <Form.Item name="offsetY" label="垂直偏移（毫米）">
                <InputNumber min={-60} max={60} />
              </Form.Item>
              <Form.Item name="overlay" valuePropName="checked" label="套打">
                <Checkbox>仅打印数据（隐藏表头和边框）</Checkbox>
              </Form.Item>
            </Space>
            <Typography.Paragraph type="secondary">
              正数向右、向下移动；偏移须留在纸张边距内。套打请先用普通白纸核对预印账页的位置。
            </Typography.Paragraph>
            <Space wrap align="start">
              <Form.Item name="startPage" label="印刷起始页码">
                <InputNumber min={1} max={999999} precision={0} />
              </Form.Item>
              <Form.Item name="continuousPage" valuePropName="checked" label="跨科目页码">
                <Checkbox>连续编号</Checkbox>
              </Form.Item>
            </Space>
            <Form.Item
              name="pageRange"
              label="输出页序号"
              extra="留空打印全部。按本次生成队列的第几张选择，例如 1,3,5-12；不使用印刷起始页码。"
            >
              <Input placeholder="全部，或 1,3,5-12" maxLength={1000} />
            </Form.Item>
            {canExport && (
              <Typography.Paragraph type="secondary">
                “导出所选账簿 Excel”仅应用科目选择；打印内容、页序号和页面设置用于打印。
              </Typography.Paragraph>
            )}
          </>
        )}
      </Form>
      {failure && <Alert type="error" title="预览未生成" description={failure} />}
      {mode === 'print' && current && (
        <>
          <Typography.Paragraph style={{ marginTop: 16 }}>
            共生成 {current.job.totalPages} 张，当前选择 {current.job.pages.length}{' '}
            张。更改设置后请重新生成预览。
          </Typography.Paragraph>
          <iframe
            title="账簿打印预览"
            sandbox="allow-same-origin"
            srcDoc={current.document}
            style={{ width: '100%', height: 600, border: '1px solid #d9d9d9', background: '#fff' }}
          />
        </>
      )}
    </Drawer>
  );
}
