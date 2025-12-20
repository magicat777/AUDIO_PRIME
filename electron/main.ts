// Fix for AppImage sandbox issue on Linux MUST come before Electron import
// AppImages mount in /tmp and can't use the SUID sandbox
if (process.env.APPIMAGE || process.platform === 'linux') {
  process.argv.push('--no-sandbox');
}

// Suppress noisy Chromium DevTools errors (Autofill, etc.)
process.argv.push('--disable-features=AutofillServerCommunication');

import { app, BrowserWindow, ipcMain, shell, safeStorage, session } from 'electron';
import { join } from 'path';
import { spawn, ChildProcess } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { createHash, randomBytes } from 'crypto';
import { URL } from 'url';
import * as os from 'os';
import * as fs from 'fs';
import { config as dotenvConfig } from 'dotenv';
import { autoUpdater } from 'electron-updater';

// Load environment variables from .env file
// Try multiple locations in order of priority (only load if file exists)
const envPaths = [
  { path: join(os.homedir(), '.config', 'audio-prime', '.env'), name: 'user config' },
  { path: join(process.resourcesPath, '.env'), name: 'resources' },
  { path: join(__dirname, '../.env'), name: 'development' },
  { path: join(app.getAppPath(), '.env'), name: 'app' },
];

for (const env of envPaths) {
  if (fs.existsSync(env.path)) {
    dotenvConfig({ path: env.path, quiet: true });
    console.log(`Loaded .env from ${env.name}:`, env.path);
    break; // Stop after first successful load
  }
}

const execAsync = promisify(exec);

// Global error handlers for stability
process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught Exception:', error.message);
  console.error('Stack:', error.stack);
  // Don't exit - try to keep the app running
  // In production, this would also send to crash reporting service
});

process.on('unhandledRejection', (reason: unknown) => {
  console.error('Unhandled Promise Rejection:', reason);
  // In production, this would also send to crash reporting service
});

// Audio capture process
let audioProcess: ChildProcess | null = null;

// Window reference
let mainWindow: BrowserWindow | null = null;

// Spotify OAuth state
let oauthServer: Server | null = null;
let codeVerifier: string | null = null;
let oauthState: string | null = null;
let spotifyTokens: {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
} | null = null;
let lastTrackId: string | null = null;

// CPU usage tracking
let previousCpuInfo: { idle: number; total: number } | null = null;

// Spotify configuration - credentials loaded from environment variables
// Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env file
const SPOTIFY_CONFIG = {
  clientId: process.env.SPOTIFY_CLIENT_ID || '',
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
  redirectUri: process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:8888/callback',
  scopes: ['user-read-currently-playing', 'user-read-playback-state', 'user-modify-playback-state'],
  authUrl: 'https://accounts.spotify.com/authorize',
  tokenUrl: 'https://accounts.spotify.com/api/token',
  apiBaseUrl: 'https://api.spotify.com/v1',
};

// Validate Spotify credentials on startup
function validateSpotifyConfig(): boolean {
  if (!SPOTIFY_CONFIG.clientId || !SPOTIFY_CONFIG.clientSecret) {
    console.warn('Spotify credentials not configured. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env file.');
    console.warn('Spotify integration will be disabled.');
    return false;
  }
  return true;
}

const spotifyEnabled = validateSpotifyConfig();

// IPC Channels
const IPC = {
  AUDIO_DATA: 'audio:data',
  AUDIO_DEVICES: 'audio:devices',
  AUDIO_START: 'audio:start',
  AUDIO_STOP: 'audio:stop',
  AUDIO_SELECT_DEVICE: 'audio:select-device',
  WINDOW_FULLSCREEN: 'window:fullscreen',
  // Spotify channels
  SPOTIFY_CONNECT: 'spotify:connect',
  SPOTIFY_DISCONNECT: 'spotify:disconnect',
  SPOTIFY_STATUS: 'spotify:status',
  SPOTIFY_NOW_PLAYING: 'spotify:now-playing',
  SPOTIFY_AUDIO_FEATURES: 'spotify:audio-features',
  SPOTIFY_AUTH_UPDATE: 'spotify:auth-update',
  // Spotify playback control
  SPOTIFY_PLAY: 'spotify:play',
  SPOTIFY_PAUSE: 'spotify:pause',
  SPOTIFY_NEXT: 'spotify:next',
  SPOTIFY_PREVIOUS: 'spotify:previous',
  SPOTIFY_SEEK: 'spotify:seek',
  SPOTIFY_SHUFFLE: 'spotify:shuffle',
  SPOTIFY_REPEAT: 'spotify:repeat',
};

