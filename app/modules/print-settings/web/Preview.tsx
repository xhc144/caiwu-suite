import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Space } from 'antd';
import { useMutation } from '@tanstack/react-query';
import {
  isDesktop,
  assertRenderedPrintFits,
  layoutGeometry,
  parsePageRange,
  renderPrintDocument,
  runPrintBatch,
  manualDuplexPdfJob,
  planManualDuplex,
  DuplexDeliveryError,
  type DuplexResume,
  saveAsPdf,
  viewToPrintJob,
  type PrintView,
} from '@caiwu/print';
import { notify, showError, useHotkey, usePermission } from '@caiwu/web-kit';
import { api } from './api';
const PX_PER_MM = 96 / 25.4;
const ZOOMS = [25, 50, 75, 100, 125, 150, 200];

function Ruler({
  length,
  zoom,
  vertical = false,
}: {
  length: number;
  zoom: number;
  vertical?: boolean;
}) {
  const pixels = (length * PX_PER_MM * zoom) / 100;
  const size = 24;
  return (
    <svg
      aria-label={vertical ? '垂直标尺（毫米）' : '水平标尺（毫米）'}
      width={vertical ? size : pixels}
      height={vertical ? pixels : size}
      style={{
        position: 'absolute',
        top: vertical ? size : 0,
        left: vertical ? 0 : size,
        background: '#f8fafc',
      }}
    >
      {Array.from({ length: Math.floor(length) + 1 }, (_, mm) => {
        const p = (mm * PX_PER_MM * zoom) / 100;
        const tick = mm % 10 === 0 ? 10 : mm % 5 === 0 ? 6 : 3;
        return (
          <g key={mm}>
            <line
              x1={vertical ? size - tick : p}
              y1={vertical ? p : size - tick}
              x2={vertical ? size : p}
              y2={vertical ? p : size}
              stroke="#64748b"
            />
            {mm % 10 === 0 && (
              <text
                x={vertical ? 1 : p + 2}
                y={vertical ? p + 10 : 11}
                fontSize={10}
                fill="#334155"
              >
                {mm}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
export default function Preview({
  view,
  kind,
  onClose,
  pause = 'none',
}: {
  view: PrintView;
  kind: 'voucher' | 'ledger' | 'format';
  onClose: () => void;
  pause?: 'none' | 'page' | 'voucher' | 'account';
}) {
  const [page, setPage] = useState(1),
    [zoom, setZoom] = useState(75),
    [customZoom, setCustomZoom] = useState(false),
    [zoomDraft, setZoomDraft] = useState('75'),
    [zoomError, setZoomError] = useState(false),
    [rulers, setRulers] = useState(false),
    [range, setRange] = useState(''),
    [scope, setScope] = useState('all'),
    [busy, setBusy] = useState(false),
    [duplex, setDuplex] = useState(false),
    [duplexBlocked, setDuplexBlocked] = useState<string | null>(null),
    [pending, setPending] = useState<{
      view: PrintView;
      pages: number[];
      resume: DuplexResume;
    } | null>(null),
    [layoutError, setLayoutError] = useState<string | null>(null);
  const lock = useRef(false),
    abort = useRef<AbortController | null>(null),
    viewport = useRef<HTMLDivElement | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const { modal } = App.useApp();
  const canExport = usePermission('print-settings.export');
  const audit = useMutation(api.recordOutput.mutationOptions());
  const current = Math.min(page, view.pages.length),
    g = layoutGeometry(view.layout),
    outputBlocked = !!pending || !!duplexBlocked;
  const confirm = (message: string) =>
    new Promise<boolean>((resolve) => {
      let accepted = false;
      modal.confirm({
        title: message,
        okText: '继续打印',
        cancelText: '取消后续',
        onOk: () => {
          accepted = true;
        },
        onCancel: () => {
          accepted = false;
        },
        afterClose: () => resolve(accepted),
      });
    });
  const output = async (pdf: boolean, which?: 'current' | 'all', resume = false) => {
    if (lock.current || duplexBlocked) return;
    if (pending && !resume) return;
    if (resume && (!pending || pending.view !== view)) {
      showError(
        new Error('预览内容已改变，不能把恢复点用于当前纸叠；请核对后放弃恢复点并新建作业'),
      );
      return;
    }
    if (layoutError) {
      showError(new Error(layoutError));
      return;
    }
    lock.current = true;
    setBusy(true);
    abort.current = new AbortController();
    let duplexStarted = false;
    try {
      const target = which ?? scope;
      const selected =
        resume && pending
          ? pending.pages
          : target === 'current'
            ? [current]
            : target === 'all'
              ? view.pages.map((_, i) => i + 1)
              : parsePageRange(range, view.pages.length);
      const count =
        pdf && duplex
          ? planManualDuplex(view, selected).reduce((n, s) => n + s.slots.length, 0)
          : selected.length;
      await audit.mutateAsync({ kind, action: pdf ? 'pdf' : 'print', pages: count });
      if (abort.current.signal.aborted) return;
      if (pdf) {
        if (!isDesktop())
          notify.info('请在系统打印对话框中选择“另存为 PDF”；浏览器不会返回文件路径');
        const path = await saveAsPdf(
          duplex ? manualDuplexPdfJob(view, selected) : viewToPrintJob(view, selected),
        );
        if (path) notify.success(`PDF 已保存：${path}`);
        else
          notify.info(
            isDesktop() ? '已取消 PDF 保存' : '打印对话框已关闭，文件是否保存以系统对话框为准',
          );
      } else {
        duplexStarted = duplex;
        const result = await runPrintBatch(view, {
          pages: selected,
          copies: view.layout.copies,
          pause,
          duplex,
          confirm,
          signal: abort.current.signal,
          resume: resume ? pending?.resume : undefined,
        });
        setPending(result.resume ? { view, pages: selected, resume: result.resume } : null);
        const blanks = result.blankPages ? `，另提交 ${result.blankPages} 页空白走纸槽` : '';
        notify.info(
          result.cancelled
            ? `已停止后续打印，已提交 ${result.sent.length} 页${blanks}`
            : `已提交系统打印对话框 ${result.sent.length} 页${blanks}，完成或取消请以系统结果为准`,
        );
      }
    } catch (e) {
      if (duplexStarted) {
        // 一旦进入双面执行，任何异常都不能再沿用执行前的恢复点。
        setPending(null);
        setDuplexBlocked(
          e instanceof DuplexDeliveryError
            ? e.message
            : '双面作业中断，已作废恢复点。请先检查系统打印队列与实际纸叠，核对已提交部分并取走旧纸叠，再新建作业。',
        );
      }
      showError(e);
    } finally {
      lock.current = false;
      setBusy(false);
      abort.current = null;
    }
  };
  useHotkey('Ctrl+P', () => {
    void output(false);
  });
  useHotkey('Shift+P', () => {
    void output(false, 'current');
  });
  useHotkey('PageDown', () => setPage(Math.min(current + 1, view.pages.length)));
  useHotkey('PageUp', () => setPage(Math.max(current - 1, 1)));
  const doc = renderPrintDocument(viewToPrintJob(view, [current]));
  const applyZoom = () => {
    const value = Number(zoomDraft);
    const valid = zoomDraft.trim() !== '' && Number.isInteger(value) && value >= 10 && value <= 400;
    setZoomError(!valid);
    if (valid) setZoom(value);
  };
  const pageWidth = (g.width * PX_PER_MM * zoom) / 100;
  const pageHeight = (g.height * PX_PER_MM * zoom) / 100;
  return (
    <section aria-label="打印预览">
      {layoutError && <Alert type="error" title={layoutError} />}
      {g.warning && <Alert type="warning" title={g.warning} />}
      {duplex && (
        <Alert
          type="info"
          title="手动双面按科目完成正反两轮；空白页也必须走纸。正面第1张至最后1张应以同序进纸打背面，系统关闭反序、自动双面和跳过空白页。PDF 按每张纸正反顺序保留空白页。"
        />
      )}
      {pending && (
        <Alert
          type="warning"
          title="双面作业已暂停，恢复点仅在当前预览有效。先确认系统已提交作业的实际结果，再恢复尚未提交部分；关闭预览不保存恢复点。"
        />
      )}
      {duplexBlocked && <Alert type="error" title={duplexBlocked} />}
      <Space wrap style={{ margin: '12px 0' }}>
        <Button disabled={current <= 1 || busy} onClick={() => setPage(current - 1)}>
          上页
        </Button>
        <Button
          disabled={current >= view.pages.length || busy}
          onClick={() => setPage(current + 1)}
        >
          下页
        </Button>
        <label>
          跳到页
          <input
            aria-label="跳到页"
            type="number"
            min={1}
            max={view.pages.length}
            value={current}
            style={{ width: 64 }}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n > 0 && n <= view.pages.length) setPage(n);
            }}
          />
        </label>
        <span data-testid="page-count">共 {view.pages.length} 页</span>
        <label>
          屏幕缩放
          <select
            aria-label="屏幕缩放"
            value={customZoom || !ZOOMS.includes(zoom) ? 'custom' : String(zoom)}
            onChange={(e) => {
              setCustomZoom(e.target.value === 'custom');
              setZoomError(false);
              if (e.target.value !== 'custom') {
                setZoom(Number(e.target.value));
                setZoomDraft(e.target.value);
              } else setZoomDraft(String(zoom));
            }}
          >
            {ZOOMS.map((n) => (
              <option key={n} value={n}>
                {n}%
              </option>
            ))}
            <option value="custom">自定义</option>
          </select>
        </label>
        {(customZoom || !ZOOMS.includes(zoom)) && (
          <>
            <label>
              自定义缩放（%）
              <input
                aria-label="自定义屏幕缩放百分比"
                type="number"
                min={10}
                max={400}
                step={1}
                value={zoomDraft}
                style={{ width: 76 }}
                onChange={(e) => setZoomDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyZoom();
                }}
              />
            </label>
            <Button onClick={applyZoom}>应用缩放</Button>
            {zoomError && <span role="alert">缩放比例须为 10–400 的整数</span>}
          </>
        )}
        <Button
          onClick={() => {
            const available =
              (viewport.current?.clientWidth ?? window.innerWidth) - 32 - (rulers ? 24 : 0);
            const value = Math.max(
              10,
              Math.min(400, Math.floor((available / (g.width * PX_PER_MM)) * 100)),
            );
            setZoom(value);
            setZoomDraft(String(value));
            setCustomZoom(!ZOOMS.includes(value));
            setZoomError(false);
          }}
        >
          适合宽度
        </Button>
        <label>
          <input type="checkbox" checked={rulers} onChange={(e) => setRulers(e.target.checked)} />
          显示毫米标尺
        </label>
        <label>
          打印范围
          <select
            aria-label="打印范围"
            value={scope}
            disabled={busy || outputBlocked}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="all">全部</option>
            <option value="current">当前页</option>
            <option value="range">页码列表 / 区间</option>
          </select>
        </label>
        {scope === 'range' && (
          <input
            aria-label="页码范围"
            value={range}
            placeholder="1,3,5-12"
            disabled={busy || outputBlocked}
            onChange={(e) => setRange(e.target.value)}
          />
        )}
        {kind === 'ledger' && (
          <label>
            <input
              type="checkbox"
              checked={duplex}
              disabled={busy || outputBlocked}
              onChange={(e) => setDuplex(e.target.checked)}
            />
            奇偶页分次打印（手动翻面）
          </label>
        )}
        <Button
          disabled={busy || !!layoutError || outputBlocked}
          onClick={() => void output(false)}
        >
          打印所选范围
        </Button>
        <Button
          disabled={busy || !!layoutError || outputBlocked}
          onClick={() => void output(false, 'current')}
        >
          打印本页
        </Button>
        <Button
          disabled={busy || !!layoutError || outputBlocked}
          onClick={() => void output(false, 'all')}
        >
          打印全部
        </Button>
        {canExport && (
          <Button
            disabled={busy || !!layoutError || outputBlocked}
            onClick={() => void output(true)}
          >
            PDF
          </Button>
        )}
        {pending && (
          <>
            <Button
              disabled={busy || pending.view !== view}
              onClick={() => void output(false, undefined, true)}
            >
              恢复后续双面作业
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                modal.confirm({
                  title: '放弃本预览的双面恢复点？',
                  content: '已提交的纸张不会撤回。新作业会从正面开始，请先核对并取走旧纸叠。',
                  onOk: () => setPending(null),
                })
              }
            >
              放弃双面恢复点
            </Button>
          </>
        )}
        {duplexBlocked && (
          <Button
            disabled={busy}
            onClick={() =>
              modal.confirm({
                title: '已人工核对系统打印队列与实际纸叠？',
                content:
                  '异常步骤可能已经打印，旧恢复点已作废。请核对并取走旧纸叠。新作业会从正面开始，不会接续旧作业；关闭预览也不会撤销已提交作业。确认后仅解除阻止，不会立即投递。',
                okText: '已核对，允许新建',
                cancelText: '继续核对',
                onOk: () => setDuplexBlocked(null),
              })
            }
          >
            核对后新建双面作业
          </Button>
        )}
        {busy ? (
          <Button onClick={() => abort.current?.abort()}>取消后续打印</Button>
        ) : (
          <Button onClick={onClose}>关闭预览</Button>
        )}
      </Space>
      <div
        ref={viewport}
        style={{ overflow: 'auto', background: '#d9dfe7', padding: 16, maxHeight: '70vh' }}
      >
        <div
          style={{
            width: pageWidth + (rulers ? 24 : 0),
            height: pageHeight + (rulers ? 24 : 0),
            margin: 'auto',
            position: 'relative',
          }}
        >
          {rulers && (
            <>
              <Ruler length={g.width} zoom={zoom} />
              <Ruler length={g.height} zoom={zoom} vertical />
            </>
          )}
          <iframe
            onLoad={(event) => {
              const frame = event.currentTarget;
              void (async () => {
                try {
                  const doc = frame.contentDocument;
                  if (!doc) return;
                  await doc.fonts?.ready;
                  if (!frame.isConnected) return;
                  assertRenderedPrintFits(doc);
                  setLayoutError(null);
                } catch (error) {
                  setLayoutError(error instanceof Error ? error.message : String(error));
                }
              })();
            }}
            title="当前打印页"
            sandbox="allow-same-origin"
            srcDoc={doc}
            style={{
              background: 'white',
              border: 0,
              width: `${g.width}mm`,
              height: `${g.height}mm`,
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'top left',
              position: 'absolute',
              left: rulers ? 24 : 0,
              top: rulers ? 24 : 0,
            }}
          />
        </div>
      </div>
    </section>
  );
}
