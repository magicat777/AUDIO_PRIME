/**
 * SpotifyService - Manages Spotify Web API integration
 * Handles OAuth, polling for now-playing, and audio features
 */

import { writable, get } from 'svelte/store';

// Key name mapping for audio features
const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function getKeyName(key: number, mode: number): string {
  if (key < 0 || key > 11) return '---';
  const keyName = KEY_NAMES[key];
  const modeName = mode === 1 ? 'maj' : 'min';
  return `${keyName}${modeName}`;
}

// Types
export interface SpotifyAuthStatus {
  connected: boolean;
  connecting: boolean;
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
  isPlaying: boolean;
  track: SpotifyTrack | null;
}

export interface SpotifyAudioFeatures {
  tempo: number;
  key: number;
  mode: number;
  keyName: string;
  energy: number;
  danceability: number;
  valence: number;
  acousticness: number;
  instrumentalness: number;
  liveness: number;
  speechiness: number;
  loudness: number;
  timeSignature: number;
}

const defaultNowPlaying: SpotifyNowPlaying = {
  isPlaying: false,
  track: null,
};

const defaultAudioFeatures: SpotifyAudioFeatures = {
  tempo: 0,
  key: -1,
  mode: 0,
  keyName: '---',
  energy: 0,
  danceability: 0,
  valence: 0,
  acousticness: 0,
  instrumentalness: 0,
  liveness: 0,
  speechiness: 0,
  loudness: -60,
  timeSignature: 4,
};

class SpotifyServiceClass {
  // Stores
  public authStatus = writable<SpotifyAuthStatus>({ connected: false, connecting: false });
  public nowPlaying = writable<SpotifyNowPlaying>(defaultNowPlaying);
  public audioFeatures = writable<SpotifyAudioFeatures>(defaultAudioFeatures);

  // Internal state
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private lastTrackId: string | null = null;
  private cleanupAuthListener: (() => void) | null = null;

  // Polling configuration
  private readonly POLL_INTERVAL = 2000; // 2 seconds

  constructor() {
    // Bind methods
    this.connect = this.connect.bind(this);
    this.disconnect = this.disconnect.bind(this);
    this.startPolling = this.startPolling.bind(this);
    this.stopPolling = this.stopPolling.bind(this);
  }

  /**
   * Initialize the service - check auth status and start polling if connected
   */
  async initialize(): Promise<void> {
    // Set up auth update listener
    this.cleanupAuthListener = window.electronAPI.spotify.onAuthUpdate((status) => {
      this.authStatus.set({ connected: status.connected, connecting: false });
      if (status.connected) {
        this.startPolling();
      } else {
        this.stopPolling();
        this.nowPlaying.set(defaultNowPlaying);
        this.audioFeatures.set(defaultAudioFeatures);
      }
    });

    // Check initial status
    try {
      const status = await window.electronAPI.spotify.getStatus();
      this.authStatus.set({ connected: status.connected, connecting: false });
      if (status.connected) {
        this.startPolling();
      }
    } catch (error) {
      console.error('Error checking Spotify status:', error);
    }
  }

  /**
   * Connect to Spotify (initiate OAuth flow)
   */
  async connect(): Promise<void> {
    this.authStatus.update(s => ({ ...s, connecting: true }));
    try {
      const result = await window.electronAPI.spotify.connect();
      if (!result.success) {
        this.authStatus.update(s => ({ ...s, connecting: false }));
        console.error('Spotify connect failed:', result.error);
      }
      // Auth status will be updated via the auth listener when OAuth completes
    } catch (error) {
      this.authStatus.update(s => ({ ...s, connecting: false }));
      console.error('Error connecting to Spotify:', error);
    }
  }

  /**
   * Disconnect from Spotify
   */
  async disconnect(): Promise<void> {
    try {
      await window.electronAPI.spotify.disconnect();
      this.authStatus.set({ connected: false, connecting: false });
      this.stopPolling();
      this.nowPlaying.set(defaultNowPlaying);
      this.audioFeatures.set(defaultAudioFeatures);
      this.lastTrackId = null;
    } catch (error) {
      console.error('Error disconnecting from Spotify:', error);
    }
  }

  /**
   * Start polling for now-playing data
   */
  startPolling(): void {
    if (this.pollingInterval) return;

    // Poll immediately
    this.pollNowPlaying();

    // Then poll at interval
    this.pollingInterval = setInterval(() => {
      this.pollNowPlaying();
    }, this.POLL_INTERVAL);

    console.log('Started Spotify polling');
  }

