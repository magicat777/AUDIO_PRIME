// Global type declarations for AUDIO_PRIME

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
  system: {
    getMetrics: () => Promise<SystemMetrics>;
    getAudioInfo: () => Promise<AudioSourceInfo>;
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

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