interface AudioDevice {
  id: string;
  name: string;
  description: string;
  type: 'monitor' | 'input';
  sampleRate: number;
  channels: number;
  format: string;
  state: 'running' | 'idle' | 'suspended';
}

async function getAudioSources(): Promise<AudioDevice[]> {
  try {
    const { stdout } = await execAsync('pactl list sources 2>/dev/null');
    const devices: AudioDevice[] = [];

    // Parse the detailed output
    const sourceBlocks = stdout.split('Source #');

    for (const block of sourceBlocks) {
      if (!block.trim()) continue;

      // Extract fields using regex
      const nameMatch = block.match(/Name:\s*(.+)/);
      const descMatch = block.match(/Description:\s*(.+)/);
      const sampleMatch = block.match(/Sample Specification:\s*(\S+)\s+(\d+)ch\s+(\d+)Hz/);
      const stateMatch = block.match(/State:\s*(\S+)/);

      if (nameMatch) {
        const id = nameMatch[1].trim();
        const description = descMatch ? descMatch[1].trim() : id;
        const isMonitor = id.includes('.monitor');

        // Parse sample specification
        let format = 's16le';
        let channels = 2;
        let sampleRate = 48000;
        if (sampleMatch) {
          format = sampleMatch[1];
          channels = parseInt(sampleMatch[2], 10);
          sampleRate = parseInt(sampleMatch[3], 10);
        }

        // Parse state
        let state: 'running' | 'idle' | 'suspended' = 'idle';
        if (stateMatch) {
          const stateStr = stateMatch[1].toLowerCase();
          if (stateStr === 'running') state = 'running';
          else if (stateStr === 'suspended') state = 'suspended';
        }

        // Create friendly short name from description
        let name = description;
        // Shorten common prefixes
        name = name.replace('Monitor of ', '');
        // Truncate very long names
        if (name.length > 50) {
          name = name.substring(0, 47) + '...';
        }

        devices.push({
          id,
          name,
          description,
          type: isMonitor ? 'monitor' : 'input',
          sampleRate,
          channels,
          format,
          state,
        });
      }
    }

    // Sort: running first, then monitors, then by name
    devices.sort((a, b) => {
      // Running devices first
      if (a.state === 'running' && b.state !== 'running') return -1;
      if (a.state !== 'running' && b.state === 'running') return 1;
      // Then monitors
      if (a.type === 'monitor' && b.type !== 'monitor') return -1;
      if (a.type !== 'monitor' && b.type === 'monitor') return 1;
      // Then alphabetically
      return a.name.localeCompare(b.name);
    });

    return devices;
  } catch (error) {
    console.error('Error getting audio sources:', error);
    return [];
  }
}

function startAudioCapture(deviceId: string): void {
  if (audioProcess) {
    audioProcess.kill();
  }

  // Use parec for PipeWire/PulseAudio capture with low latency
  audioProcess = spawn('parec', [
    '--device', deviceId,
    '--rate', '48000',
    '--channels', '2',
    '--format', 'float32le',
    '--raw',
    '--latency-msec', '10',  // Minimize capture latency
  ]);

  audioProcess.stdout?.on('data', (chunk: Buffer) => {
    // Convert raw bytes to Float32Array
    const samples = new Float32Array(chunk.buffer.slice(
      chunk.byteOffset,
      chunk.byteOffset + chunk.byteLength
    ));

    // Send to renderer process
    mainWindow?.webContents.send(IPC.AUDIO_DATA, Array.from(samples));
  });

  audioProcess.stderr?.on('data', (data) => {
    console.error('Audio capture error:', data.toString());
  });

  audioProcess.on('close', (code) => {
    console.log('Audio capture process exited with code:', code);
    audioProcess = null;
  });
}

function stopAudioCapture(): void {
  if (audioProcess) {
    audioProcess.kill();
    audioProcess = null;
  }
}

