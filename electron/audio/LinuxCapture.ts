import { spawn, ChildProcess } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';
import { AudioCapture } from './AudioCapture';
import { AudioDevice, AudioDataCallback, AudioErrorCallback, AudioCloseCallback } from './types';

const execAsync = promisify(exec);

/**
 * Linux audio capture implementation using PulseAudio/PipeWire via parec
 */
export class LinuxCapture implements AudioCapture {
  private process: ChildProcess | null = null;
  private dataCallback: AudioDataCallback | null = null;
  private errorCallback: AudioErrorCallback | null = null;
  private closeCallback: AudioCloseCallback | null = null;

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

  start(deviceId: string): void {
    // Stop any existing capture
    if (this.process) {
      this.process.kill();
    }

    // Use parec for PipeWire/PulseAudio capture with low latency
    this.process = spawn('parec', [
      '--device', deviceId,
      '--rate', '48000',
      '--channels', '2',
      '--format', 'float32le',
      '--raw',
      '--latency-msec', '10',  // Minimize capture latency
    ]);

    this.process.stdout?.on('data', (chunk: Buffer) => {
      // Convert raw bytes to Float32Array
      const samples = new Float32Array(chunk.buffer.slice(
        chunk.byteOffset,
        chunk.byteOffset + chunk.byteLength
      ));

      // Send to registered callback
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
      console.log('Audio capture process exited with code:', code);
      this.process = null;
      if (this.closeCallback) {
        this.closeCallback(code);
      }
    });
  }

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
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
