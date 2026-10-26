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
  type DuplexResume,
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
    [pending, setPending] = useState<{
      view: PrintView;
      pages: number[];
      resume: DuplexResume;
    } | null>(null),
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
  const output = async (pdf: boolean, which?: 'current' | 'all', resume = false) => {
    if (lock.current) return;
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
            disabled={busy || !!pending}
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
              disabled={busy || !!pending}
              onChange={(e) => setDuplex(e.target.checked)}
            />
            奇偶页分次打印（手动翻面）
          </label>
        )}
        <Button disabled={busy || !!layoutError || !!pending} onClick={() => void output(false)}>
          打印所选范围
        </Button>
        <Button
          disabled={busy || !!layoutError || !!pending}
          onClick={() => void output(false, 'current')}
        >
          打印本页
        </Button>
        <Button
          disabled={busy || !!layoutError || !!pending}
          onClick={() => void output(false, 'all')}
        >
          打印全部
        </Button>
        {canExport && (
          <Button disabled={busy || !!layoutError || !!pending} onClick={() => void output(true)}>
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
