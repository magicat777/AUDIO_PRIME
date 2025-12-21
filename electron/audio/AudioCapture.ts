import { AudioDevice, AudioDataCallback, AudioErrorCallback, AudioCloseCallback } from './types';

/**
 * Interface for audio capture
 *
 * Implementation:
 * - LinuxCapture: PulseAudio/PipeWire via parec
 *
 * Note: AUDIO_PRIME is Linux-only. macOS and Windows are not supported
 * due to Electron/Chromium limitations with pro audio capture.
 */
export interface AudioCapture {
  /**
   * Get list of available audio devices/sources
   */
  listDevices(): Promise<AudioDevice[]>;

  /**
   * Start capturing audio from the specified device
   * @param deviceId - Platform-specific device identifier
   */
  start(deviceId: string): void;

  /**
   * Stop the current audio capture
   */
  stop(): void;

  /**
   * Check if capture is currently active
   */
  isCapturing(): boolean;

  /**
   * Register callback for audio data
   * @param callback - Receives Float32Array of audio samples (48kHz, stereo, interleaved)
   */
  onData(callback: AudioDataCallback): void;

  /**
   * Register callback for capture errors
   * @param callback - Receives error message string
   */
  onError(callback: AudioErrorCallback): void;

  /**
   * Register callback for capture process exit
   * @param callback - Receives exit code (0 = normal, non-zero = error)
   */
  onClose(callback: AudioCloseCallback): void;

  /**
   * Get the platform name for this capture implementation
   */
  getPlatformName(): string;
}
