import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('cosmos', {
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (value: unknown) => ipcRenderer.invoke('settings:save', value),
  log: (level: string, message: string) => ipcRenderer.send('log', level, message),
  setOffline: (value: boolean) => ipcRenderer.send('offline', value),
  fetchJson: (url: string) => ipcRenderer.invoke('net:json', url),
  toggleFullscreen: () => ipcRenderer.invoke('fullscreen:toggle'),
  setResolution: (w: number, h: number) => ipcRenderer.invoke('resolution:set', w, h),
  info: () => ipcRenderer.invoke('app:info'),
  cacheSize: () => ipcRenderer.invoke('cache:size'),
  clearCache: () => ipcRenderer.invoke('cache:clear'),
  openLogs: () => ipcRenderer.invoke('logs:open'),
  allowCamera: (v: boolean) => ipcRenderer.invoke('camera:allow', v),
  openLink: (url: string) => ipcRenderer.invoke('link:open', url),
});
