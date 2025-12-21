/**
 * Audio device information
 */
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

/**
 * Callback for receiving audio data
 */
export type AudioDataCallback = (samples: Float32Array) => void;

/**
 * Callback for capture errors
 */
export type AudioErrorCallback = (error: string) => void;

/**
 * Callback for capture process exit
 */
export type AudioCloseCallback = (code: number | null) => void;
