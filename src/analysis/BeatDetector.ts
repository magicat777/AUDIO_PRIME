/**
 * BeatDetector - Real-time BPM detection and beat tracking
 *
 * Algorithm:
 * 1. Onset Detection: Spectral flux with adaptive thresholding per band
 * 2. Tempo Estimation: Autocorrelation of onset signal (60-180 BPM range)
 * 3. Beat Tracking: Phase-aligned beat prediction with onset correction
 * 4. Confidence: Based on autocorrelation peak strength and tempo stability
 */

// Onset detection parameters - tuned for better sensitivity
const ONSET_THRESHOLD_BASE = 0.015; // Base threshold (lower = more sensitive)
const ONSET_DECAY = 0.95; // Slower decay for smoother tracking
const ONSET_ADAPT_RATE = 0.3; // How much threshold rises after detection (was 0.7, now gentler)

// Tempo detection parameters
const MIN_BPM = 60;
const MAX_BPM = 180;
const TEMPO_HISTORY_SIZE = 8; // More history for stability
const CORRELATION_WINDOW = 128; // PERFORMANCE: Only correlate recent ~2 seconds instead of full history

// Beat tracking parameters
const BEAT_PREDICT_WINDOW = 0.08; // 80ms window for beat prediction (wider for better alignment)
const PHASE_CORRECTION_RATE = 0.15; // How quickly to adjust phase

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
  energyHistory: Float32Array;  // Rolling history for mean calculation
  historyPos: number;
  meanEnergy: number;           // Running mean for better flux calculation
  energySum: number;            // PERFORMANCE: Running sum to avoid recalculating mean
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
  private readonly TEMPO_UPDATE_INTERVAL = 750; // PERFORMANCE: Reduced frequency (was 500ms)

  // Beat tracking
  private beatPhase: number = 0;
  private lastBeatTime: number = 0;
  private beatInterval: number = 500; // ms between beats (120 BPM default)
  private beatCount: number = 0;
  private downbeatCounter: number = 0;

  // Confidence smoothing and tempo locking
  private smoothedConfidence: number = 0;
  private readonly CONFIDENCE_SMOOTH_UP = 0.10;   // How fast confidence can rise
  private readonly CONFIDENCE_SMOOTH_DOWN = 0.01; // How fast confidence can fall (very slow)
  private stableTempoCount: number = 0;           // How many updates tempo has been stable
  private lockedBPM: number = 0;                  // BPM when locked
  private readonly LOCK_THRESHOLD = 0.65;         // Confidence threshold to lock tempo
  private readonly STABLE_TEMPO_TOLERANCE = 0.05; // 5% tolerance for "stable"

  // Frame timing
  private lastProcessTime: number = 0;
  private frameTimeMs: number = 16.67; // Default to 60fps, will be updated

  // Silence detection
  private silenceStartTime: number = 0;
  private readonly SILENCE_THRESHOLD = 0.01; // Energy threshold for silence
  private readonly SILENCE_RESET_MS = 3000; // Reset after 3 seconds of silence

  // Debug - PERFORMANCE: Cache debug values to avoid recalculating every frame
  private debugCounter: number = 0;
  private cachedOnsetMax: number = 0;
  private lastDebugUpdate: number = 0;
  private readonly DEBUG_UPDATE_INTERVAL = 100; // Update debug info every 100ms

  constructor(_sampleRate = 48000, _fftSize = 4096) {
    // Note: sampleRate and fftSize params kept for API compatibility but not used
    // The spectrum input is already processed into 512 logarithmic bars

    // Initialize frequency bands for onset detection using logarithmic bar indices
    // Energy history size for running mean calculation (~0.5 seconds at 60fps)
    const ENERGY_HISTORY_SIZE = 30;

    this.bands = [
      {
        name: 'kick',
        minBar: freqToBar(40),   // Lower for sub-bass kick
        maxBar: freqToBar(120),  // Upper kick range
        weight: 2.5, // Emphasize kick strongly for beat detection
        prevEnergy: 0,
        threshold: ONSET_THRESHOLD_BASE,
        energyHistory: new Float32Array(ENERGY_HISTORY_SIZE),
        historyPos: 0,
        meanEnergy: 0,
        energySum: 0,
      },
      {
        name: 'snare',
        minBar: freqToBar(120),  // Above kick
        maxBar: freqToBar(400),  // Snare body + crack
        weight: 1.5,
        prevEnergy: 0,
        threshold: ONSET_THRESHOLD_BASE,
        energyHistory: new Float32Array(ENERGY_HISTORY_SIZE),
        historyPos: 0,
        meanEnergy: 0,
        energySum: 0,
      },
      {
        name: 'hihat',
        minBar: freqToBar(4000), // High frequencies
        maxBar: freqToBar(12000),
        weight: 0.8, // Less weight for high frequencies
        prevEnergy: 0,
        threshold: ONSET_THRESHOLD_BASE,
        energyHistory: new Float32Array(ENERGY_HISTORY_SIZE),
        historyPos: 0,
        meanEnergy: 0,
        energySum: 0,
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

    // 1. Onset Detection - spectral flux with running mean comparison
    let totalOnset = 0;
    let kickOnset = 0;
    let totalEnergy = 0;
    let totalFlux = 0;  // Raw flux for autocorrelation (unthresholded)

    for (const band of this.bands) {
      const energy = this.calculateBandEnergy(spectrum, band.minBar, band.maxBar);
      totalEnergy += energy;

      // PERFORMANCE: Update running sum (subtract old, add new) instead of recalculating
      const oldEnergy = band.energyHistory[band.historyPos];
      band.energySum = band.energySum - oldEnergy + energy;
      band.energyHistory[band.historyPos] = energy;
      band.historyPos = (band.historyPos + 1) % band.energyHistory.length;

      // Calculate mean energy from running sum (O(1) instead of O(n))
      band.meanEnergy = band.energySum / band.energyHistory.length;

      // Spectral flux: how much energy increased compared to previous frame
      const flux = Math.max(0, energy - band.prevEnergy);

      // Accumulate weighted flux for autocorrelation (always, not just above threshold)
      totalFlux += flux * band.weight;

      // Deviation from mean: detects transients above average level
      const deviation = Math.max(0, energy - band.meanEnergy * 1.3);

      // Combined onset: weighted sum of flux and deviation
      const rawOnset = flux * 0.7 + deviation * 0.3;

      // Apply adaptive threshold for beat triggering
      if (rawOnset > band.threshold) {
        const onsetValue = (rawOnset - band.threshold) * band.weight;
        totalOnset += onsetValue;

        if (band.name === 'kick') {
          kickOnset = onsetValue;
        }

        // Gently raise threshold after detection
        band.threshold = Math.max(
          ONSET_THRESHOLD_BASE,
          band.threshold + rawOnset * ONSET_ADAPT_RATE
        );
      } else {
        // Decay threshold back towards base
        band.threshold *= ONSET_DECAY;
        band.threshold = Math.max(ONSET_THRESHOLD_BASE, band.threshold);
      }

      band.prevEnergy = energy;
    }

    // Normalize values
    const onsetStrength = Math.min(1, totalOnset * 2);
    // For autocorrelation, use the raw flux signal (not thresholded)
    // Scale up for better sensitivity
    const fluxSignal = Math.min(1, totalFlux * 5);
    // Display strength: show overall signal activity
    // Higher weight on energy for more responsive visual feedback
    const avgEnergy = totalEnergy / this.bands.length;
    const displayStrength = Math.min(1, fluxSignal * 0.4 + avgEnergy * 1.2);

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

    // Store flux signal in history for autocorrelation
    // Using raw flux (not thresholded) gives better tempo detection
    this.onsetHistory[this.onsetWritePos] = fluxSignal;
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
      beatStrength: displayStrength,  // Show actual signal strength for visual feedback
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
   * PERFORMANCE: Optimized to use smaller correlation window and stride
   */
  private updateTempo(): void {
    // Calculate autocorrelation of onset history
    const minLag = Math.floor((60 / MAX_BPM) * (1000 / this.frameTimeMs)); // ~20 frames for 180 BPM
    const maxLag = Math.floor((60 / MIN_BPM) * (1000 / this.frameTimeMs)); // ~60 frames for 60 BPM

    if (maxLag <= minLag || this.frameTimeMs <= 0) return;

    let bestLag = 0;
    let bestCorr = 0;

    // PERFORMANCE: Use smaller correlation window and stride=2 to reduce iterations
    // Before: ~40 lags × ~500 samples = 20,000 ops
    // After:  ~40 lags × ~64 samples = 2,560 ops (8x reduction)
    const windowSize = Math.min(CORRELATION_WINDOW, this.onsetHistorySize - maxLag);
    const stride = 2; // Sample every 2nd element

    // Calculate autocorrelation for each lag
    for (let lag = minLag; lag <= Math.min(maxLag, this.onsetHistorySize / 2); lag++) {
      let correlation = 0;
      let count = 0;

      // PERFORMANCE: Only correlate recent samples with stride
      for (let i = 0; i < windowSize; i += stride) {
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

      // Update confidence based on multiple factors
      // 1. Autocorrelation strength (how periodic the signal is)
      // 2. Tempo stability (how consistent estimates are)
      // 3. History depth (more samples = more reliable)

      // Correlation score: normalized and scaled
      // bestCorr is typically 0.01-0.1 for good beats, scale up generously
      const correlationScore = Math.min(1, bestCorr * 15);

      let rawConfidence = 0;

      if (this.tempoHistory.length >= 2) {
        const sorted = [...this.tempoHistory].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];

        // Calculate stability using IQR (interquartile range) - more robust to outliers
        // Only consider values within reasonable range of median
        let stableCount = 0;
        let stabilitySum = 0;
        for (const bpm of this.tempoHistory) {
          const deviation = Math.abs(bpm - median) / median;
          if (deviation < 0.15) {
            // Within 15% of median - count as stable
            stableCount++;
            stabilitySum += 1 - deviation * 3; // Small penalty for deviation
          }
          // Outliers (>15% deviation) are ignored, not penalized
        }
        // Stability is based on how many estimates are stable
        const stabilityScore = this.tempoHistory.length > 0
          ? (stableCount / this.tempoHistory.length) * (stabilitySum / Math.max(1, stableCount))
          : 0;

        // History factor: ramp up quickly (full credit at 4 entries)
        const historyFactor = Math.min(1, this.tempoHistory.length / 4);

        // Combined confidence - generous weighting:
        // - 35% from correlation (actual beat periodicity)
        // - 40% from stability (tempo consistency)
        // - 25% from history depth (data reliability)
        rawConfidence = Math.min(1,
          correlationScore * 0.35 +
          stabilityScore * historyFactor * 0.40 +
          historyFactor * 0.25
        );
      } else {
        // Early confidence based primarily on correlation
        rawConfidence = Math.min(0.6, correlationScore * 0.6);
      }

      // Track tempo stability for locking
      const tempoChange = this.lockedBPM > 0
        ? Math.abs(this.currentBPM - this.lockedBPM) / this.lockedBPM
        : 0;

      if (tempoChange < this.STABLE_TEMPO_TOLERANCE) {
        this.stableTempoCount++;
      } else {
        this.stableTempoCount = Math.max(0, this.stableTempoCount - 2); // Penalize instability
        if (this.smoothedConfidence > this.LOCK_THRESHOLD) {
          this.lockedBPM = this.currentBPM; // Update lock to new stable tempo
        }
      }

      // Lock tempo once confidence is high enough
      if (this.smoothedConfidence >= this.LOCK_THRESHOLD && this.lockedBPM === 0) {
        this.lockedBPM = this.currentBPM;
      }

      // Stability bonus: reward sustained stable tempo
      // Max bonus of 0.15 after 20 stable updates (~10 seconds)
      const stabilityBonus = Math.min(0.15, this.stableTempoCount * 0.0075);

      // Apply asymmetric smoothing: confidence rises faster than it falls
      const targetConfidence = Math.min(1, rawConfidence + stabilityBonus);

      if (targetConfidence > this.smoothedConfidence) {
        this.smoothedConfidence += (targetConfidence - this.smoothedConfidence) * this.CONFIDENCE_SMOOTH_UP;
      } else {
        // Even slower decay when tempo is locked and stable
        const decayRate = (this.lockedBPM > 0 && tempoChange < this.STABLE_TEMPO_TOLERANCE)
          ? this.CONFIDENCE_SMOOTH_DOWN * 0.5  // Half speed when locked
          : this.CONFIDENCE_SMOOTH_DOWN;
        this.smoothedConfidence += (targetConfidence - this.smoothedConfidence) * decayRate;
      }

      this.tempoConfidence = this.smoothedConfidence;
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
    this.smoothedConfidence = 0;
    this.stableTempoCount = 0;
    this.lockedBPM = 0;
    this.beatPhase = 0;
    this.lastBeatTime = 0;
    this.beatCount = 0;
    this.downbeatCounter = 0;
    this.silenceStartTime = 0;

    for (const band of this.bands) {
      band.prevEnergy = 0;
      band.threshold = ONSET_THRESHOLD_BASE;
      band.energyHistory.fill(0);
      band.historyPos = 0;
      band.meanEnergy = 0;
      band.energySum = 0;
    }
  }

  /**
   * Get debug info for display
   * PERFORMANCE: Uses cached onset max to avoid O(n) loop every frame
   */
  getDebugInfo(): {
    kickEnergy: number;
    snareEnergy: number;
    hihatEnergy: number;
    tempoHistoryLen: number;
    onsetHistoryMax: number;
    frameTimeMs: number;
  } {
    const now = performance.now();

    // PERFORMANCE: Only recalculate onset max periodically (every 100ms)
    if (now - this.lastDebugUpdate > this.DEBUG_UPDATE_INTERVAL) {
      this.lastDebugUpdate = now;
      let onsetMax = 0;
      for (let i = 0; i < Math.min(60, this.onsetHistorySize); i++) {
        const idx = (this.onsetWritePos - 1 - i + this.onsetHistorySize) % this.onsetHistorySize;
        onsetMax = Math.max(onsetMax, this.onsetHistory[idx]);
      }
      this.cachedOnsetMax = onsetMax;
    }

    // PERFORMANCE: Direct band access instead of find() every frame
    return {
      kickEnergy: this.bands[0].prevEnergy,
      snareEnergy: this.bands[1].prevEnergy,
      hihatEnergy: this.bands[2].prevEnergy,
      tempoHistoryLen: this.tempoHistory.length,
      onsetHistoryMax: this.cachedOnsetMax,
      frameTimeMs: this.frameTimeMs,
    };
  }
}
