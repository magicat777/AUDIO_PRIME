import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'path';
import { spawn, ChildProcess } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Audio capture process
let audioProcess: ChildProcess | null = null;

// Window reference
let mainWindow: BrowserWindow | null = null;

// IPC Channels
const IPC = {
  AUDIO_DATA: 'audio:data',
  AUDIO_DEVICES: 'audio:devices',
  AUDIO_START: 'audio:start',
  AUDIO_STOP: 'audio:stop',
  AUDIO_SELECT_DEVICE: 'audio:select-device',
  WINDOW_FULLSCREEN: 'window:fullscreen',
};

interface AudioDevice {
  id: string;
  name: string;
  type: 'monitor' | 'input';
}

async function getMonitorSources(): Promise<AudioDevice[]> {
  try {
    const { stdout } = await execAsync('pactl list sources short');
    const devices: AudioDevice[] = [];

    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;

      const parts = line.split('\t');
      if (parts.length >= 2) {
        const id = parts[1];
        const isMonitor = id.includes('.monitor');

        // Create friendly name
        let name = id;
        if (id.includes('Scarlett')) {
          name = isMonitor ? 'Scarlett 2i2 (System Audio)' : 'Scarlett 2i2 (Input)';
        } else if (id.includes('Focusrite')) {
          name = isMonitor ? 'Focusrite (System Audio)' : 'Focusrite (Input)';
        } else {
          // Generic name cleanup
          name = id
            .replace('alsa_output.', '')
            .replace('alsa_input.', '')
            .replace('.monitor', ' (Monitor)')
            .replace(/-/g, ' ')
            .replace(/\.[^.]+$/, '');
        }

        devices.push({
          id: id,
          name: name,
          type: isMonitor ? 'monitor' : 'input',
        });
      }
    }

    // Sort: monitors first
    devices.sort((a, b) => {
      if (a.type === 'monitor' && b.type !== 'monitor') return -1;
      if (a.type !== 'monitor' && b.type === 'monitor') return 1;
      return 0;
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
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: '#0a0a0f',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
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

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// IPC Handlers
ipcMain.handle(IPC.AUDIO_DEVICES, async () => {
  return await getMonitorSources();
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

// App lifecycle
app.whenReady().then(() => {
  createWindow();

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
