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
  saveAsPdf,
  viewToPrintJob,
  type PrintView,
} from '@caiwu/print';
import { notify, showError, useHotkey, usePermission } from '@caiwu/web-kit';
import { api } from './api';
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
    [range, setRange] = useState(''),
    [scope, setScope] = useState('all'),
    [busy, setBusy] = useState(false),
    [duplex, setDuplex] = useState(false),
    [layoutError, setLayoutError] = useState<string | null>(null);
  const lock = useRef(false),
    abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const { modal } = App.useApp();
  const canExport = usePermission('print-settings.export');
  const audit = useMutation(api.recordOutput.mutationOptions());
  const current = Math.min(page, view.pages.length),
    g = layoutGeometry(view.layout);
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
  const output = async (pdf: boolean, which?: 'current' | 'all') => {
    if (lock.current) return;
    if (layoutError) {
      showError(new Error(layoutError));
      return;
    }
    lock.current = true;
    setBusy(true);
    abort.current = new AbortController();
    try {
      const target = which ?? scope;
      const selected =
        target === 'current'
          ? [current]
          : target === 'all'
            ? view.pages.map((_, i) => i + 1)
            : parsePageRange(range, view.pages.length);
      await audit.mutateAsync({ kind, action: pdf ? 'pdf' : 'print', pages: selected.length });
      if (abort.current.signal.aborted) return;
      if (pdf) {
        if (!isDesktop())
          notify.info('请在系统打印对话框中选择“另存为 PDF”；浏览器不会返回文件路径');
        const path = await saveAsPdf(viewToPrintJob(view, selected));
        if (path) notify.success(`PDF 已保存：${path}`);
        else
          notify.info(
            isDesktop() ? '已取消 PDF 保存' : '打印对话框已关闭，文件是否保存以系统对话框为准',
          );
      } else {
        const result = await runPrintBatch(view, {
          pages: selected,
          copies: view.layout.copies,
          pause,
          duplex,
          confirm,
          signal: abort.current.signal,
        });
        notify.info(
          result.cancelled
            ? `已停止后续打印，已提交 ${result.sent.length} 页`
            : `已提交系统打印对话框 ${result.sent.length} 页，完成或取消请以系统结果为准`,
        );
      }
    } catch (e) {
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
  return (
    <section aria-label="打印预览">
      {layoutError && <Alert type="error" title={layoutError} />}
      {g.warning && <Alert type="warning" title={g.warning} />}
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
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          >
            {[25, 50, 75, 100, 125, 150].map((n) => (
              <option key={n} value={n}>
                {n}%
              </option>
            ))}
          </select>
        </label>
        <Button
          onClick={() =>
            setZoom(Math.min(100, Math.floor(((window.innerWidth - 340) / (g.width * 3.78)) * 100)))
          }
        >
          适合宽度
        </Button>
        <label>
          打印范围
          <select
            aria-label="打印范围"
            value={scope}
            disabled={busy}
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
            onChange={(e) => setRange(e.target.value)}
          />
        )}
        {kind === 'ledger' && (
          <label>
            <input
              type="checkbox"
              checked={duplex}
              disabled={busy}
              onChange={(e) => setDuplex(e.target.checked)}
            />
            奇偶页分次打印（手动翻面）
          </label>
        )}
        <Button disabled={busy || !!layoutError} onClick={() => void output(false)}>
          打印所选范围
        </Button>
        <Button disabled={busy || !!layoutError} onClick={() => void output(false, 'current')}>
          打印本页
        </Button>
        <Button disabled={busy || !!layoutError} onClick={() => void output(false, 'all')}>
          打印全部
        </Button>
        {canExport && (
          <Button disabled={busy || !!layoutError} onClick={() => void output(true)}>
            PDF
          </Button>
        )}
        {busy ? (
          <Button onClick={() => abort.current?.abort()}>取消后续打印</Button>
        ) : (
          <Button onClick={onClose}>关闭预览</Button>
        )}
      </Space>
      <div style={{ overflow: 'auto', background: '#d9dfe7', padding: 16, maxHeight: '70vh' }}>
        <div
          style={{
            width: (g.width * 3.78 * zoom) / 100,
            height: (g.height * 3.78 * zoom) / 100,
            margin: 'auto',
          }}
        >
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
            }}
          />
        </div>
      </div>
    </section>
  );
}
