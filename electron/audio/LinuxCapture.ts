import { spawn, ChildProcess } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';
import { AudioCapture } from './AudioCapture';
import { AudioDevice, AudioDataCallback, AudioErrorCallback, AudioCloseCallback } from './types';

const execAsync = promisify(exec);

/**
 * Linux audio capture implementation using PulseAudio/PipeWire via parec
 *
 * Features auto-reconnect with exponential backoff when parec exits unexpectedly.
 */
export class LinuxCapture implements AudioCapture {
  private process: ChildProcess | null = null;
  private dataCallback: AudioDataCallback | null = null;
  private errorCallback: AudioErrorCallback | null = null;
  private closeCallback: AudioCloseCallback | null = null;

  // Dynamic sample rate — detected from the active sink before capture starts
  private currentSampleRate: number = 0;
  private static readonly DEFAULT_SAMPLE_RATE = 48000;
  private static readonly SUPPORTED_RATES = [44100, 48000, 88200, 96000, 176400, 192000];

  // Auto-reconnect state
  private activeDeviceId: string | null = null;
  private intentionalStop = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 10;
  private readonly BASE_RECONNECT_DELAY_MS = 500;
  private readonly MAX_RECONNECT_DELAY_MS = 30000;

  async listDevices(): Promise<AudioDevice[]> {
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

  /**
   * Detect the sample rate of the sink that a source (monitor) is attached to.
   * For monitor sources, queries the parent sink. Falls back to source's own rate.
   */
  private async detectSampleRate(deviceId: string): Promise<number> {
    try {
      // If this is a monitor source, get the parent sink's rate
      if (deviceId.includes('.monitor')) {
        const sinkName = deviceId.replace('.monitor', '');
        const { stdout } = await execAsync(`pactl list sinks 2>/dev/null`);
        const blocks = stdout.split('Sink #');
        for (const block of blocks) {
          if (block.includes(`Name: ${sinkName}`)) {
            const specMatch = block.match(/Sample Specification:\s*\S+\s+\d+ch\s+(\d+)Hz/);
            if (specMatch) {
              const rate = parseInt(specMatch[1], 10);
              if (LinuxCapture.SUPPORTED_RATES.includes(rate)) {
                console.log(`Detected sink sample rate: ${rate} Hz for ${sinkName}`);
                return rate;
              }
            }
          }
        }
      }

      // Fallback: query the source itself
      const { stdout } = await execAsync(`pactl list sources 2>/dev/null`);
      const blocks = stdout.split('Source #');
      for (const block of blocks) {
        if (block.includes(`Name: ${deviceId}`)) {
          const specMatch = block.match(/Sample Specification:\s*\S+\s+\d+ch\s+(\d+)Hz/);
          if (specMatch) {
            const rate = parseInt(specMatch[1], 10);
            if (LinuxCapture.SUPPORTED_RATES.includes(rate)) {
              console.log(`Detected source sample rate: ${rate} Hz`);
              return rate;
            }
          }
        }
      }
    } catch (error) {
      console.error('Error detecting sample rate:', error);
    }

    console.log(`Using default sample rate: ${LinuxCapture.DEFAULT_SAMPLE_RATE} Hz`);
    return LinuxCapture.DEFAULT_SAMPLE_RATE;
  }

  start(deviceId: string): void {
    // Stop any existing capture
    this.intentionalStop = false;
    this.stopInternal();
    this.cancelReconnect();

    this.activeDeviceId = deviceId;
    this.reconnectAttempts = 0;

    // Detect sample rate then start capture
    this.detectSampleRate(deviceId).then((rate) => {
      if (this.intentionalStop) return; // User stopped before detection completed
      this.currentSampleRate = rate;
      this.spawnParec(deviceId);
    });
  }

  private spawnParec(deviceId: string): void {
    const rate = this.currentSampleRate || LinuxCapture.DEFAULT_SAMPLE_RATE;
    try {
      this.process = spawn('parec', [
        '--device', deviceId,
        '--rate', String(rate),
        '--channels', '2',
        '--format', 'float32le',
        '--raw',
        '--latency-msec', '10',
      ]);
      console.log(`parec started at ${rate} Hz on ${deviceId}`);
    } catch (error) {
      const msg = `Failed to spawn parec: ${error}`;
      console.error(msg);
      if (this.errorCallback) this.errorCallback(msg);
      this.scheduleReconnect();
      return;
    }

    // Handle spawn errors (e.g., parec not in PATH, permission denied)
    this.process.on('error', (error) => {
      const msg = `Audio capture process error: ${error.message}`;
      console.error(msg);
      this.process = null;
      if (this.errorCallback) this.errorCallback(msg);
      this.scheduleReconnect();
    });

    this.process.stdout?.on('data', (chunk: Buffer) => {
      // Reset reconnect counter on successful data — stream is healthy
      this.reconnectAttempts = 0;

      // Ensure byte-aligned for Float32 (4 bytes per sample)
      const alignedLength = chunk.byteLength - (chunk.byteLength % 4);
      if (alignedLength === 0) return;

      const samples = new Float32Array(chunk.buffer.slice(
        chunk.byteOffset,
        chunk.byteOffset + alignedLength
      ));

      if (this.dataCallback) {
        this.dataCallback(samples);
      }
    });

    this.process.stderr?.on('data', (data) => {
      const errorMsg = data.toString();
      console.error('Audio capture error:', errorMsg);
      if (this.errorCallback) {
        this.errorCallback(errorMsg);
      }
    });

    this.process.on('close', (code) => {
      this.process = null;

      if (this.intentionalStop) {
        // Normal stop — notify and don't reconnect
        console.log('Audio capture stopped (intentional)');
        if (this.closeCallback) this.closeCallback(code);
        return;
      }

      // Unexpected exit — attempt reconnect
      console.warn(`Audio capture exited unexpectedly (code: ${code}), will reconnect...`);
      if (this.closeCallback) this.closeCallback(code);
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.intentionalStop || !this.activeDeviceId) return;
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error(`Audio capture: gave up after ${this.MAX_RECONNECT_ATTEMPTS} reconnect attempts`);
      if (this.errorCallback) {
        this.errorCallback(`Audio capture failed after ${this.MAX_RECONNECT_ATTEMPTS} attempts. Check audio device.`);
      }
      return;
    }

    // Exponential backoff: 500ms, 1s, 2s, 4s, ... capped at 30s
    const delay = Math.min(
      this.BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts),
      this.MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempts++;

    console.log(`Audio capture: reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.intentionalStop && this.activeDeviceId) {
        this.spawnParec(this.activeDeviceId);
      }
    }, delay);
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
  }

  private stopInternal(): void {
    if (this.process) {
      try {
        this.process.kill('SIGTERM');
      } catch {
        // Process already dead
      }
      this.process = null;
    }
  }

  stop(): void {
    this.intentionalStop = true;
    this.cancelReconnect();
    this.stopInternal();
    this.activeDeviceId = null;
  }

  getSampleRate(): number {
    return this.currentSampleRate;
  }

  isCapturing(): boolean {
    return this.process !== null;
  }

  onData(callback: AudioDataCallback): void {
    this.dataCallback = callback;
  }

  onError(callback: AudioErrorCallback): void {
    this.errorCallback = callback;
  }

  onClose(callback: AudioCloseCallback): void {
    this.closeCallback = callback;
  }

  getPlatformName(): string {
    return 'Linux (PulseAudio/PipeWire)';
  }
}
