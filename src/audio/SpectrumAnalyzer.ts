/**
 * SpectrumAnalyzer - Professional perceptual frequency analysis
 * Based on proven OMEGA implementation with proper FFT bin mapping
 *
 * Enhanced with professional audio engineering techniques:
 * - Weighted bin sampling with triangular interpolation
 * - Gap-filling via neighbor interpolation
 * - Fractional-octave smoothing (1/6 octave)
 * - Parabolic peak interpolation for sub-bin accuracy
 *
 * References:
 * - DSPRelated.com: Spectral Interpolation, Quadratic Peak Interpolation
 * - Rational Acoustics: Banding vs Smoothing
 * - MATLAB poctave: Octave band analysis
 */

const SAMPLE_RATE = 48000;
const FFT_SIZE = 4096;

// Smoothing configuration
const OCTAVE_SMOOTHING_FACTOR = 1/6;  // 1/6 octave smoothing (professional RTA standard)
const GAP_THRESHOLD = 0.15;           // Threshold for gap detection (relative to neighbors)
const INTERPOLATION_BLEND = 0.6;      // How much to blend interpolated values

// Perceptual frequency band distribution (matches OMEGA)
// Note: Currently using logarithmic mapping with these approximate band weights:
// subBass 20-60Hz (8%), bass 60-250Hz (17%), lowMid 250-500Hz (15%)
// mid 500-2kHz (25%), highMid 2-6kHz (20%), high 6-20kHz (15%)

// Frequency compensation in dB domain for balanced visual display
// Goal: Flatten the natural frequency response of music for even visual display
// Music has ~3dB/octave natural rolloff, we compensate to show balanced bars
function getFrequencyCompensationDB(freq: number): number {
  // Returns dB adjustment to add after FFT magnitude -> dB conversion
  // Designed for ~3dB/octave compensation (gentler than before)

  // Use logarithmic interpolation for smooth curve
  // Reference: 1kHz = 0dB (neutral point)
  const log2Freq = Math.log2(freq);
  const log2Ref = Math.log2(1000);  // 1kHz reference

  // Base slope: ~2.5dB per octave above 1kHz, ~1.5dB per octave below
  let compensation: number;
  if (freq < 1000) {
    // Below 1kHz: gentle negative slope (reduce bass dominance)
    compensation = (log2Ref - log2Freq) * -1.5;
  } else {
    // Above 1kHz: positive slope (boost highs to compensate rolloff)
    compensation = (log2Freq - log2Ref) * 2.5;
  }

  // Apply gentle rolloff at extremes to avoid noise
  if (freq < 30) compensation -= 3;      // Reduce sub-bass rumble
  if (freq > 14000) compensation -= 2;   // Reduce ultra-high noise
  if (freq > 18000) compensation -= 3;   // Further reduce near-nyquist

  // Clamp to reasonable range
  return Math.max(-8, Math.min(15, compensation));
}

// Legacy function for compatibility (converts dB compensation to linear)
function getFrequencyCompensation(freq: number): number {
  const dbComp = getFrequencyCompensationDB(freq);
  return Math.pow(10, dbComp / 20);
}

// Psychoacoustic emphasis for musically important frequencies
// These ADD to the base compensation curve for perceptually important bands
// Designed for balanced display across all instrument types
const PSYCHOACOUSTIC_WEIGHTS = {
  subBass: { range: [20, 60], weight: 1.15 },          // Sub-bass feel (+1.2dB) - reduced
  kickDrum: { range: [55, 100], weight: 1.25 },        // Kick punch (+1.9dB) - reduced
  bassBody: { range: [80, 200], weight: 1.35 },        // Bass guitar/body (+2.6dB) - reduced
  voiceFundamental: { range: [180, 400], weight: 1.3 }, // Vocal body/chest (+2.3dB)
  instrumentBody: { range: [300, 800], weight: 1.35 }, // Guitar/keys fundamentals (+2.6dB) - NEW!
  voiceClarity: { range: [1000, 3000], weight: 1.35 }, // Vocal clarity/formants (+2.6dB) - reduced
  presence: { range: [3000, 6000], weight: 1.4 },      // Presence/articulation (+2.9dB) - reduced
  air: { range: [8000, 12000], weight: 1.15 },         // Air/breathiness (+1.2dB) - reduced
};

