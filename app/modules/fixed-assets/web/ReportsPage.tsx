import { useEffect, useMemo, useRef, useState } from 'react';
import { skipToken, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Typography,
} from 'antd';
import { DataTable, PageContainer, type DataColumn } from '@caiwu/ui';
import { assertRenderedPrintFits, escapeHtml, printHtml, renderPrintDocument } from '@caiwu/print';
import { formatMoney } from '@caiwu/core';
import { reportKinds, ReportSchema } from '../shared';
import { getBusinessError, notify, useRequiredSession } from '@caiwu/web-kit';
import { api, type Outputs } from './api';
import { useAssetFilters as useUrlFilters } from './common';
import { assetLabelsPrint } from './label-print';
import { assetReportPrint } from './asset-print';
import PrintSettings, { downloadAssetFile } from './PrintSettings';

function reportInputError(path: PropertyKey | undefined) {
  return (
    (
      {
        kind: '请选择有效报表',
        year: '年度请填写 1900 至 9999 的整数',
        cutoff: '截止日请填写有效日期',
        fromCode: '起始设备编号不能超过 40 字',
        toCode: '截止设备编号不能超过 40 字',
        labelRange: '请选择打印全部或按标签序号',
        fromSerial: '起始序号必须为正整数',
        toSerial: '截止序号必须为正整数',
        labelColor: '请选择单色或彩色打印',
        measure: '请选择分布口径',
        departmentLevel: '请选择部门层级',
        categoryLevel: '请选择资产类别层级',
      } as Record<PropertyKey, string>
    )[path ?? ''] ?? '请检查查询条件'
  );
}

