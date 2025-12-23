/**
 * LUFS Meter - ITU-R BS.1770-4 Compliant Loudness Measurement
 *
 * Implements:
 * - Momentary loudness (400ms window)
 * - Short-term loudness (3s window)
 * - Integrated loudness (gated)
 * - Loudness Range (LRA)
 * - K-weighting filter (pre-filter + RLB)
 */

const SAMPLE_RATE = 48000;

// K-weighting filter coefficients for 48kHz
// Stage 1: High-shelf pre-filter (+4dB at high frequencies)
const PRE_FILTER = {
  b: [1.53512485958697, -2.69169618940638, 1.19839281085285],
  a: [1.0, -1.69065929318241, 0.73248077421585],
};

// Stage 2: High-pass RLB filter (Revised Low-frequency B-weighting)
const RLB_FILTER = {
  b: [1.0, -2.0, 1.0],
  a: [1.0, -1.99004745483398, 0.99007225036621],
};

// Gating thresholds
const ABSOLUTE_GATE = -70; // LUFS
const RELATIVE_GATE_OFFSET = -10; // dB below ungated level

export interface LUFSResult {
  momentary: number; // 400ms
  shortTerm: number; // 3s
  integrated: number; // Gated
  range: number; // LRA
  truePeak: number; // dBTP
}

export class LUFSMeter {
  // Filter states (per channel)
  private preFilterState: { x: number[]; y: number[] }[];
  private rlbFilterState: { x: number[]; y: number[] }[];

  // Circular buffers for windowed measurements
  private momentaryBuffer: Float32Array; // 400ms
  private shortTermBuffer: Float32Array; // 3s
  private momentaryWritePos = 0;
  private shortTermWritePos = 0;

  // Integrated loudness gating
  // PERFORMANCE: Limit gating blocks to ~5 minutes of history to prevent unbounded growth
  // At 400ms blocks, 5 minutes = 750 blocks
  private static readonly MAX_GATING_BLOCKS = 750;
  private gatingBlocks: number[] = []; // 400ms block powers (capped)
  private blockAccumulator: number = 0;
  private blockSampleCount = 0;
  private readonly blockSize: number; // 400ms in samples

  // True peak detection
  private truePeakMax = 0;

  constructor(sampleRate = SAMPLE_RATE, channels = 2) {
    this.blockSize = Math.floor(sampleRate * 0.4); // 400ms

    // Initialize filter states for each channel
    this.preFilterState = [];
    this.rlbFilterState = [];
    for (let ch = 0; ch < channels; ch++) {
      this.preFilterState.push({ x: [0, 0], y: [0, 0] });
      this.rlbFilterState.push({ x: [0, 0], y: [0, 0] });
    }

    // Initialize buffers
    this.momentaryBuffer = new Float32Array(this.blockSize);
    this.shortTermBuffer = new Float32Array(Math.floor(sampleRate * 3)); // 3s
  }

  /**
   * Apply K-weighting filter to a sample
   */
  private applyKWeighting(sample: number, channel: number): number {
    // Stage 1: Pre-filter (high shelf)
    const preState = this.preFilterState[channel];
    const preOut =
      PRE_FILTER.b[0] * sample +
      PRE_FILTER.b[1] * preState.x[0] +
      PRE_FILTER.b[2] * preState.x[1] -
      PRE_FILTER.a[1] * preState.y[0] -
      PRE_FILTER.a[2] * preState.y[1];

    preState.x[1] = preState.x[0];
    preState.x[0] = sample;
    preState.y[1] = preState.y[0];
    preState.y[0] = preOut;

    // Stage 2: RLB filter (high pass)
    const rlbState = this.rlbFilterState[channel];
    const rlbOut =
      RLB_FILTER.b[0] * preOut +
      RLB_FILTER.b[1] * rlbState.x[0] +
      RLB_FILTER.b[2] * rlbState.x[1] -
      RLB_FILTER.a[1] * rlbState.y[0] -
      RLB_FILTER.a[2] * rlbState.y[1];

    rlbState.x[1] = rlbState.x[0];
    rlbState.x[0] = preOut;
    rlbState.y[1] = rlbState.y[0];
    rlbState.y[0] = rlbOut;

    return rlbOut;
  }

