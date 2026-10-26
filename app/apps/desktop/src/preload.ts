// 只向页面暴露打印相关的最小接口（见 @caiwu/print 的 DesktopBridge）。页面拿不到 Node 和 Electron 的其它能力。
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('caiwuDesktop', {
  print: (html: string, opts: { title: string; silent?: boolean }) =>
    ipcRenderer.invoke('caiwu:print', html, opts),
  printToPdf: (html: string, opts: { title: string; landscape?: boolean }) =>
    ipcRenderer.invoke('caiwu:printToPdf', html, opts),
});