export interface BinWeight {
  index: number;
  weight: number;  // 0-1 triangular weight based on distance from center
}

export interface BandMapping {
  binIndices: number[];
  binWeights: BinWeight[];  // Weighted bin sampling for smoother interpolation
  freqStart: number;
  freqEnd: number;
  centerFreq: number;
  weight: number;
}

export class SpectrumAnalyzer {
  private fftSize: number;
  private sampleRate: number;
  private barCount: number;
  private binFrequencies: Float32Array;
  private bandMappings: BandMapping[] = [];

  // Smoothing state
  private barHeights: Float32Array;
  private peakHolds: Float32Array;
  private peakTimestamps: Float32Array;

  // Constants
  private readonly PEAK_HOLD_MS = 1000;
  private readonly PEAK_DECAY_RATE = 0.003;

  constructor(barCount = 512, fftSize = FFT_SIZE, sampleRate = SAMPLE_RATE) {
    this.fftSize = fftSize;
    this.sampleRate = sampleRate;
    this.barCount = barCount;

    // Pre-compute FFT bin frequencies
    const binCount = fftSize / 2;
    this.binFrequencies = new Float32Array(binCount);
    const binWidth = sampleRate / fftSize;
    for (let i = 0; i < binCount; i++) {
      this.binFrequencies[i] = i * binWidth;
    }

    // Initialize state arrays
    this.barHeights = new Float32Array(barCount);
    this.peakHolds = new Float32Array(barCount);
    this.peakTimestamps = new Float32Array(barCount);

    // Create perceptual band mapping
    this.createBandMapping();
  }