  /**
   * Stop polling
   */
  stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      console.log('Stopped Spotify polling');
    }
  }

  /**
   * Poll for now-playing track
   */
  private async pollNowPlaying(): Promise<void> {
    try {
      const data = await window.electronAPI.spotify.getNowPlaying();

      if (data.error) {
        console.error('Error fetching now playing:', data.error);
        return;
      }

      const newNowPlaying: SpotifyNowPlaying = {
        isPlaying: data.playing,
        track: data.track,
      };

      this.nowPlaying.set(newNowPlaying);

      // Fetch audio features if track changed
      if (data.track && data.track.id !== this.lastTrackId) {
        this.lastTrackId = data.track.id;
        this.fetchAudioFeatures(data.track.id);
      } else if (!data.track) {
        this.lastTrackId = null;
        this.audioFeatures.set(defaultAudioFeatures);
      }
    } catch (error) {
      console.error('Error polling now playing:', error);
    }
  }

  // Track if we've already warned about audio features being unavailable
  private audioFeaturesUnavailable = false;

  /**
   * Fetch audio features for a track
   */
  private async fetchAudioFeatures(trackId: string): Promise<void> {
    // Skip if we know the API is restricted
    if (this.audioFeaturesUnavailable) return;

    try {
      const data = await window.electronAPI.spotify.getAudioFeatures(trackId);

      if (data.error) {
        // Only warn once about API restriction
        if (data.error.includes('restricted') || data.error.includes('403')) {
          if (!this.audioFeaturesUnavailable) {
            console.warn('Spotify audio features API is restricted (deprecated Nov 2024)');
            this.audioFeaturesUnavailable = true;
          }
        } else {
          console.warn('Audio features unavailable:', data.error);
        }
        return;
      }

      const features: SpotifyAudioFeatures = {
        tempo: data.tempo,
        key: data.key,
        mode: data.mode,
        keyName: getKeyName(data.key, data.mode),
        energy: data.energy,
        danceability: data.danceability,
        valence: data.valence,
        acousticness: data.acousticness,
        instrumentalness: data.instrumentalness,
        liveness: data.liveness,
        speechiness: data.speechiness,
        loudness: data.loudness,
        timeSignature: data.timeSignature,
      };

      this.audioFeatures.set(features);
    } catch (error) {
      console.warn('Error fetching audio features:', error);
    }
  }

  /**
   * Format duration from milliseconds to MM:SS
   */
  formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  // ============================================
  // Playback Control Methods
  // ============================================

  /**
   * Play/Resume playback
   */
  async play(): Promise<boolean> {
    try {
      const result = await window.electronAPI.spotify.play();
      if (result.success) {
        this.pollNowPlaying();
      }
      return result.success;
    } catch (error) {
      console.error('Error playing:', error);
      return false;
    }
  }

  /**
   * Pause playback
   */
  async pause(): Promise<boolean> {
    try {
      const result = await window.electronAPI.spotify.pause();
      if (result.success) {
        this.pollNowPlaying();
      }
      return result.success;
    } catch (error) {
      console.error('Error pausing:', error);
      return false;
    }
  }

  /**
   * Toggle play/pause
   */
  async togglePlayPause(): Promise<boolean> {
    const current = get(this.nowPlaying);
    if (current.isPlaying) {
      return this.pause();
    } else {
      return this.play();
    }
  }

  /**
   * Skip to next track
   */
  async next(): Promise<boolean> {
    try {
      const result = await window.electronAPI.spotify.next();
      if (result.success) {
        setTimeout(() => this.pollNowPlaying(), 300);
      }
      return result.success;
    } catch (error) {
      console.error('Error skipping to next:', error);
      return false;
    }
  }

  /**
   * Go to previous track
   */
  async previous(): Promise<boolean> {
    try {
      const result = await window.electronAPI.spotify.previous();
      if (result.success) {
        setTimeout(() => this.pollNowPlaying(), 300);
      }
      return result.success;
    } catch (error) {
      console.error('Error going to previous:', error);
      return false;
    }
  }

  /**
   * Seek to position in track
   */
  async seek(positionMs: number): Promise<boolean> {
    try {
      const result = await window.electronAPI.spotify.seek(positionMs);
      if (result.success) {
        this.pollNowPlaying();
      }
      return result.success;
    } catch (error) {
      console.error('Error seeking:', error);
      return false;
    }
  }

  /**
   * Toggle shuffle
   */
  async shuffle(state: boolean): Promise<boolean> {
    try {
      const result = await window.electronAPI.spotify.shuffle(state);
      return result.success;
    } catch (error) {
      console.error('Error toggling shuffle:', error);
      return false;
    }
  }

  /**
   * Set repeat mode
   */
  async repeat(state: 'off' | 'track' | 'context'): Promise<boolean> {
    try {
      const result = await window.electronAPI.spotify.repeat(state);
      return result.success;
    } catch (error) {
      console.error('Error setting repeat:', error);
      return false;
    }
  }

  /**
   * Get current now playing state
   */
  getNowPlaying(): SpotifyNowPlaying {
    return get(this.nowPlaying);
  }

  /**
   * Get current audio features
   */
  getAudioFeatures(): SpotifyAudioFeatures {
    return get(this.audioFeatures);
  }

  /**
   * Get auth status
   */
  getAuthStatus(): SpotifyAuthStatus {
    return get(this.authStatus);
  }

  /**
   * Cleanup on destroy
   */
  destroy(): void {
    this.stopPolling();
    if (this.cleanupAuthListener) {
      this.cleanupAuthListener();
      this.cleanupAuthListener = null;
    }
  }
}

// Export singleton instance
export const spotifyService = new SpotifyServiceClass();
