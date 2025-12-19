/**
 * Spectrum Shaping Algorithms for AUDIO_PRIME
 *
 * Provides perceptual weighting and enhancement to make
 * musical elements (vocals, instruments) more visible.
 */

const SAMPLE_RATE = 48000;
const FFT_SIZE = 4096;

export interface ShapingOptions {
  // Perceptual weighting
  aWeighting: boolean;      // A-weighting curve (ISO 226)
  pinkNoiseComp: boolean;   // +3dB/octave compensation

  // Frequency emphasis
  vocalBoost: number;       // 0-1, boost 1-4kHz vocal presence
  bassEnhance: number;      // 0-1, enhance sub-bass visibility

  // Dynamic shaping
  compression: number;      // 0-1, reduce dynamic range
  noiseFloor: number;       // dB, threshold below which to suppress

  // Smoothing
  smoothing: number;        // 0-1, temporal smoothing factor
}

export const DEFAULT_SHAPING: ShapingOptions = {
  aWeighting: false,
  pinkNoiseComp: true,
  vocalBoost: 0.3,
  bassEnhance: 0.2,
  compression: 0.3,
  noiseFloor: -70,
  smoothing: 0.7,
};

/**
 * A-weighting curve (simplified approximation)
 * Models human hearing sensitivity at moderate listening levels
 */
function getAWeighting(freq: number): number {
  if (freq < 10) return -70;

  const f2 = freq * freq;
  const f4 = f2 * f2;

  // Attempt to approximate A-weighting
  const ra = (12194 * 12194 * f4) /
    ((f2 + 20.6 * 20.6) *
     Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9)) *
     (f2 + 12194 * 12194));

  return 20 * Math.log10(ra) + 2.0; // +2dB correction
}

/**
 * Pink noise compensation (+3dB/octave)
 * Compensates for natural 1/f energy distribution
 */
function getPinkNoiseComp(freq: number): number {
  if (freq < 20) return 0;
  // +3dB per octave relative to 1kHz
  return 3 * Math.log2(freq / 1000);
}

/**
 * Vocal presence boost curve
 * Emphasizes 1-4kHz range where vocals and presence live
 */
function getVocalBoost(freq: number, amount: number): number {
  if (amount <= 0) return 0;

  // Bell curve centered at 2.5kHz with Q of about 1
  const centerFreq = 2500;
  const bandwidth = 2; // octaves
  const octavesFromCenter = Math.log2(freq / centerFreq);
  const boost = Math.exp(-0.5 * Math.pow(octavesFromCenter / (bandwidth / 2), 2));

  return boost * amount * 8; // Up to 8dB boost
}

/**
 * Bass enhancement curve
 * Makes sub-bass more visible without overwhelming
 */
function getBassEnhance(freq: number, amount: number): number {
  if (amount <= 0 || freq > 200) return 0;

  // Boost sub-bass (20-80Hz) more than bass (80-200Hz)
  const subBassBoost = Math.exp(-freq / 40) * amount * 12;
  return subBassBoost;
}

/**
 * Apply soft-knee compression to reduce dynamic range
 */
function applyCompression(db: number, amount: number): number {
  if (amount <= 0) return db;

  const threshold = -30;
  const ratio = 1 + amount * 3; // 1:1 to 4:1

  if (db > threshold) {
    const excess = db - threshold;
    return threshold + excess / ratio;
  }

  return db;
}

/**
 * Pre-computed shaping curves for performance
 */
export class SpectrumShaper {
  private options: ShapingOptions;
  private shapingCurve: Float32Array;
  private previousSpectrum: Float32Array;
  private binFrequencies: Float32Array;