function createWindow(): void {
  // Configure Content Security Policy for production
  // CSP helps prevent XSS attacks by restricting resource loading
  if (!process.env.VITE_DEV_SERVER_URL) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            [
              "default-src 'self'",
              "script-src 'self'",
              "style-src 'self' 'unsafe-inline'",  // Svelte uses inline styles
              "worker-src 'self' blob:",  // FFT Web Worker
              "img-src 'self' https://i.scdn.co https://*.scdn.co https://*.spotifycdn.com data:",  // Spotify album art + data URIs
              "connect-src 'self' https://api.spotify.com https://accounts.spotify.com",
              "font-src 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join('; ')
          ]
        }
      });
    });
  }

  mainWindow = new BrowserWindow({
    width: 1157,
    height: 1333,
    minWidth: 1000,
    minHeight: 800,
    backgroundColor: '#0a0a0f',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      // Security settings - see Electron security checklist
      nodeIntegration: false,        // Prevent Node.js access from renderer
      contextIsolation: true,        // Isolate preload from renderer context
      webSecurity: true,             // Enforce same-origin policy
      allowRunningInsecureContent: false,  // Block HTTP content on HTTPS
      // Note: sandbox disabled for AppImage compatibility on Linux
      // AppImages mount in /tmp and can't use the SUID sandbox
      sandbox: false,
    },
  });

  // Development or production URL
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopAudioCapture();
  });

  // Security: Open external links in default browser, not in app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Security: Prevent navigation to external URLs
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    // Allow localhost for development and file:// for production
    if (parsedUrl.protocol !== 'file:' && !parsedUrl.hostname.match(/^(localhost|127\.0\.0\.1)$/)) {
      event.preventDefault();
      shell.openExternal(navigationUrl);
    }
  });
}

// IPC Handlers
ipcMain.handle(IPC.AUDIO_DEVICES, async () => {
  return await getAudioSources();
});

ipcMain.handle(IPC.AUDIO_START, (_, deviceId: string) => {
  startAudioCapture(deviceId);
  return true;
});

ipcMain.handle(IPC.AUDIO_STOP, () => {
  stopAudioCapture();
  return true;
});

ipcMain.handle(IPC.WINDOW_FULLSCREEN, () => {
  if (mainWindow) {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return mainWindow.isFullScreen();
  }
  return false;
});

// ============================================
// System Metrics (CPU/GPU)
// ============================================

/**
 * Calculate CPU usage percentage
 */
function getCpuUsage(): number {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type as keyof typeof cpu.times];
    }
    totalIdle += cpu.times.idle;
  }

  const currentInfo = { idle: totalIdle, total: totalTick };

  if (previousCpuInfo === null) {
    previousCpuInfo = currentInfo;
    return 0;
  }

  const idleDiff = currentInfo.idle - previousCpuInfo.idle;
  const totalDiff = currentInfo.total - previousCpuInfo.total;
  previousCpuInfo = currentInfo;

  if (totalDiff === 0) return 0;
  return Math.round((1 - idleDiff / totalDiff) * 100);
}

/**
 * Get GPU usage percentage (Linux-specific)
 * Tries AMD sysfs first, then nvidia-smi
 */
async function getGpuUsage(): Promise<number> {
  // Try AMD GPU (sysfs interface)
  try {
    const amdPath = '/sys/class/drm/card0/device/gpu_busy_percent';
    if (fs.existsSync(amdPath)) {
      const value = fs.readFileSync(amdPath, 'utf8').trim();
      return parseInt(value, 10) || 0;
    }
  } catch {
    // AMD GPU not available or no permission
  }

  // Try NVIDIA GPU (nvidia-smi)
  try {
    const { stdout } = await execAsync('nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null');
    const value = parseInt(stdout.trim(), 10);
    if (!isNaN(value)) return value;
  } catch {
    // nvidia-smi not available
  }

  // Try Intel GPU (intel_gpu_top format)
  try {
    const intelPath = '/sys/class/drm/card0/gt/gt0/rps_act_freq_mhz';
    if (fs.existsSync(intelPath)) {
      // Intel doesn't expose percentage directly, return 0 for now
      return 0;
    }
  } catch {
    // Intel GPU not available
  }

  return 0; // No GPU info available
}

ipcMain.handle('system:metrics', async () => {
  const cpuPercent = getCpuUsage();
  const gpuPercent = await getGpuUsage();
  return { cpuPercent, gpuPercent };
});

// ============================================
// Audio Source Metadata
// ============================================

