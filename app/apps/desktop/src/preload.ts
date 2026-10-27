// 保持 @caiwu/print 的 DesktopBridge 兼容。新增能力放在桌面自有的可选命名空间。
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('caiwuDesktop', {
  print: (html: string, opts: { title: string; silent?: boolean }) =>
    ipcRenderer.invoke('caiwu:print', html, opts),
  printToPdf: (html: string, opts: { title: string; landscape?: boolean }) =>
    ipcRenderer.invoke('caiwu:printToPdf', html, opts),
});

let closeHandler: ((id: string) => void) | undefined;
ipcRenderer.on('caiwu:host:closeRequest', (_event, id: string) => {
  if (closeHandler) closeHandler(id);
  else ipcRenderer.send('caiwu:host:closeResponse', id, true);
});
contextBridge.exposeInMainWorld('caiwuDesktopHost', {
  closing: {
    onRequest: (handler: (id: string) => void) => {
      closeHandler = handler;
      return () => {
        if (closeHandler === handler) closeHandler = undefined;
      };
    },
    respond: (id: string, allowed: boolean) =>
      ipcRenderer.send('caiwu:host:closeResponse', id, allowed === true),
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
