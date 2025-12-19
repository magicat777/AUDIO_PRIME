import { contextBridge, ipcRenderer } from 'electron';

// Type definitions for the exposed API
export interface AudioDevice {
  id: string;
  name: string;
  type: 'monitor' | 'input';
}

export interface ElectronAPI {
  audio: {
    getDevices: () => Promise<AudioDevice[]>;
    start: (deviceId: string) => Promise<boolean>;
    stop: () => Promise<boolean>;
    onData: (callback: (samples: number[]) => void) => () => void;
  };
  window: {
    toggleFullscreen: () => Promise<boolean>;
  };
}

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  audio: {
    getDevices: () => ipcRenderer.invoke('audio:devices'),
    start: (deviceId: string) => ipcRenderer.invoke('audio:start', deviceId),
    stop: () => ipcRenderer.invoke('audio:stop'),
    onData: (callback: (samples: number[]) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, samples: number[]) => {
        callback(samples);
      };
      ipcRenderer.on('audio:data', listener);
      // Return cleanup function
      return () => {
        ipcRenderer.removeListener('audio:data', listener);
      };
    },
  },
  window: {
    toggleFullscreen: () => ipcRenderer.invoke('window:fullscreen'),
  },
} as ElectronAPI);

// Type declaration for window object
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
