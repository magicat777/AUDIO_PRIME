/**
 * MPRIS2 D-Bus Media Player Service
 *
 * Queries any MPRIS2-compatible media player (Strawberry, mpv, VLC, Firefox, etc.)
 * via D-Bus for now-playing metadata, playback status, and controls.
 *
 * Uses dbus-send CLI since it's universally available on Linux without
 * native Node.js D-Bus bindings.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface MprisPlayerInfo {
  name: string;       // D-Bus service name (e.g., "org.mpris.MediaPlayer2.strawberry")
  identity: string;   // Human-readable name (e.g., "Strawberry")
}

export interface MprisNowPlaying {
  available: boolean;
  playerName: string;
  status: 'Playing' | 'Paused' | 'Stopped' | 'Unknown';
  title: string;
  artist: string;
  album: string;
  artUrl: string;
  durationMs: number;
  positionMs: number;
  bitrate: number;       // kbps (Strawberry provides this)
  fileUrl: string;       // File path for local media
  year: number;
  trackNumber: number;
  shuffle: boolean;
  loopStatus: string;    // "None", "Track", "Playlist"
  volume: number;        // 0.0 - 1.0
}

const DEFAULT_NOW_PLAYING: MprisNowPlaying = {
  available: false,
  playerName: '',
  status: 'Unknown',
  title: '',
  artist: '',
  album: '',
  artUrl: '',
  durationMs: 0,
  positionMs: 0,
  bitrate: 0,
  fileUrl: '',
  year: 0,
  trackNumber: 0,
  shuffle: false,
  loopStatus: 'None',
  volume: 1,
};

// Cache to avoid excessive D-Bus calls
let cachedPlayers: MprisPlayerInfo[] = [];
let cachedNowPlaying: MprisNowPlaying = { ...DEFAULT_NOW_PLAYING };
let activePlayerService: string | null = null;
let lastPlayerScan = 0;
let lastNowPlayingFetch = 0;
const PLAYER_SCAN_INTERVAL_MS = 5000;
const NOW_PLAYING_CACHE_MS = 500;

/**
 * Parse D-Bus variant output into a simple key-value map.
 * Handles the verbose dbus-send --print-reply format.
 */
function parseDbusProperties(output: string): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  const lines = output.split('\n');

  let currentKey = '';
  for (const line of lines) {
    const trimmed = line.trim();

    // Match dict entry key: string "xesam:title"
    const keyMatch = trimmed.match(/^string "([^"]+)"/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      continue;
    }

    if (!currentKey) continue;

    // Match variant values
    const stringMatch = trimmed.match(/variant\s+string "([^"]*)"/);
    if (stringMatch) {
      result[currentKey] = stringMatch[1];
      currentKey = '';
      continue;
    }

    const int64Match = trimmed.match(/variant\s+int64 (-?\d+)/);
    if (int64Match) {
      result[currentKey] = parseInt(int64Match[1], 10);
      currentKey = '';
      continue;
    }

    const int32Match = trimmed.match(/variant\s+int32 (-?\d+)/);
    if (int32Match) {
      result[currentKey] = parseInt(int32Match[1], 10);
      currentKey = '';
      continue;
    }

    const doubleMatch = trimmed.match(/variant\s+double ([\d.e+-]+)/);
    if (doubleMatch) {
      result[currentKey] = parseFloat(doubleMatch[1]);
      currentKey = '';
      continue;
    }

    const boolMatch = trimmed.match(/variant\s+boolean (true|false)/);
    if (boolMatch) {
      result[currentKey] = boolMatch[1] === 'true';
      currentKey = '';
      continue;
    }

    // Array of strings (e.g., xesam:artist) — take first value
    const arrayStringMatch = trimmed.match(/^\s*string "([^"]*)"/);
    if (arrayStringMatch && currentKey) {
      if (!result[currentKey]) {
        result[currentKey] = arrayStringMatch[1];
      }
      continue;
    }
  }

  return result;
}

/**
 * Scan D-Bus for available MPRIS2 players
 */
