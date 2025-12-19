/**
 * MultiResolutionSpectrumAnalyzer - Merges multi-resolution FFT bands into unified display
 *
 * Takes band-specific FFT data at optimal resolutions and maps to 512 logarithmic bars.
 * Each frequency band uses the FFT size that provides optimal resolution for that range.
 */

const _SAMPLE_RATE = 48000; // eslint-disable-line @typescript-eslint/no-unused-vars

// Band configurations matching FFTWorker
const BAND_CONFIGS = {
  subBass: { minFreq: 20, maxFreq: 60, fftSize: 8192 },
  bass: { minFreq: 60, maxFreq: 250, fftSize: 4096 },
  lowMid: { minFreq: 250, maxFreq: 1000, fftSize: 2048 },
  mid: { minFreq: 1000, maxFreq: 4000, fftSize: 2048 },
  high: { minFreq: 4000, maxFreq: 20000, fftSize: 1024 },
};

// Frequency compensation in dB domain (matching SpectrumAnalyzer)
function getFrequencyCompensationDB(freq: number): number {
  const log2Freq = Math.log2(freq);
  const log2Ref = Math.log2(1000);

  let compensation: number;
  if (freq < 1000) {
    compensation = (log2Ref - log2Freq) * -1.5;
  } else {
    compensation = (log2Freq - log2Ref) * 2.5;
  }

  if (freq < 30) compensation -= 3;
  if (freq > 14000) compensation -= 2;
  if (freq > 18000) compensation -= 3;

  return Math.max(-8, Math.min(15, compensation));
}

// Psychoacoustic weights (matching SpectrumAnalyzer)
const PSYCHOACOUSTIC_WEIGHTS = {
  kickDrum: { range: [60, 120], weight: 1.25 },
  voiceFundamental: { range: [150, 400], weight: 1.3 },
  voiceClarity: { range: [1000, 3000], weight: 1.4 },
  presence: { range: [3000, 6000], weight: 1.5 },
  subBass: { range: [20, 60], weight: 1.2 },
  air: { range: [8000, 12000], weight: 1.2 },
};

export interface MultiResolutionBands {
  subBass: Float32Array;
  bass: Float32Array;
  lowMid: Float32Array;
  mid: Float32Array;
  high: Float32Array;
}

export interface MultiResolutionFrequencies {
  subBass: Float32Array;
  bass: Float32Array;
  lowMid: Float32Array;
  mid: Float32Array;
  high: Float32Array;
}

export class MultiResolutionSpectrumAnalyzer {
  private barCount: number;
  private barHeights: Float32Array;
  private peakHolds: Float32Array;
  private peakTimestamps: Float32Array;

  // Bar to frequency mapping
  private barFrequencies: Float32Array;

  private readonly PEAK_HOLD_MS = 1000;
  private readonly PEAK_DECAY_RATE = 0.003;

  // Normalization range (dB)
  private readonly DB_MIN = -70;
  private readonly DB_MAX = -10;

  constructor(barCount = 512) {
    this.barCount = barCount;
    this.barHeights = new Float32Array(barCount);
    this.peakHolds = new Float32Array(barCount);
    this.peakTimestamps = new Float32Array(barCount);

    // Pre-compute bar center frequencies (logarithmic distribution)
    this.barFrequencies = new Float32Array(barCount);
    const minFreq = 20;
    const maxFreq = 20000;
    for (let i = 0; i < barCount; i++) {
      const t = i / (barCount - 1);
      this.barFrequencies[i] = minFreq * Math.pow(maxFreq / minFreq, t);
    }
  }

