import { useMemo, useState } from 'react';
import { Alert, Button, Card, Space } from 'antd';
import { useQuery } from '@tanstack/react-query';
import {
  buildLedgerBookView,
  buildVoucherView,
  renderPrintDocument,
  viewToPrintJob,
  type PrintView,
} from '@caiwu/print';
import { usePermission, useVoucherTypes, getBusinessError } from '@caiwu/web-kit';
import { PageContainer, useUrlFilters } from '@caiwu/ui';
import { VoucherSelectionSchema, LedgerSelectionSchema } from '../shared';
import { api } from './api';
import SettingsEditor from './SettingsEditor';
import Preview from './Preview';
import './print.css';
export default function PrintPage() {
  const [f, setF] = useUrlFilters({
    mode: 'voucher',
    from: 202601,
    to: 202601,
    period: 0,
    type: 0,
    voucherId: 0,
    ids: '',
    account: '1001',
    kind: 'detail',
    order: 'range',
    numberFrom: 0,
    numberTo: 0,
    queried: false as boolean,
    includeUnposted: false as boolean,
    printEmpty: false as boolean,
    printNoActivity: false as boolean,
  });
  const [show, setShow] = useState(!!f.voucherId || !!f.ids || f.queried),
    [settingsOpen, setSettingsOpen] = useState(false),
    [pause, setPause] = useState<'none' | 'page' | 'voucher'>('none');
  const types = useVoucherTypes();
  const canVoucher = usePermission('print-settings.voucher.print'),
    canLedger = usePermission('print-settings.ledger.print'),
    canSettings = usePermission('print-settings.settings.edit');
  const settings = useQuery(api.settings.queryOptions());
  const selection = VoucherSelectionSchema.safeParse({
    from: f.period || f.from,
    to: f.period || f.to,
    type: f.type || undefined,
    voucherId: f.voucherId || undefined,
    order: f.ids ? 'queried' : f.order,
    ids: f.ids ? f.ids.split(',').map(Number) : undefined,
    numberFrom: f.numberFrom || undefined,
    numberTo: f.numberTo || undefined,
  });
  const ledgerSelection = LedgerSelectionSchema.safeParse({
    from: f.period || f.from,
    to: f.period || f.to,
    account: f.account,
    kind: f.kind,
    includeUnposted: f.includeUnposted,
    printEmpty: f.printEmpty,
    printNoActivity: f.printNoActivity,
  });
  const vouchers = useQuery(
    api.vouchers.queryOptions(selection.success ? selection.data : { from: 202601, to: 202601 }, {
      enabled: show && f.mode === 'voucher' && selection.success && canVoucher,
    }),
  );
  const ledger = useQuery(
    api.ledgerBook.queryOptions(
      ledgerSelection.success
        ? ledgerSelection.data
        : { from: 202601, to: 202601, account: '1001', kind: 'detail' },
      { enabled: show && f.mode === 'ledger' && ledgerSelection.success && canLedger },
    ),
  );
  const rendered = useMemo(() => {
    try {
      if (!show || !settings.data) return {};
      let view: PrintView | undefined;
      if (f.mode === 'voucher' && vouchers.data)
        view = buildVoucherView(vouchers.data, {
          ...settings.data.voucher,
          ...(pause === 'voucher' ? { perPage: 1 as const } : {}),
        });
      if (f.mode === 'ledger' && ledger.data)
        view = buildLedgerBookView(ledger.data, settings.data.ledger);
      if (view) renderPrintDocument(viewToPrintJob(view));
      return { view };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [show, settings.data, f.mode, vouchers.data, ledger.data, pause]);
  const error = f.mode === 'voucher' ? vouchers.error : ledger.error;
  const validation = f.mode === 'voucher' ? selection : ledgerSelection;
  const field = (key: 'from' | 'to' | 'numberFrom' | 'numberTo', label: string) => (
    <label>
      {label}
      <input
        type="number"
        value={(key === 'from' || key === 'to' ? f.period || f[key] : f[key]) || ''}
        onChange={(e) => {
          setShow(false);
          setF({ [key]: Number(e.target.value), period: 0, voucherId: 0, ids: '', order: 'range' });
        }}
      />
    </label>
  );
  return (
    <PageContainer
      title="打印与导出"
      subtitle="使用当前账套实际数据。预览缩放不会改变打印比例。"
      extra={
        <Space>
          <Button href="/m/print-settings/formats">特殊打印格式</Button>
          {canSettings && (
            <Button onClick={() => setSettingsOpen(!settingsOpen)}>打印格式设置</Button>
          )}
        </Space>
      }
    >
      {!!f.voucherId && (
        <Alert
          type="info"
          title={`当前打印凭证 ID：${f.voucherId}`}
          action={
            <Button
              onClick={() => {
                setShow(false);
                setF({ voucherId: 0 });
              }}
            >
              改按范围选择
            </Button>
          }
        />
      )}
      <Card size="small">
        <div className="print-form">
          <label>
            打印内容
            <select
              value={f.mode}
              onChange={(e) => {
                setShow(false);
                setF({ mode: e.target.value, voucherId: 0, ids: '' });
              }}
            >
              <option value="voucher">凭证</option>
              <option value="ledger">账簿</option>
            </select>
          </label>
          {field('from', '开始期间（YYYYMM）')}
          {field('to', '结束期间（YYYYMM）')}
          {f.mode === 'voucher' ? (
            <>
              <label>
                凭证类型
                <select
                  value={f.type}
                  onChange={(e) => {
                    setShow(false);
                    setF({ type: Number(e.target.value), voucherId: 0, ids: '', order: 'range' });
                  }}
                >
                  <option value={0}>全部类型</option>
                  {types.map((t) => (
                    <option value={t.id} key={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              {field('numberFrom', '开始编号')}
              {field('numberTo', '结束编号')}
              <label>
                凭证顺序
                <select
                  value={f.ids ? 'queried' : f.order}
                  onChange={(e) => {
                    setShow(false);
                    setF({ order: e.target.value, ids: '', voucherId: 0 });
                  }}
                >
                  <option value="range">期间 / 类型 / 编号</option>
                  <option value="queried">已查询顺序 ID 集合</option>
                </select>
              </label>
              <label>
                已查询顺序 ID（逗号分隔）
                <input
                  value={f.ids}
                  placeholder="由序时簿选择后传入，或填写已查询 ID"
                  onChange={(e) => {
                    setShow(false);
                    setF({ ids: e.target.value, voucherId: 0 });
                  }}
                />
              </label>
              <label>
                连续 / 合并打印
                <select value={pause} onChange={(e) => setPause(e.target.value as typeof pause)}>
                  <option value="none">连续输出 / 按设置合并</option>
                  <option value="page">每页暂停</option>
                  <option value="voucher">每张暂停（每页一张）</option>
                </select>
              </label>
            </>
          ) : (
            <>
              <label>
                账簿格式
                <select
                  value={f.kind}
                  onChange={(e) => {
                    setShow(false);
                    setF({ kind: e.target.value });
                  }}
                >
                  {[
                    ['general', '总账'],
                    ['detail', '明细账'],
                    ['cash', '现金日记账'],
                    ['bank', '银行日记账'],
                  ].map(([v, n]) => (
                    <option key={v} value={v}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                科目编码（可用逗号选择多个）
                <input
                  value={f.account}
                  onChange={(e) => {
                    setShow(false);
                    setF({ account: e.target.value });
                  }}
                />
              </label>
              {(['includeUnposted', 'printNoActivity', 'printEmpty'] as const).map((key, i) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={f[key]}
                    onChange={(e) => {
                      setShow(false);
                      setF({ [key]: e.target.checked });
                    }}
                  />
                  {['含未过账', '打印无发生科目', '打印空科目（同时启用无发生）'][i]}
                </label>
              ))}
            </>
          )}
          <Button
            type="primary"
            onClick={() => {
              setShow(true);
              setF({ queried: true });
              if (f.mode === 'voucher' && selection.success) void vouchers.refetch();
              if (f.mode === 'ledger' && ledgerSelection.success) void ledger.refetch();
            }}
          >
            查询并预览
          </Button>
        </div>
      </Card>
      {settings.error && <Alert type="error" title={settings.error.message} />}
      {settingsOpen && settings.data && (
        <Card title="当前账套打印格式设置">
          <SettingsEditor settings={settings.data} onClose={() => setSettingsOpen(false)} />
        </Card>
      )}
      {show && !validation.success && (
        <Alert type="error" title={validation.error.issues[0]?.message} />
      )}
      {show && !(f.mode === 'voucher' ? canVoucher : canLedger) && (
        <Alert type="error" title="没有相应打印权限，请联系管理员授权" />
      )}
      {show && error && (
        <Alert
          type="error"
          title={getBusinessError(error)?.message ?? error.message}
          description={getBusinessError(error)?.hint}
        />
      )}
      {rendered.error && <Alert type="error" title={`无法渲染打印视图：${rendered.error}`} />}
      {show && rendered.view && !error && (
        <Preview
          view={rendered.view}
          kind={f.mode === 'voucher' ? 'voucher' : 'ledger'}
          pause={pause}
          onClose={() => setShow(false)}
        />
      )}
      {!show && (
        <Alert
          type="info"
          title="选择条件后查询并预览。按屏幕顺序需要已查询的凭证 ID；每页 1/2/3 张在打印格式设置中保存。"
        />
      )}
    </PageContainer>
  );
}