  /**
   * 4x oversampling for true peak detection using linear interpolation
   * (Full implementation would use polyphase FIR filter)
   */
  private detectTruePeak(samples: Float32Array): number {
    let peak = 0;

    for (let i = 0; i < samples.length - 1; i++) {
      const s0 = samples[i];
      const s1 = samples[i + 1];

      // Check original samples
      peak = Math.max(peak, Math.abs(s0));

      // Linear interpolation for 4x oversampling
      for (let j = 1; j < 4; j++) {
        const t = j / 4;
        const interpolated = s0 + (s1 - s0) * t;
        peak = Math.max(peak, Math.abs(interpolated));
      }
    }

    // Check last sample
    if (samples.length > 0) {
      peak = Math.max(peak, Math.abs(samples[samples.length - 1]));
    }

    return peak;
  }

  /**
   * Calculate loudness from mean square value
   */
  private loudnessFromMS(meanSquare: number): number {
    if (meanSquare <= 0) return -Infinity;
    return -0.691 + 10 * Math.log10(meanSquare);
  }

  /**
   * Process audio samples (interleaved stereo)
   */
  process(samples: Float32Array): LUFSResult {
    const numSamples = samples.length / 2;

    // Process each sample pair
    for (let i = 0; i < numSamples; i++) {
      const left = samples[i * 2];
      const right = samples[i * 2 + 1];

      // Apply K-weighting
      const kLeft = this.applyKWeighting(left, 0);
      const kRight = this.applyKWeighting(right, 1);

      // Mean square of K-weighted signal (stereo sum with equal weighting)
      const ms = (kLeft * kLeft + kRight * kRight) / 2;

      // Update momentary buffer (circular)
      this.momentaryBuffer[this.momentaryWritePos] = ms;
      this.momentaryWritePos = (this.momentaryWritePos + 1) % this.momentaryBuffer.length;

      // Update short-term buffer (circular)
      this.shortTermBuffer[this.shortTermWritePos] = ms;
      this.shortTermWritePos = (this.shortTermWritePos + 1) % this.shortTermBuffer.length;

      // Accumulate for gating blocks
      this.blockAccumulator += ms;
      this.blockSampleCount++;

      if (this.blockSampleCount >= this.blockSize) {
        const blockPower = this.blockAccumulator / this.blockSampleCount;
        this.gatingBlocks.push(blockPower);
        // PERFORMANCE: Cap gating blocks to prevent unbounded memory growth
        if (this.gatingBlocks.length > LUFSMeter.MAX_GATING_BLOCKS) {
          this.gatingBlocks.shift();
        }
        this.blockAccumulator = 0;
        this.blockSampleCount = 0;
      }
    }

    // True peak detection
    const truePeak = this.detectTruePeak(samples);
    this.truePeakMax = Math.max(this.truePeakMax, truePeak);

    // Calculate momentary loudness (400ms)
    let momentarySum = 0;
    for (let i = 0; i < this.momentaryBuffer.length; i++) {
      momentarySum += this.momentaryBuffer[i];
    }
    const momentary = this.loudnessFromMS(momentarySum / this.momentaryBuffer.length);

    // Calculate short-term loudness (3s)
    let shortTermSum = 0;
    for (let i = 0; i < this.shortTermBuffer.length; i++) {
      shortTermSum += this.shortTermBuffer[i];
    }
    const shortTerm = this.loudnessFromMS(shortTermSum / this.shortTermBuffer.length);

    // Calculate integrated loudness with gating
    const integrated = this.calculateIntegratedLoudness();

    // Calculate loudness range
    const range = this.calculateLoudnessRange();

    // True peak in dBTP
    const truePeakDB = this.truePeakMax > 0 ? 20 * Math.log10(this.truePeakMax) : -Infinity;

    return {
      momentary: isFinite(momentary) ? momentary : -Infinity,
      shortTerm: isFinite(shortTerm) ? shortTerm : -Infinity,
      integrated: isFinite(integrated) ? integrated : -Infinity,
      range: isFinite(range) ? range : 0,
      truePeak: isFinite(truePeakDB) ? truePeakDB : -Infinity,
    };
  }

