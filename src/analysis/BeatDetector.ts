/**
 * BeatDetector - Real-time BPM detection and beat tracking
 *
 * Algorithm:
 * 1. Onset Detection: Spectral flux in frequency sub-bands (kick, snare, full)
 * 2. Tempo Estimation: Autocorrelation of onset signal (60-180 BPM range)
 * 3. Beat Tracking: Phase-aligned beat prediction with onset correction
 * 4. Confidence: Autocorrelation peak strength and consistency
 */

// Onset detection parameters
const ONSET_THRESHOLD = 0.02; // Minimum onset strength to register (very sensitive for real music)
const ONSET_DECAY = 0.92; // Adaptive threshold decay (faster decay for responsiveness)

// Tempo detection parameters
const MIN_BPM = 60;
const MAX_BPM = 180;
const TEMPO_HISTORY_SIZE = 6; // Number of tempo estimates to average

// Beat tracking parameters
const BEAT_PREDICT_WINDOW = 0.05; // 50ms window for beat prediction alignment
const PHASE_CORRECTION_RATE = 0.1; // How quickly to adjust phase

// Spectrum configuration (must match SpectrumAnalyzer output)
const SPECTRUM_BARS = 512;
const SPECTRUM_MIN_FREQ = 20;
const SPECTRUM_MAX_FREQ = 20000;

export interface BeatInfo {
  bpm: number; // Current tempo estimate
  confidence: number; // 0-1 confidence in tempo estimate
  beat: boolean; // True if a beat occurred this frame
  beatPhase: number; // 0-1 position within current beat
  beatStrength: number; // Strength of current beat (0-1)
  downbeat: boolean; // True if this is likely a downbeat (beat 1)
  beatCount: number; // Running count of detected beats
}

interface OnsetBand {
  name: string;
  minBar: number;
  maxBar: number;
  weight: number;
  prevEnergy: number;
  threshold: number;
}

/**
 * Convert frequency to spectrum bar index (logarithmic mapping)
 * Must match SpectrumAnalyzer's logarithmic distribution
 */
function freqToBar(freq: number): number {
  const t = Math.log(freq / SPECTRUM_MIN_FREQ) / Math.log(SPECTRUM_MAX_FREQ / SPECTRUM_MIN_FREQ);
  return Math.max(0, Math.min(SPECTRUM_BARS - 1, Math.floor(t * (SPECTRUM_BARS - 1))));
}

export class BeatDetector {
  // Onset detection
  private bands: OnsetBand[];
  private onsetHistory: Float32Array;
  private onsetWritePos: number = 0;
  private onsetHistorySize: number;

  // Tempo estimation
  private currentBPM: number = 120;
  private tempoHistory: number[] = [];
  private tempoConfidence: number = 0;
  private lastTempoUpdate: number = 0;
  private readonly TEMPO_UPDATE_INTERVAL = 500; // ms between tempo recalculations

  // Beat tracking
  private beatPhase: number = 0;
  private lastBeatTime: number = 0;
  private beatInterval: number = 500; // ms between beats (120 BPM default)
  private beatCount: number = 0;
  private downbeatCounter: number = 0;

  // Frame timing
  private lastProcessTime: number = 0;
  private frameTimeMs: number = 16.67; // Default to 60fps, will be updated

  // Silence detection
  private silenceStartTime: number = 0;
  private readonly SILENCE_THRESHOLD = 0.01; // Energy threshold for silence
  private readonly SILENCE_RESET_MS = 3000; // Reset after 3 seconds of silence

  // Debug
  private debugCounter: number = 0;

  constructor(_sampleRate = 48000, _fftSize = 4096) {
    // Note: sampleRate and fftSize params kept for API compatibility but not used
    // The spectrum input is already processed into 512 logarithmic bars

    // Initialize frequency bands for onset detection using logarithmic bar indices
    this.bands = [
      {
        name: 'kick',
        minBar: freqToBar(60),   // ~bar 50
        maxBar: freqToBar(150),  // ~bar 90
        weight: 2.0, // Emphasize kick strongly for beat detection
        prevEnergy: 0,
        threshold: ONSET_THRESHOLD,
      },
      {
        name: 'snare',
        minBar: freqToBar(150),  // ~bar 90
        maxBar: freqToBar(300),  // ~bar 120
        weight: 1.2,
        prevEnergy: 0,
        threshold: ONSET_THRESHOLD,
      },
      {
        name: 'hihat',
        minBar: freqToBar(3000), // ~bar 280
        maxBar: freqToBar(10000), // ~bar 380
        weight: 0.6, // Less weight for high frequencies
        prevEnergy: 0,
        threshold: ONSET_THRESHOLD,
      },
    ];

    // Onset history for autocorrelation (~6 seconds of history at 60fps)
    this.onsetHistorySize = 512;
    this.onsetHistory = new Float32Array(this.onsetHistorySize);
  }

