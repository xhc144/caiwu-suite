// 保持 @caiwu/print 的 DesktopBridge 兼容。新增能力放在桌面自有的可选命名空间。
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('caiwuDesktop', {
  print: (html: string, opts: { title: string; silent?: boolean }) =>
    ipcRenderer.invoke('caiwu:print', html, opts),
  printToPdf: (html: string, opts: { title: string; landscape?: boolean }) =>
    ipcRenderer.invoke('caiwu:printToPdf', html, opts),
});

contextBridge.exposeInMainWorld('caiwuDesktopHost', {
  updates: {
    status: () => ipcRenderer.invoke('caiwu:host:updateStatus'),
    check: () => ipcRenderer.invoke('caiwu:host:checkUpdate'),
    download: () => ipcRenderer.invoke('caiwu:host:downloadUpdate'),
    install: () => ipcRenderer.invoke('caiwu:host:installUpdate'),
  },
  dataDirectory: {
    get: () => ipcRenderer.invoke('caiwu:host:dataDir'),
    choose: () => ipcRenderer.invoke('caiwu:host:chooseDataDir'),
  },
  files: {
    open: () => ipcRenderer.invoke('caiwu:host:openFile'),
    save: (defaultName: string) => ipcRenderer.invoke('caiwu:host:saveFile', defaultName),
    directory: () => ipcRenderer.invoke('caiwu:host:chooseDirectory'),
  },
});