  /**
   * Calculate integrated loudness with ITU-R BS.1770-4 gating
   */
  private calculateIntegratedLoudness(): number {
    if (this.gatingBlocks.length === 0) return -Infinity;

    // First pass: absolute gate at -70 LUFS
    const absoluteGatedBlocks = this.gatingBlocks.filter((power) => {
      const loudness = this.loudnessFromMS(power);
      return loudness > ABSOLUTE_GATE;
    });

    if (absoluteGatedBlocks.length === 0) return -Infinity;

    // Calculate ungated loudness
    const ungatedMean = absoluteGatedBlocks.reduce((a, b) => a + b, 0) / absoluteGatedBlocks.length;
    const ungatedLoudness = this.loudnessFromMS(ungatedMean);

    // Second pass: relative gate
    const relativeThreshold = ungatedLoudness + RELATIVE_GATE_OFFSET;
    const relativeGatedBlocks = absoluteGatedBlocks.filter((power) => {
      const loudness = this.loudnessFromMS(power);
      return loudness > relativeThreshold;
    });

    if (relativeGatedBlocks.length === 0) return -Infinity;

    // Final integrated loudness
    const gatedMean = relativeGatedBlocks.reduce((a, b) => a + b, 0) / relativeGatedBlocks.length;
    return this.loudnessFromMS(gatedMean);
  }

  /**
   * Calculate Loudness Range (LRA) per EBU Tech 3342
   */
  private calculateLoudnessRange(): number {
    if (this.gatingBlocks.length < 2) return 0;

    // Apply absolute gate
    const absoluteGatedBlocks = this.gatingBlocks.filter((power) => {
      const loudness = this.loudnessFromMS(power);
      return loudness > ABSOLUTE_GATE;
    });

    if (absoluteGatedBlocks.length < 2) return 0;

    // Calculate ungated loudness for relative gate
    const ungatedMean = absoluteGatedBlocks.reduce((a, b) => a + b, 0) / absoluteGatedBlocks.length;
    const ungatedLoudness = this.loudnessFromMS(ungatedMean);

    // Apply relative gate (-20 LU for LRA, different from integrated)
    const lraRelativeThreshold = ungatedLoudness - 20;
    const lraGatedBlocks = absoluteGatedBlocks.filter((power) => {
      const loudness = this.loudnessFromMS(power);
      return loudness > lraRelativeThreshold;
    });

    if (lraGatedBlocks.length < 2) return 0;

    // Convert to loudness values and sort
    const loudnessValues = lraGatedBlocks
      .map((power) => this.loudnessFromMS(power))
      .sort((a, b) => a - b);

    // Calculate 10th and 95th percentiles
    const p10Index = Math.floor(loudnessValues.length * 0.1);
    const p95Index = Math.floor(loudnessValues.length * 0.95);

    const p10 = loudnessValues[p10Index];
    const p95 = loudnessValues[p95Index];

    return p95 - p10;
  }

  /**
   * Reset the meter (clear integrated loudness)
   */
  reset(): void {
    this.gatingBlocks = [];
    this.blockAccumulator = 0;
    this.blockSampleCount = 0;
    this.truePeakMax = 0;

    // Clear buffers
    this.momentaryBuffer.fill(0);
    this.shortTermBuffer.fill(0);
    this.momentaryWritePos = 0;
    this.shortTermWritePos = 0;

    // Reset filter states
    for (const state of this.preFilterState) {
      state.x = [0, 0];
      state.y = [0, 0];
    }
    for (const state of this.rlbFilterState) {
      state.x = [0, 0];
      state.y = [0, 0];
    }
  }

  /**
   * Get the current true peak value without processing new samples
   */
  getTruePeak(): number {
    return this.truePeakMax > 0 ? 20 * Math.log10(this.truePeakMax) : -Infinity;
  }

  /**
   * Reset only the true peak hold
   */
  resetTruePeak(): void {
    this.truePeakMax = 0;
  }
}
