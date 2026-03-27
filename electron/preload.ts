import { contextBridge, ipcRenderer } from 'electron';

// Type definitions for the exposed API
export interface AudioDevice {
  id: string;
  name: string;
  description: string;
  type: 'monitor' | 'input';
  sampleRate: number;
  channels: number;
  format: string;
  state: 'running' | 'idle' | 'suspended';
}

export interface SpotifyStatus {
  connected: boolean;
  expiresAt?: number;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  artist: string;
  artists: string[];
  album: string;
  albumArt: string | null;
  albumArtLarge: string | null;
  durationMs: number;
  progressMs: number;
  uri: string;
}

export interface SpotifyNowPlaying {
  playing: boolean;
  track: SpotifyTrack | null;
  error?: string;
}

export interface SpotifyAudioFeatures {
  tempo: number;
  key: number;
  mode: number;
  energy: number;
  danceability: number;
  valence: number;
  acousticness: number;
  instrumentalness: number;
  liveness: number;
  speechiness: number;
  loudness: number;
  timeSignature: number;
  error?: string;
}

export interface SystemMetrics {
  cpuPercent: number;
  gpuPercent: number;
}

export interface AudioSourceInfo {
  sampleRate: number;
  bitDepth: number;
  channels: number;
  format: string;
  applicationName: string;
  latencyMs: number;
  available: boolean;
}

export interface LayoutSaveResult {
  success: boolean;
  path?: string;
  error?: string;
}

export interface LayoutLoadResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface VisibilitySaveResult {
  success: boolean;
  path?: string;
  error?: string;
}

