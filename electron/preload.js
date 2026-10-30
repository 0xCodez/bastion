'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

function subscribe(channel) {
  return (cb) => {
    const listener = (_event, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld('bastion', {
  platform: process.platform,
  version: process.env.npm_package_version || '0.1.0',

  network: {
    overview: invoke('network:overview'),
    devices: invoke('network:devices'),
    connections: invoke('network:connections'),
    scan: invoke('network:scan'),
    onScanProgress: subscribe('network:scan-progress'),
  },
  wifi: {
    info: invoke('wifi:info'),
    survey: invoke('wifi:survey'),
  },
  dns: {
    status: invoke('dns:status'),
  },
  speed: {
    run: invoke('speed:run'),
    cancel: invoke('speed:cancel'),
    onProgress: subscribe('speed:progress'),
  },
  fix: {
    open: invoke('fix:open'),
  },
  app: {
    openExternal: invoke('app:open-external'),
  },
  agents: {
    providers: invoke('agents:providers'),
    setKey: invoke('agents:set-key'),
    clearKey: invoke('agents:clear-key'),
    setModel: invoke('agents:set-model'),
    test: invoke('agents:test'),
    ask: invoke('agents:ask'),
  },
});
