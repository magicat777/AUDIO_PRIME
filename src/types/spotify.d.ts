/**
 * Spotify Web API Type Definitions
 */

export interface SpotifyAuthStatus {
  connected: boolean;
  user?: SpotifyUser;
  expiresAt?: number;
}

export interface SpotifyUser {
  id: string;
  displayName: string;
  email?: string;
  imageUrl?: string;
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
  isPlaying: boolean;
  uri: string;
}

export interface SpotifyAudioFeatures {
  tempo: number;           // BPM (0-250)
  key: number;             // Pitch class (0-11, -1 if unknown)
  mode: number;            // 0 = minor, 1 = major
  energy: number;          // 0.0-1.0
  danceability: number;    // 0.0-1.0
  valence: number;         // 0.0-1.0 (musical positivity/mood)
  acousticness: number;    // 0.0-1.0
  instrumentalness: number; // 0.0-1.0
  liveness: number;        // 0.0-1.0
  speechiness: number;     // 0.0-1.0
  loudness: number;        // dB (-60 to 0)
  timeSignature: number;   // beats per bar (3-7)
}

export interface SpotifyNowPlaying {
  track: SpotifyTrack | null;
  audioFeatures: SpotifyAudioFeatures | null;
}

// API Response types
export interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
}

export interface SpotifyCurrentlyPlayingResponse {
  is_playing: boolean;
  progress_ms: number;
  item: {
    id: string;
    name: string;
    artists: Array<{ name: string }>;
    album: {
      name: string;
      images: Array<{ url: string; width: number; height: number }>;
    };
    duration_ms: number;
    uri: string;
  } | null;
}

export interface SpotifyAudioFeaturesResponse {
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
  time_signature: number;
}

export interface SpotifyUserResponse {
  id: string;
  display_name: string;
  email?: string;
  images?: Array<{ url: string }>;
}

// Key name mapping
export const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export function getKeyName(key: number, mode: number): string {
  if (key < 0 || key > 11) return 'Unknown';
  const keyName = KEY_NAMES[key];
  const modeName = mode === 1 ? 'major' : 'minor';
  return `${keyName} ${modeName}`;
}