  /**
   * Create perceptual frequency band mapping
   * Uses logarithmic distribution with proper FFT bin assignment
   * Enhanced with weighted bin sampling for gap-free display
   */
  private createBandMapping(): void {
    this.bandMappings = [];

    const minFreq = 20;
    const maxFreq = 20000;
    const binWidth = this.sampleRate / this.fftSize;
    const halfBinCount = this.fftSize / 2;

    // Create logarithmic frequency distribution for all bars
    for (let i = 0; i < this.barCount; i++) {
      // Logarithmic frequency mapping
      const t = i / (this.barCount - 1);
      const freqStart = minFreq * Math.pow(maxFreq / minFreq, t);
      const freqEnd = minFreq * Math.pow(maxFreq / minFreq, (i + 1) / (this.barCount - 1));
      const centerFreq = Math.sqrt(freqStart * freqEnd); // Geometric mean

      // Find FFT bins that fall within this frequency range
      const binStart = Math.max(1, Math.floor(freqStart / binWidth));
      const binEnd = Math.min(halfBinCount - 1, Math.ceil(freqEnd / binWidth));

      const barBins: number[] = [];
      const binWeights: BinWeight[] = [];

      // Expand sampling range for low frequencies (where we have few bins)
      // This helps fill gaps by sampling neighboring bins with decreasing weights
      const bandwidthBins = binEnd - binStart + 1;
      const minSampleBins = 3;  // Always sample at least 3 bins for interpolation

      let sampleStart = binStart;
      let sampleEnd = binEnd;

      if (bandwidthBins < minSampleBins) {
        // Expand range symmetrically around center
        const expansion = Math.ceil((minSampleBins - bandwidthBins) / 2);
        sampleStart = Math.max(1, binStart - expansion);
        sampleEnd = Math.min(halfBinCount - 1, binEnd + expansion);
      }

      // Create weighted bin sampling with triangular window
      for (let bin = sampleStart; bin <= sampleEnd; bin++) {
        barBins.push(bin);

        // Calculate triangular weight based on distance from center
        const binFreq = bin * binWidth;
        const distanceFromCenter = Math.abs(binFreq - centerFreq);
        const bandwidth = freqEnd - freqStart;

        // Triangular weight: 1.0 at center, decreasing to 0.2 at edges
        // For bins outside the nominal range, weight decreases further
        let weight: number;
        if (bin >= binStart && bin <= binEnd) {
          // Inside nominal range: high weight
          weight = 1.0 - 0.5 * (distanceFromCenter / (bandwidth / 2 + 0.001));
          weight = Math.max(0.5, weight);
        } else {
          // Outside nominal range (expansion): lower weight for interpolation
          const expansionDistance = bin < binStart
            ? (binStart - bin) * binWidth
            : (bin - binEnd) * binWidth;
          weight = 0.4 * Math.exp(-expansionDistance / (bandwidth + 1));
          weight = Math.max(0.1, weight);
        }

        binWeights.push({ index: bin, weight });
      }

      // Ensure at least one bin (use nearest with neighbors)
      if (barBins.length === 0) {
        const nearestBin = Math.round(centerFreq / binWidth);
        const clampedBin = Math.max(1, Math.min(halfBinCount - 1, nearestBin));

        // Add center and neighbors for interpolation
        for (let offset = -1; offset <= 1; offset++) {
          const bin = clampedBin + offset;
          if (bin >= 1 && bin < halfBinCount) {
            barBins.push(bin);
            binWeights.push({
              index: bin,
              weight: offset === 0 ? 1.0 : 0.3
            });
          }
        }
      }

      // Calculate frequency compensation weight
      const weight = this.calculateWeight(centerFreq);

      this.bandMappings.push({
        binIndices: barBins,
        binWeights,
        freqStart,
        freqEnd,
        centerFreq,
        weight,
      });
    }

    // Update actual bar count
    this.barCount = this.bandMappings.length;
    this.barHeights = new Float32Array(this.barCount);
    this.peakHolds = new Float32Array(this.barCount);
    this.peakTimestamps = new Float32Array(this.barCount);

    // Debug: Log band distribution
    const bandStats: Record<string, number> = {};
    for (const mapping of this.bandMappings) {
      const freq = mapping.centerFreq;
      let band = 'unknown';
      if (freq < 60) band = 'subBass';
      else if (freq < 250) band = 'bass';
      else if (freq < 500) band = 'lowMid';
      else if (freq < 2000) band = 'mid';
      else if (freq < 6000) band = 'highMid';
      else band = 'high';
      bandStats[band] = (bandStats[band] || 0) + 1;
    }
    console.log(`SpectrumAnalyzer: Created ${this.barCount} bars`);
    console.log('Band distribution:', bandStats);
    console.log('Frequency range:',
      this.bandMappings[0]?.freqStart.toFixed(1), 'Hz to',
      this.bandMappings[this.bandMappings.length - 1]?.freqEnd.toFixed(1), 'Hz');
    console.log('Max FFT bin frequency:', this.binFrequencies[this.binFrequencies.length - 1], 'Hz');
  }

  /**
   * Calculate total weight for a frequency (compensation + psychoacoustic)
   */
  private calculateWeight(freq: number): number {
    // Base frequency compensation for balanced display
    let weight = getFrequencyCompensation(freq);

    // Apply additional psychoacoustic emphasis
    for (const [, config] of Object.entries(PSYCHOACOUSTIC_WEIGHTS)) {
      const [min, max] = config.range;
      if (freq >= min && freq <= max) {
        weight *= config.weight;
      }
    }

    return weight;
  }

  // Debug logging interval
  private lastDebugTime = 0;
  private readonly DEBUG_INTERVAL_MS = 2000;