export async function scanPlayers(): Promise<MprisPlayerInfo[]> {
  const now = Date.now();
  if (now - lastPlayerScan < PLAYER_SCAN_INTERVAL_MS && cachedPlayers.length > 0) {
    return cachedPlayers;
  }

  try {
    const { stdout } = await execAsync(
      'dbus-send --session --dest=org.freedesktop.DBus --type=method_call --print-reply ' +
      '/org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>/dev/null'
    );

    const players: MprisPlayerInfo[] = [];
    const matches = stdout.matchAll(/"(org\.mpris\.MediaPlayer2\.[^"]+)"/g);

    for (const match of matches) {
      const service = match[1];
      // Extract player name from service (e.g., "org.mpris.MediaPlayer2.strawberry" -> "Strawberry")
      const shortName = service.split('.').pop() || service;
      const identity = shortName.charAt(0).toUpperCase() + shortName.slice(1);
      players.push({ name: service, identity });
    }

    cachedPlayers = players;
    lastPlayerScan = now;

    // Auto-select first available player if none active
    if (!activePlayerService && players.length > 0) {
      // Prefer Strawberry, then any other player
      const preferred = players.find(p => p.name.includes('strawberry'));
      activePlayerService = preferred?.name || players[0].name;
    }

    return players;
  } catch {
    return cachedPlayers;
  }
}

/**
 * Get now-playing info from the active MPRIS2 player
 */
export async function getNowPlaying(): Promise<MprisNowPlaying> {
  const now = Date.now();
  if (now - lastNowPlayingFetch < NOW_PLAYING_CACHE_MS) {
    return cachedNowPlaying;
  }

  // Ensure we have a player
  if (!activePlayerService) {
    await scanPlayers();
  }

  if (!activePlayerService) {
    cachedNowPlaying = { ...DEFAULT_NOW_PLAYING };
    lastNowPlayingFetch = now;
    return cachedNowPlaying;
  }

  try {
    // Query metadata and player properties in parallel
    const [metadataResult, statusResult, positionResult, shuffleResult, loopResult, volumeResult] = await Promise.all([
      execAsync(
        `dbus-send --print-reply --dest=${activePlayerService} /org/mpris/MediaPlayer2 ` +
        `org.freedesktop.DBus.Properties.Get string:'org.mpris.MediaPlayer2.Player' string:'Metadata' 2>/dev/null`
      ).catch(() => ({ stdout: '' })),
      execAsync(
        `dbus-send --print-reply --dest=${activePlayerService} /org/mpris/MediaPlayer2 ` +
        `org.freedesktop.DBus.Properties.Get string:'org.mpris.MediaPlayer2.Player' string:'PlaybackStatus' 2>/dev/null`
      ).catch(() => ({ stdout: '' })),
      execAsync(
        `dbus-send --print-reply --dest=${activePlayerService} /org/mpris/MediaPlayer2 ` +
        `org.freedesktop.DBus.Properties.Get string:'org.mpris.MediaPlayer2.Player' string:'Position' 2>/dev/null`
      ).catch(() => ({ stdout: '' })),
      execAsync(
        `dbus-send --print-reply --dest=${activePlayerService} /org/mpris/MediaPlayer2 ` +
        `org.freedesktop.DBus.Properties.Get string:'org.mpris.MediaPlayer2.Player' string:'Shuffle' 2>/dev/null`
      ).catch(() => ({ stdout: '' })),
      execAsync(
        `dbus-send --print-reply --dest=${activePlayerService} /org/mpris/MediaPlayer2 ` +
        `org.freedesktop.DBus.Properties.Get string:'org.mpris.MediaPlayer2.Player' string:'LoopStatus' 2>/dev/null`
      ).catch(() => ({ stdout: '' })),
      execAsync(
        `dbus-send --print-reply --dest=${activePlayerService} /org/mpris/MediaPlayer2 ` +
        `org.freedesktop.DBus.Properties.Get string:'org.mpris.MediaPlayer2.Player' string:'Volume' 2>/dev/null`
      ).catch(() => ({ stdout: '' })),
    ]);

    const metadata = parseDbusProperties(metadataResult.stdout);

    // Parse status
    const statusMatch = statusResult.stdout.match(/string "(Playing|Paused|Stopped)"/);
    const status = (statusMatch?.[1] as MprisNowPlaying['status']) || 'Unknown';

    // Parse position (microseconds → ms)
    const posMatch = positionResult.stdout.match(/int64 (\d+)/);
    const positionMs = posMatch ? parseInt(posMatch[1], 10) / 1000 : 0;

    // Parse shuffle
    const shuffleMatch = shuffleResult.stdout.match(/boolean (true|false)/);
    const shuffle = shuffleMatch?.[1] === 'true';

    // Parse loop status
    const loopMatch = loopResult.stdout.match(/string "(None|Track|Playlist)"/);
    const loopStatus = loopMatch?.[1] || 'None';

    // Parse volume
    const volMatch = volumeResult.stdout.match(/double ([\d.e+-]+)/);
    const volume = volMatch ? parseFloat(volMatch[1]) : 1;

    // Extract player identity from service name
    const shortName = activePlayerService.split('.').pop() || '';
    const playerName = shortName.charAt(0).toUpperCase() + shortName.slice(1);

    cachedNowPlaying = {
      available: true,
      playerName,
      status,
      title: String(metadata['xesam:title'] || ''),
      artist: String(metadata['xesam:artist'] || ''),
      album: String(metadata['xesam:album'] || ''),
      artUrl: String(metadata['mpris:artUrl'] || ''),
      durationMs: typeof metadata['mpris:length'] === 'number' ? metadata['mpris:length'] / 1000 : 0,
      positionMs,
      bitrate: typeof metadata['bitrate'] === 'number' ? metadata['bitrate'] : 0,
      fileUrl: String(metadata['xesam:url'] || ''),
      year: typeof metadata['year'] === 'number' ? metadata['year'] : 0,
      trackNumber: typeof metadata['xesam:trackNumber'] === 'number' ? metadata['xesam:trackNumber'] : 0,
      shuffle,
      loopStatus,
      volume,
    };

    lastNowPlayingFetch = now;
    return cachedNowPlaying;
  } catch (error) {
    console.error('MPRIS2 query error:', error);
    // Player may have quit — clear selection
    activePlayerService = null;
    cachedNowPlaying = { ...DEFAULT_NOW_PLAYING };
    lastNowPlayingFetch = now;
    return cachedNowPlaying;
  }
}