export interface VisibilityLoadResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface ElectronAPI {
  audio: {
    getDevices: () => Promise<AudioDevice[]>;
    start: (deviceId: string) => Promise<boolean>;
    stop: () => Promise<boolean>;
    getSampleRate: () => Promise<number>;
    onData: (callback: (samples: Float32Array) => void) => () => void;
  };
  window: {
    toggleFullscreen: () => Promise<boolean>;
    quit: () => Promise<void>;
    onFullscreenChange: (callback: (isFullscreen: boolean) => void) => () => void;
    onBeforeQuit: (callback: () => void) => () => void;
  };
  system: {
    getMetrics: () => Promise<SystemMetrics>;
    getAudioInfo: () => Promise<AudioSourceInfo>;
  };
  layout: {
    save: (data: unknown) => Promise<LayoutSaveResult>;
    load: () => Promise<LayoutLoadResult>;
  };
  visibility: {
    save: (data: unknown) => Promise<VisibilitySaveResult>;
    load: () => Promise<VisibilityLoadResult>;
  };
  presets: {
    exportPreset: (data: unknown) => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>;
    importPreset: () => Promise<{ success: boolean; data?: unknown; canceled?: boolean; error?: string }>;
  };
  settings: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
  };
  mpris: {
    getPlayers: () => Promise<{ name: string; identity: string }[]>;
    getNowPlaying: () => Promise<unknown>;
    command: (cmd: string) => Promise<boolean>;
    seek: (positionUs: number) => Promise<boolean>;
    shuffle: (enabled: boolean) => Promise<boolean>;
    loop: (status: string) => Promise<boolean>;
    setPlayer: (serviceName: string) => Promise<boolean>;
    getArt: (fileUrl: string) => Promise<string>;
  };
  spotify: {
    connect: () => Promise<{ success: boolean; error?: string }>;
    disconnect: () => Promise<{ success: boolean }>;
    getStatus: () => Promise<SpotifyStatus>;
    getNowPlaying: () => Promise<SpotifyNowPlaying>;
    getAudioFeatures: (trackId: string) => Promise<SpotifyAudioFeatures>;
    onAuthUpdate: (callback: (status: { connected: boolean }) => void) => () => void;
    // Playback controls
    play: () => Promise<{ success: boolean; error?: string }>;
    pause: () => Promise<{ success: boolean; error?: string }>;
    next: () => Promise<{ success: boolean; error?: string }>;
    previous: () => Promise<{ success: boolean; error?: string }>;
    seek: (positionMs: number) => Promise<{ success: boolean; error?: string }>;
    shuffle: (state: boolean) => Promise<{ success: boolean; error?: string }>;
    repeat: (state: 'off' | 'track' | 'context') => Promise<{ success: boolean; error?: string }>;
    // Configuration
    getConfig: () => Promise<{
      configured: boolean;
      hasClientId: boolean;
      hasClientSecret: boolean;
      clientIdPreview: string;
    }>;
    saveConfig: (credentials: { clientId: string; clientSecret: string }) => Promise<{
      success: boolean;
      configured?: boolean;
      error?: string;
    }>;
  };
}

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  audio: {
    getDevices: () => ipcRenderer.invoke('audio:devices'),
    start: (deviceId: string) => ipcRenderer.invoke('audio:start', deviceId),
    stop: () => ipcRenderer.invoke('audio:stop'),
    getSampleRate: () => ipcRenderer.invoke('audio:sample-rate'),
    onData: (callback: (samples: Float32Array) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, buffer: ArrayBuffer) => {
        callback(new Float32Array(buffer));
      };
      ipcRenderer.on('audio:data', listener);
      return () => {
        ipcRenderer.removeListener('audio:data', listener);
      };
    },
  },
  window: {
    toggleFullscreen: () => ipcRenderer.invoke('window:fullscreen'),
    quit: () => ipcRenderer.invoke('window:quit'),
    onFullscreenChange: (callback: (isFullscreen: boolean) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, isFullscreen: boolean) => {
        callback(isFullscreen);
      };
      ipcRenderer.on('window:fullscreen-change', listener);
      return () => {
        ipcRenderer.removeListener('window:fullscreen-change', listener);
      };
    },
    onBeforeQuit: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('app:before-quit', listener);
      return () => {
        ipcRenderer.removeListener('app:before-quit', listener);
      };
    },
  },
  system: {
    getMetrics: () => ipcRenderer.invoke('system:metrics'),
    getAudioInfo: () => ipcRenderer.invoke('system:audio-info'),
  },
  layout: {
    save: (data: unknown) => ipcRenderer.invoke('layout:save', data),
    load: () => ipcRenderer.invoke('layout:load'),
  },
  visibility: {
    save: (data: unknown) => ipcRenderer.invoke('visibility:save', data),
    load: () => ipcRenderer.invoke('visibility:load'),
  },
  presets: {
    exportPreset: (data: unknown) => ipcRenderer.invoke('preset:export', data),
    importPreset: () => ipcRenderer.invoke('preset:import'),
  },
  mpris: {
    getPlayers: () => ipcRenderer.invoke('mpris:players'),
    getNowPlaying: () => ipcRenderer.invoke('mpris:now-playing'),
    command: (cmd: string) => ipcRenderer.invoke('mpris:command', cmd),
    seek: (positionUs: number) => ipcRenderer.invoke('mpris:seek', positionUs),
    shuffle: (enabled: boolean) => ipcRenderer.invoke('mpris:shuffle', enabled),
    loop: (status: string) => ipcRenderer.invoke('mpris:loop', status),
    setPlayer: (serviceName: string) => ipcRenderer.invoke('mpris:set-player', serviceName),
    getArt: (fileUrl: string) => ipcRenderer.invoke('mpris:art', fileUrl),
  },
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
  },
  spotify: {
    connect: () => ipcRenderer.invoke('spotify:connect'),
    disconnect: () => ipcRenderer.invoke('spotify:disconnect'),
    getStatus: () => ipcRenderer.invoke('spotify:status'),
    getNowPlaying: () => ipcRenderer.invoke('spotify:now-playing'),
    getAudioFeatures: (trackId: string) => ipcRenderer.invoke('spotify:audio-features', trackId),
    onAuthUpdate: (callback: (status: { connected: boolean }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: { connected: boolean }) => {
        callback(status);
      };
      ipcRenderer.on('spotify:auth-update', listener);
      return () => {
        ipcRenderer.removeListener('spotify:auth-update', listener);
      };
    },
    // Playback controls
    play: () => ipcRenderer.invoke('spotify:play'),
    pause: () => ipcRenderer.invoke('spotify:pause'),
    next: () => ipcRenderer.invoke('spotify:next'),
    previous: () => ipcRenderer.invoke('spotify:previous'),
    seek: (positionMs: number) => ipcRenderer.invoke('spotify:seek', positionMs),
    shuffle: (state: boolean) => ipcRenderer.invoke('spotify:shuffle', state),
    repeat: (state: 'off' | 'track' | 'context') => ipcRenderer.invoke('spotify:repeat', state),
    // Configuration
    getConfig: () => ipcRenderer.invoke('spotify:get-config'),
    saveConfig: (credentials: { clientId: string; clientSecret: string }) =>
      ipcRenderer.invoke('spotify:save-config', credentials),
  },
} as ElectronAPI);

// Type declaration for window object
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
