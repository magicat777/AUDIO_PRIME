import { contextBridge, ipcRenderer } from 'electron';

// Type definitions for the exposed API
export interface AudioDevice {
  id: string;
  name: string;
  type: 'monitor' | 'input';
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
  },
} as ElectronAPI);

// Type declaration for window object
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