  /**
   * Process spectrum data and detect beats
   * @param spectrum - Normalized spectrum data (0-1 per bin)
   * @returns Beat detection results
   */
  process(spectrum: Float32Array): BeatInfo {
    const now = performance.now();

    // Calculate frame time
    if (this.lastProcessTime > 0) {
      this.frameTimeMs = now - this.lastProcessTime;
    }
    this.lastProcessTime = now;

    // 1. Onset Detection - use combination of absolute energy and flux
    let totalOnset = 0;
    let kickOnset = 0;

    for (const band of this.bands) {
      const energy = this.calculateBandEnergy(spectrum, band.minBar, band.maxBar);
      const flux = Math.max(0, energy - band.prevEnergy);

      // Use both absolute energy and flux for onset detection
      // This helps detect beats even when energy is sustained
      const absoluteContribution = energy > band.threshold * 2 ? (energy - band.threshold) * 0.5 : 0;
      const fluxContribution = flux > band.threshold ? (flux - band.threshold) : 0;
      const combinedOnset = (absoluteContribution + fluxContribution) * band.weight;

      if (combinedOnset > 0) {
        totalOnset += combinedOnset;
        if (band.name === 'kick') {
          kickOnset = combinedOnset;
        }
        // Raise threshold after onset (adaptive)
        band.threshold = Math.max(ONSET_THRESHOLD, Math.max(energy, flux) * 0.7);
      } else {
        // Decay threshold
        band.threshold *= ONSET_DECAY;
        band.threshold = Math.max(ONSET_THRESHOLD, band.threshold);
      }

      band.prevEnergy = energy;
    }

    // Normalize onset strength (scale up for sensitivity)
    const onsetStrength = Math.min(1, totalOnset * 2);

    // Calculate total energy for silence detection
    const totalEnergy = this.bands.reduce((sum, band) => sum + band.prevEnergy, 0);

    // Silence detection - reset BPM if no sound for 3 seconds
    if (totalEnergy < this.SILENCE_THRESHOLD) {
      if (this.silenceStartTime === 0) {
        this.silenceStartTime = now;
      } else if (now - this.silenceStartTime > this.SILENCE_RESET_MS) {
        // Been silent for too long - reset to default state
        this.currentBPM = 0;
        this.tempoConfidence = 0;
        this.tempoHistory = [];
        this.beatPhase = 0;
        // Keep beat count for reference
      }
    } else {
      // Sound detected - reset silence timer
      this.silenceStartTime = 0;
      // If BPM was reset to 0, restore default
      if (this.currentBPM === 0) {
        this.currentBPM = 120;
      }
    }

    // Debug counter for internal tracking
    this.debugCounter++;

    // Store in history
    this.onsetHistory[this.onsetWritePos] = onsetStrength;
    this.onsetWritePos = (this.onsetWritePos + 1) % this.onsetHistorySize;

    // 2. Tempo Estimation - periodic autocorrelation update
    if (now - this.lastTempoUpdate > this.TEMPO_UPDATE_INTERVAL) {
      this.updateTempo();
      this.lastTempoUpdate = now;
    }

    // 3. Beat Tracking - phase-aligned prediction
    const beatResult = this.trackBeat(now, onsetStrength, kickOnset);

    return {
      bpm: Math.round(this.currentBPM),
      confidence: this.tempoConfidence,
      beat: beatResult.beat,
      beatPhase: this.beatPhase,
      beatStrength: onsetStrength,
      downbeat: beatResult.downbeat,
      beatCount: this.beatCount,
    };
  }

  /**
   * Calculate energy in a frequency band
   */
  private calculateBandEnergy(spectrum: Float32Array, minBin: number, maxBin: number): number {
    let energy = 0;
    const binCount = Math.min(maxBin, spectrum.length) - minBin;

    for (let i = minBin; i < Math.min(maxBin, spectrum.length); i++) {
      energy += spectrum[i] * spectrum[i];
    }

    return binCount > 0 ? Math.sqrt(energy / binCount) : 0;
  }