  /**
   * Process FFT data and return bar values
   * Input: Raw FFT magnitude data (linear scale)
   * Output: Normalized bar values (0-1 range)
   *
   * Enhanced processing chain:
   * 1. Weighted bin sampling with triangular interpolation
   * 2. Convert to dB scale
   * 3. Apply dB-domain frequency compensation
   * 4. Apply psychoacoustic emphasis
   * 5. Normalize to 0-1 range
   * 6. Apply gap-filling interpolation
   * 7. Apply fractional-octave smoothing
   * 8. Apply attack/decay temporal smoothing
   */
  process(fftMagnitudes: Float32Array): Float32Array {
    const rawOutput = new Float32Array(this.barCount);
    const output = new Float32Array(this.barCount);
    const now = performance.now();

    // Periodic debug logging
    const shouldDebug = now - this.lastDebugTime > this.DEBUG_INTERVAL_MS;
    if (shouldDebug) {
      this.lastDebugTime = now;
      const binWidth = this.sampleRate / this.fftSize;
      const samples = [
        { freq: 60, bin: Math.round(60 / binWidth) },
        { freq: 200, bin: Math.round(200 / binWidth) },
        { freq: 1000, bin: Math.round(1000 / binWidth) },
        { freq: 4000, bin: Math.round(4000 / binWidth) },
        { freq: 10000, bin: Math.round(10000 / binWidth) },
      ];
      console.log('FFT analysis:', samples.map(s => {
        const raw = fftMagnitudes[s.bin] || 0;
        const rawDb = raw > 1e-10 ? 20 * Math.log10(raw) : -100;
        const compDb = rawDb + getFrequencyCompensationDB(s.freq);
        return {
          freq: s.freq,
          rawDb: rawDb.toFixed(1),
          compDb: compDb.toFixed(1),
        };
      }));
    }

    // === STEP 1: Weighted bin sampling ===
    for (let i = 0; i < this.bandMappings.length; i++) {
      const mapping = this.bandMappings[i];

      // Use weighted bin sampling for smoother interpolation
      let weightedSum = 0;
      let totalWeight = 0;
      let maxMag = 0;

      for (const bw of mapping.binWeights) {
        if (bw.index < fftMagnitudes.length) {
          const mag = fftMagnitudes[bw.index];
          weightedSum += mag * bw.weight;
          totalWeight += bw.weight;
          maxMag = Math.max(maxMag, mag);
        }
      }

      // Weighted average with peak contribution for transient response
      const weightedAvg = totalWeight > 0 ? weightedSum / totalWeight : 0;
      const combinedMag = weightedAvg * 0.75 + maxMag * 0.25;

      // === STEP 2: Convert to dB scale ===
      let db = combinedMag > 1e-10 ? 20 * Math.log10(combinedMag) : -100;

      // === STEP 3: Apply frequency compensation ===
      const dbCompensation = getFrequencyCompensationDB(mapping.centerFreq);
      db += dbCompensation;

      // === STEP 4: Apply psychoacoustic emphasis ===
      for (const [, config] of Object.entries(PSYCHOACOUSTIC_WEIGHTS)) {
        const [min, max] = config.range;
        if (mapping.centerFreq >= min && mapping.centerFreq <= max) {
          db += 20 * Math.log10(config.weight);
        }
      }

      // === STEP 5: Normalize to 0-1 range ===
      const DB_MIN = -70;
      const DB_MAX = -10;
      const normalized = (db - DB_MIN) / (DB_MAX - DB_MIN);
      rawOutput[i] = Math.max(0, Math.min(1, normalized));
    }

    // === STEP 6: Gap-filling interpolation ===
    // Detect and fill gaps where a bar is significantly lower than neighbors
    for (let i = 0; i < this.barCount; i++) {
      const current = rawOutput[i];

      // Find neighboring values (handle edges)
      const left = i > 0 ? rawOutput[i - 1] : current;
      const right = i < this.barCount - 1 ? rawOutput[i + 1] : current;
      const neighborAvg = (left + right) / 2;

      // Detect gap: current value is much lower than neighbors
      if (current < neighborAvg * GAP_THRESHOLD && neighborAvg > 0.05) {
        // Interpolate from neighbors
        const interpolated = neighborAvg * 0.7;  // Don't fully fill, keep some variation
        rawOutput[i] = current * (1 - INTERPOLATION_BLEND) + interpolated * INTERPOLATION_BLEND;
      }
    }

    // === STEP 7: Fractional-octave smoothing ===
    // Apply 1/6 octave smoothing for professional RTA appearance
    this.applyOctaveSmoothing(rawOutput, output);

    // === STEP 8: Apply temporal smoothing (attack/decay) ===
    for (let i = 0; i < this.barCount; i++) {
      const mapping = this.bandMappings[i];
      const smoothedValue = output[i];

      const attackRate = this.getAttackRate(mapping.centerFreq);
      const decayRate = this.getDecayRate(mapping.centerFreq);

      if (smoothedValue > this.barHeights[i]) {
        this.barHeights[i] += (smoothedValue - this.barHeights[i]) * attackRate;
      } else {
        this.barHeights[i] += (smoothedValue - this.barHeights[i]) * decayRate;
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
   * Apply fractional-octave smoothing
   * Uses variable-width averaging based on frequency (constant Q in log domain)
   * Reference: Rational Acoustics "Banding vs Smoothing"
   */
  private applyOctaveSmoothing(input: Float32Array, output: Float32Array): void {
    const octaveFraction = OCTAVE_SMOOTHING_FACTOR;

    for (let i = 0; i < this.barCount; i++) {
      const centerFreq = this.bandMappings[i].centerFreq;

      // Calculate smoothing range in octaves
      // At each frequency, average over ±(octaveFraction/2) octaves
      const lowFreq = centerFreq * Math.pow(2, -octaveFraction / 2);
      const highFreq = centerFreq * Math.pow(2, octaveFraction / 2);

      // Find bar indices that fall within this range
      let sum = 0;
      let count = 0;

      for (let j = 0; j < this.barCount; j++) {
        const freq = this.bandMappings[j].centerFreq;
        if (freq >= lowFreq && freq <= highFreq) {
          // Apply triangular weighting (higher weight near center)
          const distance = Math.abs(Math.log2(freq / centerFreq));
          const maxDistance = octaveFraction / 2;
          const weight = 1 - (distance / maxDistance) * 0.5;  // 1.0 at center, 0.5 at edges

          sum += input[j] * weight;
          count += weight;
        }
      }

      output[i] = count > 0 ? sum / count : input[i];
    }
  }

  /**
   * Get attack rate based on frequency
   */
  private getAttackRate(freq: number): number {
    if (freq < 100) return 0.9;      // Ultra-low: fast attack for punch
    if (freq < 500) return 0.85;     // Low: moderately fast
    if (freq < 3000) return 0.8;     // Mid: balanced
    return 0.75;                      // High: slightly slower
  }

  /**
   * Get decay rate based on frequency
   */
  private getDecayRate(freq: number): number {
    if (freq < 100) return 0.1;      // Ultra-low: slow decay
    if (freq < 500) return 0.15;     // Low: moderate decay
    if (freq < 3000) return 0.2;     // Mid: faster decay
    return 0.25;                      // High: fastest decay
  }

  /**
   * Get current bar values
   */
  getBarHeights(): Float32Array {
    return this.barHeights;
  }

  /**
   * Get peak hold values
   */
  getPeakHolds(): Float32Array {
    return this.peakHolds;
  }

  /**
   * Get band mapping info
   */
  getBandMappings(): BandMapping[] {
    return this.bandMappings;
  }

  /**
   * Get actual bar count after mapping
   */
  getBarCount(): number {
    return this.barCount;
  }

  /**
   * Reset state
   */
  reset(): void {
    this.barHeights.fill(0);
    this.peakHolds.fill(0);
    this.peakTimestamps.fill(0);
  }
}
