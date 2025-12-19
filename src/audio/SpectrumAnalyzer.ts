/**
 * SpectrumAnalyzer - Professional perceptual frequency analysis
 * Based on proven OMEGA implementation with proper FFT bin mapping
 */

const SAMPLE_RATE = 48000;
const FFT_SIZE = 4096;

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
const PSYCHOACOUSTIC_WEIGHTS = {
  subBass: { range: [20, 60], weight: 1.2 },         // Sub-bass feel (+1.6dB)
  kickDrum: { range: [55, 100], weight: 1.3 },       // Kick punch (+2.3dB)
  bassBody: { range: [80, 200], weight: 1.45 },      // Bass guitar/body (+3.2dB) - fills gap
  voiceFundamental: { range: [180, 400], weight: 1.3 }, // Vocal body/chest (+2.3dB)
  voiceClarity: { range: [1000, 3000], weight: 1.4 }, // Vocal clarity/formants (+2.9dB)
  presence: { range: [3000, 6000], weight: 1.5 },    // Presence/articulation (+3.5dB)
  air: { range: [8000, 12000], weight: 1.2 },        // Air/breathiness (+1.6dB)
};

export interface BandMapping {
  binIndices: number[];
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
   */
  private createBandMapping(): void {
    this.bandMappings = [];

    const minFreq = 20;
    const maxFreq = 20000;
    const binWidth = this.sampleRate / this.fftSize;

    // Create logarithmic frequency distribution for all bars
    for (let i = 0; i < this.barCount; i++) {
      // Logarithmic frequency mapping
      const t = i / (this.barCount - 1);
      const freqStart = minFreq * Math.pow(maxFreq / minFreq, t);
      const freqEnd = minFreq * Math.pow(maxFreq / minFreq, (i + 1) / (this.barCount - 1));
      const centerFreq = Math.sqrt(freqStart * freqEnd); // Geometric mean

      // Find FFT bins that fall within this frequency range
      const binStart = Math.max(1, Math.floor(freqStart / binWidth));
      const binEnd = Math.min(this.fftSize / 2 - 1, Math.ceil(freqEnd / binWidth));

      const barBins: number[] = [];
      for (let bin = binStart; bin <= binEnd; bin++) {
        barBins.push(bin);
      }

      // Ensure at least one bin (use nearest)
      if (barBins.length === 0) {
        const nearestBin = Math.round(centerFreq / binWidth);
        barBins.push(Math.max(1, Math.min(this.fftSize / 2 - 1, nearestBin)));
      }

      // Calculate frequency compensation weight
      const weight = this.calculateWeight(centerFreq);

      this.bandMappings.push({
        binIndices: barBins,
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
   * Processing chain (matching OMEGA approach):
   * 1. Average FFT bins for each bar
   * 2. Convert to dB scale
   * 3. Apply dB-domain frequency compensation
   * 4. Apply psychoacoustic emphasis
   * 5. Normalize to 0-1 range
   * 6. Apply smoothing
   */
  process(fftMagnitudes: Float32Array): Float32Array {
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

    for (let i = 0; i < this.bandMappings.length; i++) {
      const mapping = this.bandMappings[i];

      // Average magnitude across bins for this bar (in linear domain)
      let sum = 0;
      let maxMag = 0;
      for (const binIdx of mapping.binIndices) {
        if (binIdx < fftMagnitudes.length) {
          const mag = fftMagnitudes[binIdx];
          sum += mag;
          maxMag = Math.max(maxMag, mag);
        }
      }

      // Use combination of average and peak for better visual response
      const avgMag = mapping.binIndices.length > 0 ? sum / mapping.binIndices.length : 0;
      const combinedMag = avgMag * 0.7 + maxMag * 0.3;

      // Convert to dB scale FIRST (before compensation)
      let db = combinedMag > 1e-10 ? 20 * Math.log10(combinedMag) : -100;

      // Apply frequency compensation in dB domain (much cleaner than linear)
      const dbCompensation = getFrequencyCompensationDB(mapping.centerFreq);
      db += dbCompensation;

      // Apply psychoacoustic emphasis (additional small boost for key frequencies)
      for (const [, config] of Object.entries(PSYCHOACOUSTIC_WEIGHTS)) {
        const [min, max] = config.range;
        if (mapping.centerFreq >= min && mapping.centerFreq <= max) {
          // Convert weight multiplier to dB and add
          db += 20 * Math.log10(config.weight);
        }
      }

      // Normalize to 0-1 range
      // FFT magnitudes for music typically range from -80dB (noise floor) to -20dB (loud)
      // After compensation, we want the display to show activity from floor to peak
      // Use -70dB to -10dB as our display range (60dB dynamic range)
      const DB_MIN = -70;
      const DB_MAX = -10;
      let normalized = (db - DB_MIN) / (DB_MAX - DB_MIN);
      normalized = Math.max(0, Math.min(1, normalized));

      // Apply attack/decay smoothing based on frequency
      const attackRate = this.getAttackRate(mapping.centerFreq);
      const decayRate = this.getDecayRate(mapping.centerFreq);

      if (normalized > this.barHeights[i]) {
        // Attack - fast rise
        this.barHeights[i] += (normalized - this.barHeights[i]) * attackRate;
      } else {
        // Decay - slower fall
        this.barHeights[i] += (normalized - this.barHeights[i]) * decayRate;
      }

      output[i] = this.barHeights[i];

      // Update peak hold
      if (this.barHeights[i] > this.peakHolds[i]) {
        this.peakHolds[i] = this.barHeights[i];
        this.peakTimestamps[i] = now;
      } else if (now - this.peakTimestamps[i] > this.PEAK_HOLD_MS) {
        // Decay peak
        this.peakHolds[i] = Math.max(
          0,
          this.peakHolds[i] - this.PEAK_DECAY_RATE
        );
      }
    }

    return output;
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