  constructor(fftSize = FFT_SIZE, sampleRate = SAMPLE_RATE) {
    this.options = { ...DEFAULT_SHAPING };
    this.shapingCurve = new Float32Array(fftSize / 2);
    this.previousSpectrum = new Float32Array(fftSize / 2);
    this.binFrequencies = new Float32Array(fftSize / 2);

    // Pre-compute bin frequencies
    const binWidth = sampleRate / fftSize;
    for (let i = 0; i < fftSize / 2; i++) {
      this.binFrequencies[i] = i * binWidth;
    }

    this.updateShapingCurve();
  }

  setOptions(options: Partial<ShapingOptions>): void {
    this.options = { ...this.options, ...options };
    this.updateShapingCurve();
  }

  getOptions(): ShapingOptions {
    return { ...this.options };
  }

  private updateShapingCurve(): void {
    for (let i = 0; i < this.shapingCurve.length; i++) {
      const freq = this.binFrequencies[i];
      let gain = 0;

      // Apply A-weighting
      if (this.options.aWeighting) {
        gain += getAWeighting(freq);
      }

      // Apply pink noise compensation
      if (this.options.pinkNoiseComp) {
        gain += getPinkNoiseComp(freq);
      }

      // Apply vocal boost
      gain += getVocalBoost(freq, this.options.vocalBoost);

      // Apply bass enhancement
      gain += getBassEnhance(freq, this.options.bassEnhance);

      this.shapingCurve[i] = gain;
    }
  }

  /**
   * Process spectrum with shaping algorithms
   * Input: raw FFT magnitude in dB (0-100 range)
   * Output: shaped spectrum for display
   */
  process(spectrum: Float32Array): Float32Array {
    const output = new Float32Array(spectrum.length);
    const { compression, noiseFloor, smoothing } = this.options;

    for (let i = 0; i < spectrum.length; i++) {
      let value = spectrum[i];

      // Convert from 0-100 display range to dB (-100 to 0)
      let db = value - 100;

      // Apply shaping curve
      db += this.shapingCurve[i];

      // Apply noise floor gate - gentle suppression
      if (db < noiseFloor) {
        db = -100; // Below noise floor goes to zero
      }

      // Apply compression
      db = applyCompression(db, compression);

      // Convert back to display range (0-100)
      value = db + 100;

      // Clamp to valid range
      value = Math.max(0, Math.min(100, value));

      // Apply temporal smoothing
      if (smoothing > 0) {
        value = this.previousSpectrum[i] * smoothing + value * (1 - smoothing);
      }

      output[i] = value;
      this.previousSpectrum[i] = value;
    }

    return output;
  }

  /**
   * Reset smoothing state
   */
  reset(): void {
    this.previousSpectrum.fill(0);
  }
}

/**
 * Preset shaping configurations
 */
export const SHAPING_PRESETS = {
  flat: {
    aWeighting: false,
    pinkNoiseComp: false,
    vocalBoost: 0,
    bassEnhance: 0,
    compression: 0,
    noiseFloor: -80,
    smoothing: 0.5,
  } as ShapingOptions,

  music: {
    aWeighting: false,
    pinkNoiseComp: true,
    vocalBoost: 0.3,
    bassEnhance: 0.2,
    compression: 0.3,
    noiseFloor: -70,
    smoothing: 0.7,
  } as ShapingOptions,

  vocals: {
    aWeighting: false,
    pinkNoiseComp: true,
    vocalBoost: 0.6,
    bassEnhance: 0,
    compression: 0.4,
    noiseFloor: -65,
    smoothing: 0.6,
  } as ShapingOptions,

  bass: {
    aWeighting: false,
    pinkNoiseComp: false,
    vocalBoost: 0,
    bassEnhance: 0.5,
    compression: 0.2,
    noiseFloor: -75,
    smoothing: 0.8,
  } as ShapingOptions,

  broadcast: {
    aWeighting: true,
    pinkNoiseComp: true,
    vocalBoost: 0.4,
    bassEnhance: 0.1,
    compression: 0.5,
    noiseFloor: -60,
    smoothing: 0.7,
  } as ShapingOptions,
};