interface AudioSourceInfo {
  sampleRate: number;
  bitDepth: number;
  channels: number;
  format: string;
  applicationName: string;
  latencyMs: number;
  available: boolean;
}

let cachedAudioInfo: AudioSourceInfo | null = null;
let lastAudioInfoFetch = 0;
const AUDIO_INFO_CACHE_MS = 1000; // Cache for 1 second

/**
 * Get audio source metadata from PulseAudio/PipeWire
 */
async function getAudioSourceInfo(): Promise<AudioSourceInfo> {
  const now = Date.now();

  // Return cached value if fresh
  if (cachedAudioInfo && (now - lastAudioInfoFetch) < AUDIO_INFO_CACHE_MS) {
    return cachedAudioInfo;
  }

  const defaultInfo: AudioSourceInfo = {
    sampleRate: 0,
    bitDepth: 0,
    channels: 0,
    format: 'Unknown',
    applicationName: 'None',
    latencyMs: 0,
    available: false,
  };

  try {
    const { stdout } = await execAsync('pactl list sink-inputs 2>/dev/null');

    // Parse sink-input info - look for active audio streams
    const sinkInputs = stdout.split('Sink Input #');

    for (const input of sinkInputs) {
      if (!input.trim()) continue;

      // Extract sample specification (e.g., "float32le 2ch 44100Hz")
      const sampleSpecMatch = input.match(/Sample Specification:\s*(\S+)\s+(\d+)ch\s+(\d+)Hz/);

      // Extract application name
      const appNameMatch = input.match(/application\.name\s*=\s*"([^"]+)"/);

      // Extract node latency (e.g., "8192/44100")
      const latencyMatch = input.match(/node\.latency\s*=\s*"(\d+)\/(\d+)"/);

      if (sampleSpecMatch) {
        const format = sampleSpecMatch[1];
        const channels = parseInt(sampleSpecMatch[2], 10);
        const sampleRate = parseInt(sampleSpecMatch[3], 10);

        // Determine bit depth from format
        let bitDepth = 16;
        if (format.includes('32')) bitDepth = 32;
        else if (format.includes('24')) bitDepth = 24;
        else if (format.includes('16')) bitDepth = 16;
        else if (format.includes('8')) bitDepth = 8;

        // Calculate latency in ms
        let latencyMs = 0;
        if (latencyMatch) {
          const samples = parseInt(latencyMatch[1], 10);
          const rate = parseInt(latencyMatch[2], 10);
          latencyMs = (samples / rate) * 1000;
        }

        cachedAudioInfo = {
          sampleRate,
          bitDepth,
          channels,
          format: format.toUpperCase(),
          applicationName: appNameMatch ? appNameMatch[1] : 'Unknown',
          latencyMs,
          available: true,
        };
        lastAudioInfoFetch = now;
        return cachedAudioInfo;
      }
    }

    // No active sink-inputs found
    cachedAudioInfo = defaultInfo;
    lastAudioInfoFetch = now;
    return defaultInfo;
  } catch {
    // pactl not available or failed
    cachedAudioInfo = defaultInfo;
    lastAudioInfoFetch = now;
    return defaultInfo;
  }
}

ipcMain.handle('system:audio-info', async () => {
  return await getAudioSourceInfo();
});

// ============================================
// Spotify OAuth and API Functions
// ============================================

/**
 * Generate PKCE code verifier
 */
function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Generate PKCE code challenge from verifier
 */
function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Load stored tokens from safeStorage
 */
function loadStoredTokens(): void {
  try {
    const stored = app.getPath('userData');
    const fs = require('fs');
    const tokenPath = join(stored, 'spotify-tokens.enc');

    if (fs.existsSync(tokenPath) && safeStorage.isEncryptionAvailable()) {
      const encrypted = fs.readFileSync(tokenPath);
      const decrypted = safeStorage.decryptString(encrypted);
      spotifyTokens = JSON.parse(decrypted);
      console.log('Loaded stored Spotify tokens');
    }
  } catch (error) {
    console.error('Error loading stored tokens:', error);
    spotifyTokens = null;
  }
}

/**
 * Save tokens to safeStorage
 */