export default function ReportsPage() {
  const session = useRequiredSession();
  const year = Math.trunc(session.book.startPeriod / 100);
  const settings = useQuery(api.printSettings.queryOptions());
  const [reportPreview, setReportPreview] = useState(false);
  const [f, setF] = useUrlFilters({
    kind: 'list',
    year,
    cutoff: `${year}-12-31`,
    includeEarlier: false as boolean,
    fromCode: '',
    toCode: '',
    labelRange: 'all',
    fromSerial: 1,
    toSerial: 1,
    labelColor: 'monochrome',
    measure: 'original',
    departmentLevel: 'detail',
    categoryLevel: 'detail',
  });
  const parsed = useMemo(() => ReportSchema.safeParse(f), [f]);
  const [form] = Form.useForm<typeof f>();
  const [dirty, setDirty] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(150);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const previewFrame = useRef<HTMLIFrameElement>(null);
  const draftKind = Form.useWatch('kind', form) ?? f.kind;
  const draftRange = Form.useWatch('labelRange', form) ?? f.labelRange;
  useEffect(() => {
    form.setFieldsValue(f);
    setDirty(false);
    setFormError(null);
    setPreview(false);
  }, [f, form]);
  const q = useQuery(
    api.reports.queryOptions(parsed.success ? parsed.data : skipToken, { meta: { silent: true } }),
  );
  useEffect(() => {
    if (q.isFetching) setPreview(false);
  }, [q.isFetching]);
  const businessError = q.error ? getBusinessError(q.error) : null;
  const error =
    formError ??
    (!parsed.success ? reportInputError(parsed.error.issues[0]?.path[0]) : null) ??
    (q.error
      ? businessError && businessError.code !== 'UNKNOWN'
        ? businessError.message
        : '查询失败，请重试'
      : null);
  const result = !dirty && !error && !q.isFetching ? q.data : undefined;
  type Row = Outputs['reports']['rows'][number];
  const columns: DataColumn<Row>[] = [
    ...(f.kind === 'labels'
      ? [
          {
            key: 'serial',
            title: '标签序号',
            dataIndex: 'serial',
            width: 100,
          } satisfies DataColumn<Row>,
        ]
      : []),
    { key: 'code', title: '设备编号/分组', dataIndex: 'code', width: 150 },
    { key: 'name', title: '名称', dataIndex: 'name', width: 200 },
    { key: 'date', title: '日期', dataIndex: 'date', width: 120 },
    { key: 'department', title: '部门', dataIndex: 'department', width: 130 },
    { key: 'category', title: '类别', dataIndex: 'category', width: 150 },
    { key: 'description', title: '摘要/规格', dataIndex: 'description', width: 180 },
    { key: 'quantity', title: '数量', dataIndex: 'quantity', width: 100 },
    { key: 'reference', title: '参考编号', dataIndex: 'reference', width: 140 },
    { key: 'manufacturer', title: '制造厂', dataIndex: 'manufacturer', width: 140 },
    { key: 'installation', title: '安装地点', dataIndex: 'installation', width: 160 },
    { key: 'manufactured', title: '制造日期', dataIndex: 'manufactured', width: 120 },
    { key: 'machineCode', title: '本机编号', dataIndex: 'machineCode', width: 140 },
    { key: 'custodian', title: '保管人', dataIndex: 'custodian', width: 120 },
    { key: 'currencyCode', title: '币种', dataIndex: 'currencyCode', width: 100 },
    { key: 'foreignOriginal', title: '外币原值', dataIndex: 'foreignOriginal', width: 140 },
    {
      key: 'original',
      title: f.kind === 'distribution' ? '分布金额' : '原值/金额',
      dataIndex: 'original',
      money: true,
    },
    { key: 'depreciation', title: '累计折旧', dataIndex: 'depreciation', money: true },
    { key: 'net', title: '净值', dataIndex: 'net', money: true },
  ];
  if (f.kind === 'ledger')
    columns.splice(
      7,
      0,
      { key: 'originalChange', title: '原值增减', dataIndex: 'originalChange', money: true },
      {
        key: 'depreciationChange',
        title: '折旧增减',
        dataIndex: 'depreciationChange',
        money: true,
      },
    );
  const labels =
    result?.rows.length && f.kind === 'labels' && parsed.success
      ? assetLabelsPrint(result.rows, parsed.data.labelColor, settings.data)
      : undefined;
  // 空结果不能进入标签渲染器；其余报表保留中文空态。
  const previewRow = result?.rows[page];
  const previewDocument =
    labels && previewRow && parsed.success
      ? renderPrintDocument(assetLabelsPrint([previewRow], parsed.data.labelColor, settings.data))
      : '';
  const submit = (draft: typeof f) => {
    const checked = ReportSchema.safeParse(draft);
    setPreview(false);
    if (!checked.success) {
      setFormError(reportInputError(checked.error.issues[0]?.path[0]));
      setDirty(true);
      return;
    }
    if (
      checked.data.kind === 'labels' &&
      checked.data.labelRange === 'serial' &&
      checked.data.fromSerial > checked.data.toSerial
    ) {
      setFormError('起始序号不能大于截止序号');
      setDirty(true);
      return;
    }
    setFormError(null);
    setDirty(false);
    setPage(0);
    if (parsed.success && JSON.stringify(checked.data) === JSON.stringify(parsed.data))
      void q.refetch();
    setF(checked.data);
  };
  const print = async () => {
    if (!result?.rows.length || !parsed.success) return;
    setPrinting(true);
    try {
      if (labels) await printHtml(labels);
      else if (f.kind === 'ledger' || f.kind === 'register')
        await printHtml(
          assetReportPrint(
            result,
            f.kind,
            { unit: session.book.orgName, cutoff: f.cutoff, year: f.year },
            settings.data,
          ),
        );
      else
        await printHtml({
          title: result.title,
          orientation: 'landscape',
          html: `<h2>${escapeHtml(result.title)}</h2><p>截止 ${escapeHtml(f.cutoff)}</p><table><thead><tr>${columns.map((c) => `<th>${escapeHtml(c.title)}</th>`).join('')}</tr></thead><tbody>${result.rows
            .map(
              (r) =>
                `<tr>${columns
                  .map((c) => {
                    const val = r[c.dataIndex as keyof Row];
                    return `<td>${escapeHtml(c.money ? formatMoney(Number(val)) : val)}</td>`;
                  })
                  .join('')}</tr>`,
            )
            .join('')}</tbody></table><p>原值/金额合计：${formatMoney(result.total)} 元</p>`,
        });
    } catch (e) {
      notify.error(e instanceof Error ? e.message : '打印失败，请重试');
    } finally {
      setPrinting(false);
    }
  };
  const downloadLabels = () => {
    if (!labels || !result?.rows.length) return;
    const url = URL.createObjectURL(
      new Blob([renderPrintDocument(labels)], { type: 'text/html;charset=utf-8' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '固定资产标签.html';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <PageContainer
      title="资产报表与标签"
      extra={
        <Space wrap>
          <PrintSettings />
          {(f.kind === 'ledger' || f.kind === 'register') && (
            <>
              <Button disabled={!result?.rows.length} onClick={() => setReportPreview(true)}>
                预览账册版式
              </Button>
              <Button
                disabled={!result?.rows.length}
                onClick={() => {
                  if (result && (f.kind === 'ledger' || f.kind === 'register'))
                    downloadAssetFile(
                      renderPrintDocument(
                        assetReportPrint(
                          result,
                          f.kind,
                          { unit: session.book.orgName, cutoff: f.cutoff, year: f.year },
                          settings.data,
                        ),
                      ),
                      `${result.title}.html`,
                    );
                }}
              >
                保存账册 HTML 文件
              </Button>
            </>
          )}
          {f.kind === 'labels' && (
            <>
              <Button
                disabled={!result?.rows.length}
                onClick={() => {
                  setPage(0);
                  setPreviewError(null);
                  setPreview(true);
                }}
              >
                预览资产标签
              </Button>
              <Button disabled={!result?.rows.length} onClick={downloadLabels}>
                保存标签 HTML 文件
              </Button>
            </>
          )}
          <Button disabled={!result?.rows.length} loading={printing} onClick={() => void print()}>
            打印当前报表
          </Button>
        </Space>
      }
    >
      <Form
        form={form}
        layout="inline"
        initialValues={f}
        onValuesChange={() => {
          setDirty(true);
          setFormError(null);
          setPreview(false);
        }}
        onFinish={submit}
        style={{ rowGap: 8, marginBottom: 16 }}
      >
        <Form.Item name="kind" label="报表">
          <Select
            style={{ width: 190 }}
            options={Object.entries(reportKinds).map(([value, label]) => ({ value, label }))}
          />
        </Form.Item>
        <Form.Item name="year" label="年度">
          <InputNumber controls={false} />
        </Form.Item>
        <Form.Item name="cutoff" label="截止日">
          <Input type="date" />
        </Form.Item>
        <Form.Item name="includeEarlier" valuePropName="checked">
          <Checkbox>到期清单含以前年度</Checkbox>
        </Form.Item>
        <Form.Item name="fromCode" label="编号从">
          <Input />
        </Form.Item>
        <Form.Item name="toCode" label="至">
          <Input />
        </Form.Item>
        {draftKind === 'labels' && (
          <>
            <Form.Item name="labelRange" label="标签范围">
              <Select
                style={{ width: 150 }}
                options={[
                  { value: 'all', label: '打印全部' },
                  { value: 'serial', label: '按标签序号' },
                ]}
              />
            </Form.Item>
            <Form.Item name="fromSerial" label="起始序号">
              <InputNumber min={1} precision={0} disabled={draftRange !== 'serial'} />
            </Form.Item>
            <Form.Item name="toSerial" label="截止序号">
              <InputNumber min={1} precision={0} disabled={draftRange !== 'serial'} />
            </Form.Item>
            <Form.Item name="labelColor" label="打印颜色">
              <Select
                style={{ width: 100 }}
                options={[
                  { value: 'monochrome', label: '单色' },
                  { value: 'color', label: '彩色' },
                ]}
              />
            </Form.Item>
          </>
        )}
        <Form.Item name="measure" label="分布口径">
          <Select
            options={[
              { value: 'original', label: '原值' },
              { value: 'net', label: '净值' },
              { value: 'depreciation', label: '累计折旧' },
            ]}
          />
        </Form.Item>
        <Form.Item name="departmentLevel" label="部门">
          <Select
            options={[
              { value: 'detail', label: '明细' },
              { value: 'top', label: '大类' },
            ]}
          />
        </Form.Item>
        <Form.Item name="categoryLevel" label="资产类别">
          <Select
            options={[
              { value: 'detail', label: '细类' },
              { value: 'top', label: '大类' },
            ]}
          />
        </Form.Item>
        <Button type="primary" htmlType="submit">
          查询报表
        </Button>
      </Form>
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 12 }} />}
      {dirty && !error && (
        <Alert
          type="info"
          title="查询条件已修改，请点击查询报表后再预览、打印或导出"
          style={{ marginBottom: 12 }}
        />
      )}
      <Typography.Title level={4}>
        {result?.title ?? (reportKinds[f.kind as keyof typeof reportKinds] || '资产报表')}
      </Typography.Title>
      {f.kind === 'labels' && (
        <p>
          标签纸张 8.8cm × 5.1cm。标签序号从 1
          起，按当前截止日及编号筛选后的设备编号升序编排，与设备编号不同。
          {result ? `范围内共 ${result.labelCount} 条，本次输出 ${result.rows.length} 张。` : ''}
        </p>
      )}
      <DataTable
        tableId={`fixed-assets-report-${f.kind}`}
        rowKey="key"
        dataSource={result?.rows ?? []}
        columns={columns}
        loading={q.isFetching}
        exportName={result?.rows.length ? result.title : undefined}
        locale={{ emptyText: result?.empty ?? '没有记录' }}
      />
      <p>
        {f.kind === 'ledger'
          ? `各行展示增减发生额与余额。期末原值合计：${formatMoney(result?.total ?? 0)} 元。`
          : `金额合计：${formatMoney(result?.total ?? 0)} 元`}
      </p>
      <Modal
        destroyOnHidden
        title="资产标签预览"
        open={preview && !!result?.rows.length}
        onCancel={() => setPreview(false)}
        width={760}
        footer={
          <Space wrap>
            <Button onClick={() => setPreview(false)}>关闭预览</Button>
            <Button disabled={!!previewError} onClick={downloadLabels}>
              保存标签 HTML 文件
            </Button>
            <Button disabled={!!previewError} loading={printing} onClick={() => void print()}>
              打印标签
            </Button>
          </Space>
        }
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Button
            disabled={page === 0}
            onClick={() => {
              setPage((p) => p - 1);
              setPreviewError(null);
            }}
          >
            上一张
          </Button>
          <span>
            第 {page + 1} / {result?.rows.length ?? 0} 张；标签序号 {previewRow?.serial ?? ''}
          </span>
          <Button
            disabled={page + 1 >= (result?.rows.length ?? 0)}
            onClick={() => {
              setPage((p) => p + 1);
              setPreviewError(null);
            }}
          >
            下一张
          </Button>
          <Button disabled={zoom <= 75} onClick={() => setZoom((z) => z - 25)}>
            缩小
          </Button>
          <span>{zoom}%</span>
          <Button disabled={zoom >= 200} onClick={() => setZoom((z) => z + 25)}>
            放大
          </Button>
        </Space>
        {previewError && <Alert type="error" title={previewError} />}
        <div style={{ overflow: 'auto', background: '#eee', padding: 16, minHeight: 330 }}>
          <div style={{ width: `${(88 * zoom) / 100}mm`, height: `${(51 * zoom) / 100}mm` }}>
            <iframe
              ref={previewFrame}
              title="资产标签纸张预览"
              sandbox="allow-same-origin"
              srcDoc={previewDocument}
              style={{
                width: '88mm',
                height: '51mm',
                border: '1px solid #999',
                background: 'white',
                transform: `scale(${zoom / 100})`,
                transformOrigin: 'top left',
              }}
              onLoad={(event) => {
                const document = event.currentTarget.contentDocument;
                if (!document) return;
                void document.fonts.ready.then(() => {
                  if (previewFrame.current?.contentDocument !== document) return;
                  try {
                    assertRenderedPrintFits(document);
                    setPreviewError(null);
                  } catch (e) {
                    setPreviewError(
                      e instanceof Error ? e.message : '标签内容超出纸张，请检查档案文字',
                    );
                  }
                });
              }}
            />
          </div>
        </div>
      </Modal>
      <Modal
        open={
          reportPreview && !!result?.rows.length && (f.kind === 'ledger' || f.kind === 'register')
        }
        title="固定资产账册预览"
        width={1000}
        onCancel={() => setReportPreview(false)}
        footer={<Button onClick={() => setReportPreview(false)}>关闭预览</Button>}
      >
        <iframe
          title="固定资产账册版式"
          sandbox="allow-same-origin"
          style={{ width: '100%', height: '70vh', border: '1px solid #aaa' }}
          srcDoc={
            result && (f.kind === 'ledger' || f.kind === 'register')
              ? renderPrintDocument(
                  assetReportPrint(
                    result,
                    f.kind,
                    { unit: session.book.orgName, cutoff: f.cutoff, year: f.year },
                    settings.data,
                  ),
                )
              : ''
          }
        />
      </Modal>
    </PageContainer>
  );
}
