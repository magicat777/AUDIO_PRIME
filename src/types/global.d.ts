// Global type declarations for AUDIO_PRIME

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

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