/**
 * Send a playback control command
 */
export async function sendCommand(command: 'Play' | 'Pause' | 'PlayPause' | 'Next' | 'Previous' | 'Stop'): Promise<boolean> {
  if (!activePlayerService) return false;
  try {
    await execAsync(
      `dbus-send --print-reply --dest=${activePlayerService} /org/mpris/MediaPlayer2 ` +
      `org.mpris.MediaPlayer2.Player.${command} 2>/dev/null`
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Seek to position (microseconds)
 */
export async function seekTo(positionUs: number): Promise<boolean> {
  if (!activePlayerService) return false;
  try {
    // Need the track ID for SetPosition
    const np = await getNowPlaying();
    const trackId = `/org/strawberrymusicplayer/strawberry/Track/0`; // fallback
    await execAsync(
      `dbus-send --print-reply --dest=${activePlayerService} /org/mpris/MediaPlayer2 ` +
      `org.mpris.MediaPlayer2.Player.SetPosition objpath:${trackId} int64:${Math.floor(positionUs)} 2>/dev/null`
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Set shuffle state
 */
export async function setShuffle(enabled: boolean): Promise<boolean> {
  if (!activePlayerService) return false;
  try {
    await execAsync(
      `dbus-send --print-reply --dest=${activePlayerService} /org/mpris/MediaPlayer2 ` +
      `org.freedesktop.DBus.Properties.Set string:'org.mpris.MediaPlayer2.Player' ` +
      `string:'Shuffle' variant:boolean:${enabled} 2>/dev/null`
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Set loop status
 */
export async function setLoopStatus(status: 'None' | 'Track' | 'Playlist'): Promise<boolean> {
  if (!activePlayerService) return false;
  try {
    await execAsync(
      `dbus-send --print-reply --dest=${activePlayerService} /org/mpris/MediaPlayer2 ` +
      `org.freedesktop.DBus.Properties.Set string:'org.mpris.MediaPlayer2.Player' ` +
      `string:'LoopStatus' variant:string:${status} 2>/dev/null`
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Set active player by service name
 */
export function setActivePlayer(serviceName: string): void {
  activePlayerService = serviceName;
  cachedNowPlaying = { ...DEFAULT_NOW_PLAYING };
  lastNowPlayingFetch = 0;
}

/**
 * Get current active player service name
 */
export function getActivePlayer(): string | null {
  return activePlayerService;
}