function saveTokens(): void {
  try {
    if (!spotifyTokens) return;

    const stored = app.getPath('userData');
    const fs = require('fs');
    const tokenPath = join(stored, 'spotify-tokens.enc');

    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(JSON.stringify(spotifyTokens));
      fs.writeFileSync(tokenPath, encrypted);
      console.log('Saved Spotify tokens');
    }
  } catch (error) {
    console.error('Error saving tokens:', error);
  }
}

/**
 * Clear stored tokens
 */
function clearTokens(): void {
  try {
    spotifyTokens = null;
    const stored = app.getPath('userData');
    const fs = require('fs');
    const tokenPath = join(stored, 'spotify-tokens.enc');

    if (fs.existsSync(tokenPath)) {
      fs.unlinkSync(tokenPath);
    }
    console.log('Cleared Spotify tokens');
  } catch (error) {
    console.error('Error clearing tokens:', error);
  }
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCodeForTokens(code: string): Promise<boolean> {
  try {
    const params = new URLSearchParams({
      client_id: SPOTIFY_CONFIG.clientId,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: SPOTIFY_CONFIG.redirectUri,
      code_verifier: codeVerifier!,
    });

    const response = await fetch(SPOTIFY_CONFIG.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(
          `${SPOTIFY_CONFIG.clientId}:${SPOTIFY_CONFIG.clientSecret}`
        ).toString('base64'),
      },
      body: params.toString(),
    });

    if (!response.ok) {
      // Don't log response body - may contain sensitive error details
      console.error('Token exchange failed: HTTP', response.status);
      return false;
    }

    const data = await response.json();
    spotifyTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in * 1000),
    };

    saveTokens();

    // Notify renderer of auth update
    mainWindow?.webContents.send(IPC.SPOTIFY_AUTH_UPDATE, { connected: true });

    return true;
  } catch (error) {
    console.error('Error exchanging code for tokens:', error);
    return false;
  }
}

/**
 * Refresh access token
 */
async function refreshAccessToken(): Promise<boolean> {
  if (!spotifyTokens?.refreshToken) return false;

  try {
    const params = new URLSearchParams({
      client_id: SPOTIFY_CONFIG.clientId,
      grant_type: 'refresh_token',
      refresh_token: spotifyTokens.refreshToken,
    });

    const response = await fetch(SPOTIFY_CONFIG.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(
          `${SPOTIFY_CONFIG.clientId}:${SPOTIFY_CONFIG.clientSecret}`
        ).toString('base64'),
      },
      body: params.toString(),
    });

    if (!response.ok) {
      console.error('Token refresh failed');
      return false;
    }

    const data = await response.json();
    spotifyTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || spotifyTokens.refreshToken,
      expiresAt: Date.now() + (data.expires_in * 1000),
    };

    saveTokens();
    return true;
  } catch (error) {
    console.error('Error refreshing token:', error);
    return false;
  }
}

/**
 * Get valid access token (refresh if needed)
 */
async function getValidAccessToken(): Promise<string | null> {
  if (!spotifyTokens) return null;

  // Refresh if expires in less than 5 minutes
  if (Date.now() > spotifyTokens.expiresAt - 300000) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) return null;
  }

  return spotifyTokens.accessToken;
}

/**
 * Start OAuth callback server
 */
function startOAuthServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (oauthServer) {
      oauthServer.close();
    }

    oauthServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://localhost:8888`);

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<html><body><h1>Authentication Failed</h1><p>${error}</p><script>window.close()</script></body></html>`);
          return;
        }

        if (state !== oauthState) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Invalid State</h1><script>window.close()</script></body></html>');
          return;
        }

        if (code) {
          const success = await exchangeCodeForTokens(code);
          if (success) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body style="background:#0a0a0f;color:#fff;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;">
                  <div style="text-align:center;">
                    <h1 style="color:#1DB954;">✓ Connected to Spotify!</h1>
                    <p>You can close this window and return to AUDIO_PRIME.</p>
                    <script>setTimeout(() => window.close(), 2000)</script>
                  </div>
                </body>
              </html>
            `);
          } else {
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end('<html><body><h1>Token Exchange Failed</h1><script>window.close()</script></body></html>');
          }
        }

        // Close server after handling callback
        setTimeout(() => {
          oauthServer?.close();
          oauthServer = null;
        }, 3000);
      }
    });

    oauthServer.listen(8888, () => {
      console.log('OAuth callback server listening on port 8888');
      resolve();
    });

    oauthServer.on('error', (err) => {
      console.error('OAuth server error:', err);
      reject(err);
    });
  });
}