  /**
   * Process multi-resolution FFT bands and merge into unified bar output
   */
  process(bands: MultiResolutionBands, frequencies: MultiResolutionFrequencies): Float32Array {
    const output = new Float32Array(this.barCount);
    const now = performance.now();

    for (let i = 0; i < this.barCount; i++) {
      const targetFreq = this.barFrequencies[i];

      // Find which band this frequency belongs to and get magnitude
      let magnitude = 0;

      if (targetFreq < BAND_CONFIGS.subBass.maxFreq) {
        magnitude = this.interpolateBand(targetFreq, bands.subBass, frequencies.subBass);
      } else if (targetFreq < BAND_CONFIGS.bass.maxFreq) {
        magnitude = this.interpolateBand(targetFreq, bands.bass, frequencies.bass);
      } else if (targetFreq < BAND_CONFIGS.lowMid.maxFreq) {
        magnitude = this.interpolateBand(targetFreq, bands.lowMid, frequencies.lowMid);
      } else if (targetFreq < BAND_CONFIGS.mid.maxFreq) {
        magnitude = this.interpolateBand(targetFreq, bands.mid, frequencies.mid);
      } else {
        magnitude = this.interpolateBand(targetFreq, bands.high, frequencies.high);
      }

      // Convert to dB
      let db = magnitude > 1e-10 ? 20 * Math.log10(magnitude) : -100;

      // Apply frequency compensation
      db += getFrequencyCompensationDB(targetFreq);

      // Apply psychoacoustic emphasis
      for (const [, config] of Object.entries(PSYCHOACOUSTIC_WEIGHTS)) {
        const [min, max] = config.range;
        if (targetFreq >= min && targetFreq <= max) {
          db += 20 * Math.log10(config.weight);
        }
      }

      // Normalize to 0-1
      let normalized = (db - this.DB_MIN) / (this.DB_MAX - this.DB_MIN);
      normalized = Math.max(0, Math.min(1, normalized));

      // Apply smoothing
      const attackRate = this.getAttackRate(targetFreq);
      const decayRate = this.getDecayRate(targetFreq);

      if (normalized > this.barHeights[i]) {
        this.barHeights[i] += (normalized - this.barHeights[i]) * attackRate;
      } else {
        this.barHeights[i] += (normalized - this.barHeights[i]) * decayRate;
      }

      output[i] = this.barHeights[i];

      // Update peak hold
      if (this.barHeights[i] > this.peakHolds[i]) {
        this.peakHolds[i] = this.barHeights[i];
        this.peakTimestamps[i] = now;
      } else if (now - this.peakTimestamps[i] > this.PEAK_HOLD_MS) {
        this.peakHolds[i] = Math.max(0, this.peakHolds[i] - this.PEAK_DECAY_RATE);
      }
    }

    return output;
  }

  /**
   * Interpolate magnitude at target frequency from band data
   */
  private interpolateBand(targetFreq: number, magnitudes: Float32Array, frequencies: Float32Array): number {
    if (magnitudes.length === 0 || frequencies.length === 0) return 0;

    // Find surrounding frequency bins
    let lowIdx = 0;
    let highIdx = frequencies.length - 1;

    for (let i = 0; i < frequencies.length - 1; i++) {
      if (frequencies[i] <= targetFreq && frequencies[i + 1] > targetFreq) {
        lowIdx = i;
        highIdx = i + 1;
        break;
      }
    }

    // Clamp to band edges
    if (targetFreq <= frequencies[0]) return magnitudes[0];
    if (targetFreq >= frequencies[frequencies.length - 1]) return magnitudes[magnitudes.length - 1];

    // Linear interpolation
    const t = (targetFreq - frequencies[lowIdx]) / (frequencies[highIdx] - frequencies[lowIdx]);
    return magnitudes[lowIdx] * (1 - t) + magnitudes[highIdx] * t;
  }

  private getAttackRate(freq: number): number {
    if (freq < 100) return 0.9;
    if (freq < 500) return 0.85;
    if (freq < 3000) return 0.8;
    return 0.75;
  }

  private getDecayRate(freq: number): number {
    if (freq < 100) return 0.1;
    if (freq < 500) return 0.15;
    if (freq < 3000) return 0.2;
    return 0.25;
  }

  getPeakHolds(): Float32Array {
    return this.peakHolds;
  }

  getBarCount(): number {
    return this.barCount;
  }

  reset(): void {
    this.barHeights.fill(0);
    this.peakHolds.fill(0);
    this.peakTimestamps.fill(0);
  }
}
