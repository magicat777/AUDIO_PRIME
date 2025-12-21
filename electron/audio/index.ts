/**
 * Audio Capture Module
 *
 * Linux-native audio capture using PulseAudio/PipeWire.
 * AUDIO_PRIME is a Linux-only application due to platform limitations
 * with pro audio capture on macOS and Windows via Electron.
 */

import { AudioCapture } from './AudioCapture';
import { LinuxCapture } from './LinuxCapture';

// Re-export types for convenience
export { AudioCapture } from './AudioCapture';
export { AudioDevice, AudioDataCallback, AudioErrorCallback, AudioCloseCallback } from './types';

/**
 * Creates an AudioCapture instance
 *
 * @returns LinuxCapture implementation
 * @throws Error if not running on Linux
 */
export function createAudioCapture(): AudioCapture {
  if (process.platform !== 'linux') {
    throw new Error(
      `AUDIO_PRIME only supports Linux. Current platform: ${process.platform}\n` +
      'See README for details on platform limitations.'
    );
  }
  return new LinuxCapture();
}

/**
 * Get the platform name for display
 */
export function getPlatformDisplayName(): string {
  return 'Linux (PulseAudio/PipeWire)';
}