/**
 * Fetch currently playing track from Spotify
 */
async function fetchNowPlaying(): Promise<unknown> {
  const token = await getValidAccessToken();
  if (!token) return { error: 'Not authenticated' };

  try {
    const response = await fetch(`${SPOTIFY_CONFIG.apiBaseUrl}/me/player/currently-playing`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (response.status === 204) {
      return { playing: false, track: null };
    }

    if (!response.ok) {
      return { error: 'API request failed' };
    }

    const data = await response.json();

    if (!data.item) {
      return { playing: false, track: null };
    }

    // Get album art - prefer medium size (300px), fallback to any available
    const images = data.item.album?.images || [];
    let albumArt = null;
    let albumArtLarge = null;

    if (images.length > 0) {
      // Sort by size and pick appropriately
      const sorted = [...images].sort((a: { height: number }, b: { height: number }) => (b.height || 0) - (a.height || 0));
      albumArtLarge = sorted[0]?.url || null;
      // For thumbnail, prefer ~300px or smallest available
      albumArt = sorted.find((img: { height: number }) => img.height && img.height <= 300)?.url || sorted[sorted.length - 1]?.url || albumArtLarge;
    }

    // Only log on track change
    if (data.item.id !== lastTrackId) {
      console.log('Now playing:', data.item.name, 'by', data.item.artists.map((a: { name: string }) => a.name).join(', '));
      lastTrackId = data.item.id;
    }

    return {
      playing: data.is_playing,
      track: {
        id: data.item.id,
        name: data.item.name,
        artist: data.item.artists.map((a: { name: string }) => a.name).join(', '),
        artists: data.item.artists.map((a: { name: string }) => a.name),
        album: data.item.album.name,
        albumArt: albumArt,
        albumArtLarge: albumArtLarge,
        durationMs: data.item.duration_ms,
        progressMs: data.progress_ms,
        uri: data.item.uri,
      },
    };
  } catch (error) {
    console.error('Error fetching now playing:', error);
    return { error: 'Request failed' };
  }
}

/**
 * Fetch audio features for a track
 */
async function fetchAudioFeatures(trackId: string): Promise<unknown> {
  const token = await getValidAccessToken();
  if (!token) return { error: 'Not authenticated' };

  try {
    console.log('Fetching audio features for track:', trackId);
    const response = await fetch(`${SPOTIFY_CONFIG.apiBaseUrl}/audio-features/${trackId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Audio features API error:', response.status, errorText);
      // 403 = Spotify deprecated audio-features for most apps in Nov 2024
      if (response.status === 403) {
        return { error: 'Audio features unavailable (API restricted)', unavailable: true };
      }
      return { error: `API request failed: ${response.status}` };
    }

    const data = await response.json();
    console.log('Audio features received:', data);

    return {
      tempo: Math.round(data.tempo || 0),
      key: data.key ?? -1,
      mode: data.mode ?? 0,
      energy: data.energy || 0,
      danceability: data.danceability || 0,
      valence: data.valence || 0,
      acousticness: data.acousticness || 0,
      instrumentalness: data.instrumentalness || 0,
      liveness: data.liveness || 0,
      speechiness: data.speechiness || 0,
      loudness: data.loudness || -60,
      timeSignature: data.time_signature || 4,
    };
  } catch (error) {
    console.error('Error fetching audio features:', error);
    return { error: 'Request failed' };
  }
}

/**
 * Playback control - Play/Resume
 */
async function playbackPlay(): Promise<{ success: boolean; error?: string }> {
  const token = await getValidAccessToken();
  if (!token) return { success: false, error: 'Not authenticated' };

  try {
    const response = await fetch(`${SPOTIFY_CONFIG.apiBaseUrl}/me/player/play`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (response.status === 204 || response.ok) {
      return { success: true };
    }

    const errorText = await response.text();
    return { success: false, error: `API error: ${response.status}` };
  } catch (error) {
    console.error('Error playing:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Playback control - Pause
 */
async function playbackPause(): Promise<{ success: boolean; error?: string }> {
  const token = await getValidAccessToken();
  if (!token) return { success: false, error: 'Not authenticated' };

  try {
    const response = await fetch(`${SPOTIFY_CONFIG.apiBaseUrl}/me/player/pause`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (response.status === 204 || response.ok) {
      return { success: true };
    }

    return { success: false, error: `API error: ${response.status}` };
  } catch (error) {
    console.error('Error pausing:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Playback control - Next track
 */
async function playbackNext(): Promise<{ success: boolean; error?: string }> {
  const token = await getValidAccessToken();
  if (!token) return { success: false, error: 'Not authenticated' };

  try {
    const response = await fetch(`${SPOTIFY_CONFIG.apiBaseUrl}/me/player/next`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (response.status === 204 || response.ok) {
      return { success: true };
    }

    return { success: false, error: `API error: ${response.status}` };
  } catch (error) {
    console.error('Error skipping to next:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Playback control - Previous track
 */
async function playbackPrevious(): Promise<{ success: boolean; error?: string }> {
  const token = await getValidAccessToken();
  if (!token) return { success: false, error: 'Not authenticated' };

  try {
    const response = await fetch(`${SPOTIFY_CONFIG.apiBaseUrl}/me/player/previous`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (response.status === 204 || response.ok) {
      return { success: true };
    }
    return { success: false, error: `API error: ${response.status}` };
  } catch (error) {
    console.error('Error going to previous:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Playback control - Seek to position
 */
async function playbackSeek(positionMs: number): Promise<{ success: boolean; error?: string }> {
  const token = await getValidAccessToken();
  if (!token) return { success: false, error: 'Not authenticated' };

  try {
    const response = await fetch(`${SPOTIFY_CONFIG.apiBaseUrl}/me/player/seek?position_ms=${positionMs}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (response.status === 204 || response.ok) {
      return { success: true };
    }
    return { success: false, error: `API error: ${response.status}` };
  } catch (error) {
    console.error('Error seeking:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Playback control - Toggle shuffle
 */
async function playbackShuffle(state: boolean): Promise<{ success: boolean; error?: string }> {
  const token = await getValidAccessToken();
  if (!token) return { success: false, error: 'Not authenticated' };

  try {
    const response = await fetch(`${SPOTIFY_CONFIG.apiBaseUrl}/me/player/shuffle?state=${state}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (response.status === 204 || response.ok) {
      return { success: true };
    }
    return { success: false, error: `API error: ${response.status}` };
  } catch (error) {
    console.error('Error toggling shuffle:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Playback control - Set repeat mode
 */
async function playbackRepeat(state: 'off' | 'track' | 'context'): Promise<{ success: boolean; error?: string }> {
  const token = await getValidAccessToken();
  if (!token) return { success: false, error: 'Not authenticated' };

  try {
    const response = await fetch(`${SPOTIFY_CONFIG.apiBaseUrl}/me/player/repeat?state=${state}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (response.status === 204 || response.ok) {
      return { success: true };
    }
    return { success: false, error: `API error: ${response.status}` };
  } catch (error) {
    console.error('Error setting repeat:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Open URL in default browser with Linux fallback
 */
async function openExternalUrl(url: string): Promise<void> {
  console.log('Opening URL:', url);

  try {
    // Try shell.openExternal first
    await shell.openExternal(url);
    console.log('Opened with shell.openExternal');
  } catch (error) {
    console.error('shell.openExternal failed:', error);

    // Fallback: use xdg-open on Linux
    if (process.platform === 'linux') {
      console.log('Trying xdg-open fallback...');
      try {
        await execAsync(`xdg-open "${url}"`);
        console.log('Opened with xdg-open');
      } catch (xdgError) {
        console.error('xdg-open also failed:', xdgError);
        throw xdgError;
      }
    } else {
      throw error;
    }
  }
}

// Spotify IPC Handlers
ipcMain.handle(IPC.SPOTIFY_CONNECT, async () => {
  // Check if Spotify credentials are configured
  if (!spotifyEnabled) {
    return {
      success: false,
      error: 'Spotify credentials not configured. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env file.'
    };
  }

  try {
    // Generate PKCE codes
    codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    oauthState = randomBytes(16).toString('hex');

    // Start OAuth callback server
    await startOAuthServer();

    // Build auth URL
    const params = new URLSearchParams({
      client_id: SPOTIFY_CONFIG.clientId,
      response_type: 'code',
      redirect_uri: SPOTIFY_CONFIG.redirectUri,
      scope: SPOTIFY_CONFIG.scopes.join(' '),
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
      state: oauthState,
    });

    const authUrl = `${SPOTIFY_CONFIG.authUrl}?${params.toString()}`;
    console.log('Spotify auth URL generated');

    // Open in default browser with fallback
    await openExternalUrl(authUrl);

    return { success: true };
  } catch (error) {
    console.error('Error initiating Spotify auth:', error);
    return { success: false, error: String(error) };
  }
});

ipcMain.handle(IPC.SPOTIFY_DISCONNECT, () => {
  clearTokens();
  mainWindow?.webContents.send(IPC.SPOTIFY_AUTH_UPDATE, { connected: false });
  return { success: true };
});

ipcMain.handle(IPC.SPOTIFY_STATUS, () => {
  return {
    connected: spotifyTokens !== null,
    expiresAt: spotifyTokens?.expiresAt,
  };
});

ipcMain.handle(IPC.SPOTIFY_NOW_PLAYING, async () => {
  return await fetchNowPlaying();
});

ipcMain.handle(IPC.SPOTIFY_AUDIO_FEATURES, async (_, trackId: string) => {
  return await fetchAudioFeatures(trackId);
});

// Playback control handlers
ipcMain.handle(IPC.SPOTIFY_PLAY, async () => {
  return await playbackPlay();
});

ipcMain.handle(IPC.SPOTIFY_PAUSE, async () => {
  return await playbackPause();
});

ipcMain.handle(IPC.SPOTIFY_NEXT, async () => {
  return await playbackNext();
});

ipcMain.handle(IPC.SPOTIFY_PREVIOUS, async () => {
  return await playbackPrevious();
});

ipcMain.handle(IPC.SPOTIFY_SEEK, async (_, positionMs: number) => {
  return await playbackSeek(positionMs);
});

ipcMain.handle(IPC.SPOTIFY_SHUFFLE, async (_, state: boolean) => {
  return await playbackShuffle(state);
});

ipcMain.handle(IPC.SPOTIFY_REPEAT, async (_, state: 'off' | 'track' | 'context') => {
  return await playbackRepeat(state);
});

// ============================================
// Auto-Update Configuration
// ============================================

/**
 * Configure and initialize auto-updater
 * Updates are checked on app start and can be triggered manually
 */
function initAutoUpdater(): void {
  // Don't check for updates in development
  if (process.env.VITE_DEV_SERVER_URL) {
    console.log('Auto-updater disabled in development mode');
    return;
  }

  // Configure auto-updater
  autoUpdater.autoDownload = false;  // Don't auto-download, let user decide
  autoUpdater.autoInstallOnAppQuit = true;

  // Log update events
  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
    // Notify renderer about available update
    mainWindow?.webContents.send('update:available', {
      version: info.version,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('No updates available');
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`Download progress: ${progress.percent.toFixed(1)}%`);
    mainWindow?.webContents.send('update:progress', {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded:', info.version);
    mainWindow?.webContents.send('update:downloaded', {
      version: info.version,
    });
  });

  autoUpdater.on('error', (error) => {
    // Suppress expected/non-critical errors
    const msg = error.message || '';
    if (msg.includes('No published versions') ||
        msg.includes('net::ERR_') ||
        msg.includes('ENOTFOUND') ||
        msg.includes('HttpError: 404') ||
        msg.includes('latest-linux.yml')) {
      console.log('Auto-updater: Update check unavailable');
    } else {
      console.error('Auto-updater error:', msg);
    }
  });

  // Check for updates after a short delay
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      // Suppress expected/non-critical errors
      const msg = err.message || '';
      if (msg.includes('No published versions') ||
          msg.includes('net::ERR_') ||
          msg.includes('ENOTFOUND') ||
          msg.includes('HttpError: 404') ||
          msg.includes('latest-linux.yml')) {
        console.log('Auto-updater: Update check unavailable');
      } else {
        console.error('Failed to check for updates:', msg);
      }
    });
  }, 5000);
}

// IPC handlers for manual update control
ipcMain.handle('update:check', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, version: result?.updateInfo?.version };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('update:download', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('update:install', () => {
  autoUpdater.quitAndInstall(false, true);
});

// App lifecycle
app.whenReady().then(() => {
  // Load stored Spotify tokens
  loadStoredTokens();

  createWindow();

  // Initialize auto-updater
  initAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopAudioCapture();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopAudioCapture();
});