  /**
   * Update tempo estimate using autocorrelation
   */
  private updateTempo(): void {
    // Calculate autocorrelation of onset history
    const minLag = Math.floor((60 / MAX_BPM) * (1000 / this.frameTimeMs)); // ~20 frames for 180 BPM
    const maxLag = Math.floor((60 / MIN_BPM) * (1000 / this.frameTimeMs)); // ~60 frames for 60 BPM

    if (maxLag <= minLag || this.frameTimeMs <= 0) return;

    let bestLag = 0;
    let bestCorr = 0;

    // Calculate autocorrelation for each lag
    for (let lag = minLag; lag <= Math.min(maxLag, this.onsetHistorySize / 2); lag++) {
      let correlation = 0;
      let count = 0;

      for (let i = 0; i < this.onsetHistorySize - lag; i++) {
        const idx1 = (this.onsetWritePos - 1 - i + this.onsetHistorySize) % this.onsetHistorySize;
        const idx2 =
          (this.onsetWritePos - 1 - i - lag + this.onsetHistorySize) % this.onsetHistorySize;
        correlation += this.onsetHistory[idx1] * this.onsetHistory[idx2];
        count++;
      }

      if (count > 0) {
        correlation /= count;

        // Weight towards musically common tempos (90-130 BPM range)
        const bpmAtLag = (60 * 1000) / (lag * this.frameTimeMs);
        if (bpmAtLag >= 85 && bpmAtLag <= 135) {
          correlation *= 1.2;
        }

        if (correlation > bestCorr) {
          bestCorr = correlation;
          bestLag = lag;
        }
      }
    }

    if (bestLag > 0 && bestCorr > 0.01) {
      const newBPM = (60 * 1000) / (bestLag * this.frameTimeMs);

      // Check for octave errors (double/half tempo)
      const bpmRatio = newBPM / this.currentBPM;
      let adjustedBPM = newBPM;

      if (bpmRatio > 1.8 && bpmRatio < 2.2) {
        // Likely double tempo - prefer current
        adjustedBPM = newBPM / 2;
      } else if (bpmRatio > 0.45 && bpmRatio < 0.55) {
        // Likely half tempo - prefer current
        adjustedBPM = newBPM * 2;
      }

      // Clamp to valid range
      adjustedBPM = Math.max(MIN_BPM, Math.min(MAX_BPM, adjustedBPM));

      // Add to history for smoothing
      this.tempoHistory.push(adjustedBPM);
      if (this.tempoHistory.length > TEMPO_HISTORY_SIZE) {
        this.tempoHistory.shift();
      }

      // Median filter for stability (update even with 1 entry)
      if (this.tempoHistory.length >= 1) {
        const sorted = [...this.tempoHistory].sort((a, b) => a - b);
        this.currentBPM = sorted[Math.floor(sorted.length / 2)];
      }

      // Update beat interval
      this.beatInterval = 60000 / this.currentBPM;

      // Update confidence based on tempo stability (how consistent recent estimates are)
      if (this.tempoHistory.length >= 2) {
        const sorted = [...this.tempoHistory].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];

        // Calculate how close estimates are to the median (stability measure)
        let stabilitySum = 0;
        for (const bpm of this.tempoHistory) {
          const deviation = Math.abs(bpm - median) / median;
          stabilitySum += Math.max(0, 1 - deviation * 5); // 20% deviation = 0 contribution
        }
        const stabilityScore = stabilitySum / this.tempoHistory.length;

        // Combine stability with history length and correlation
        const historyFactor = Math.min(1, this.tempoHistory.length / 4); // Full credit at 4+ estimates
        const correlationBonus = Math.min(0.3, bestCorr * 3); // Up to 30% bonus from correlation

        this.tempoConfidence = Math.min(1, stabilityScore * historyFactor + correlationBonus);
      } else {
        // Low confidence until we have enough history
        this.tempoConfidence = Math.min(0.2, bestCorr * 2);
      }
    }
  }

  /**
   * Track beats using phase-aligned prediction
   */
  private trackBeat(
    now: number,
    onsetStrength: number,
    kickOnset: number
  ): { beat: boolean; downbeat: boolean } {
    // Update phase based on time elapsed
    const elapsed = now - this.lastBeatTime;
    this.beatPhase = (elapsed % this.beatInterval) / this.beatInterval;

    // Predict beat when phase wraps around
    const predictedBeat = elapsed >= this.beatInterval;

    // Check for onset near predicted beat position
    const nearPrediction = this.beatPhase > 1 - BEAT_PREDICT_WINDOW || this.beatPhase < BEAT_PREDICT_WINDOW;
    const strongOnset = onsetStrength > 0.3 || kickOnset > 0.2;

    let beat = false;
    let downbeat = false;

    if (predictedBeat || (nearPrediction && strongOnset)) {
      beat = true;
      this.beatCount++;
      this.downbeatCounter++;

      // Adjust phase based on actual onset position
      if (strongOnset && !predictedBeat) {
        // Onset came slightly early/late - adjust timing
        const phaseError = this.beatPhase > 0.5 ? this.beatPhase - 1 : this.beatPhase;
        this.lastBeatTime = now - phaseError * this.beatInterval * PHASE_CORRECTION_RATE;
      } else {
        this.lastBeatTime = now;
      }

      // Estimate downbeat (beat 1) - assume 4/4 time
      if (this.downbeatCounter >= 4) {
        this.downbeatCounter = 0;
        downbeat = true;
      }

      // Reset phase
      this.beatPhase = 0;
    }

    return { beat, downbeat };
  }

  /**
   * Get current BPM estimate
   */
  getBPM(): number {
    return Math.round(this.currentBPM);
  }

  /**
   * Get tempo confidence (0-1)
   */
  getConfidence(): number {
    return this.tempoConfidence;
  }

  /**
   * Get current beat phase (0-1)
   */
  getBeatPhase(): number {
    return this.beatPhase;
  }

  /**
   * Manually tap tempo
   * Call this when user taps to set tempo
   */
  tapTempo(timestamp: number = performance.now()): void {
    if (this.lastBeatTime > 0) {
      const interval = timestamp - this.lastBeatTime;
      if (interval > 200 && interval < 2000) {
        // Valid tap interval (30-300 BPM)
        const tapBPM = 60000 / interval;
        this.tempoHistory.push(tapBPM);
        if (this.tempoHistory.length > 4) {
          this.tempoHistory.shift();
        }

        // Average recent taps
        const avgBPM = this.tempoHistory.reduce((a, b) => a + b, 0) / this.tempoHistory.length;
        this.currentBPM = Math.max(MIN_BPM, Math.min(MAX_BPM, avgBPM));
        this.beatInterval = 60000 / this.currentBPM;
        this.tempoConfidence = Math.min(1, this.tempoHistory.length / 4);
      }
    }

    this.lastBeatTime = timestamp;
    this.beatPhase = 0;
    this.beatCount++;
  }

  /**
   * Reset the beat detector
   */
  reset(): void {
    this.onsetHistory.fill(0);
    this.onsetWritePos = 0;
    this.tempoHistory = [];
    this.currentBPM = 120;
    this.tempoConfidence = 0;
    this.beatPhase = 0;
    this.lastBeatTime = 0;
    this.beatCount = 0;
    this.downbeatCounter = 0;
    this.silenceStartTime = 0;

    for (const band of this.bands) {
      band.prevEnergy = 0;
      band.threshold = ONSET_THRESHOLD;
    }
  }

  /**
   * Get debug info for display
   */
  getDebugInfo(): {
    kickEnergy: number;
    snareEnergy: number;
    hihatEnergy: number;
    tempoHistoryLen: number;
    onsetHistoryMax: number;
    frameTimeMs: number;
  } {
    // Get current energy levels from bands
    const kickBand = this.bands.find(b => b.name === 'kick');
    const snareBand = this.bands.find(b => b.name === 'snare');
    const hihatBand = this.bands.find(b => b.name === 'hihat');

    // Find max onset in recent history
    let onsetMax = 0;
    for (let i = 0; i < Math.min(60, this.onsetHistorySize); i++) {
      const idx = (this.onsetWritePos - 1 - i + this.onsetHistorySize) % this.onsetHistorySize;
      onsetMax = Math.max(onsetMax, this.onsetHistory[idx]);
    }

    return {
      kickEnergy: kickBand?.prevEnergy || 0,
      snareEnergy: snareBand?.prevEnergy || 0,
      hihatEnergy: hihatBand?.prevEnergy || 0,
      tempoHistoryLen: this.tempoHistory.length,
      onsetHistoryMax: onsetMax,
      frameTimeMs: this.frameTimeMs,
    };
  }
}
