/**
 * VoiceDetector - Real-time voice/vocal detection using spectral analysis
 *
 * Detects voice activity by analyzing:
 * 1. Energy distribution in voice frequency range (80Hz - 5000Hz)
 * 2. Formant structure (F1-F4 resonances)
 * 3. Harmonic patterns characteristic of vocals
 * 4. Spectral centroid in vocal range
 */

// Voice detection parameters
const VOICE_MIN_FREQ = 80;      // Hz - lowest voice fundamental
const VOICE_MAX_FREQ = 5000;    // Hz - upper harmonic range
const FORMANT_MIN_FREQ = 200;   // Hz - formant analysis range
const FORMANT_MAX_FREQ = 4000;  // Hz

// Spectrum configuration (must match SpectrumAnalyzer)
const TOTAL_BARS = 512;
const SPECTRUM_MIN_FREQ = 20;
const SPECTRUM_MAX_FREQ = 20000;

export interface VoiceInfo {
  detected: boolean;           // Voice/vocal detected
  confidence: number;          // 0-100 confidence percentage
  probability: number;         // 0-1 probability
  pitch: number;              // Estimated fundamental frequency (Hz)
  formants: number[];         // Detected formant frequencies (F1-F4)
  classification: 'instrumental' | 'voice' | 'singing' | 'speech';
  voiceRatio: number;         // Energy ratio in voice band
  centroid: number;           // Spectral centroid in voice range
  // New modulation metrics for voice vs guitar discrimination
  vibratoRate: number;        // Detected vibrato frequency (Hz), 0 if none
  vibratoDepth: number;       // Vibrato depth in cents (0-100+)
  pitchStability: number;     // 0-1, higher = more stable (guitar-like)
  hasVibrato: boolean;        // True if voice-like vibrato detected (5-8 Hz)
}

/**
 * Convert frequency to spectrum bar index (logarithmic mapping)
 */
function freqToBar(freq: number): number {
  const t = Math.log(freq / SPECTRUM_MIN_FREQ) / Math.log(SPECTRUM_MAX_FREQ / SPECTRUM_MIN_FREQ);
  return Math.max(0, Math.min(TOTAL_BARS - 1, Math.floor(t * (TOTAL_BARS - 1))));
}

/**
 * Convert bar index to frequency (inverse logarithmic mapping)
 */
function barToFreq(bar: number): number {
  const t = bar / (TOTAL_BARS - 1);
  return SPECTRUM_MIN_FREQ * Math.pow(SPECTRUM_MAX_FREQ / SPECTRUM_MIN_FREQ, t);
}

export class VoiceDetector {
  // Detection state
  private voiceActive = false;
  private confidence = 0;
  private smoothedConfidence = 0;
  private classification: VoiceInfo['classification'] = 'instrumental';

  // History for temporal smoothing
  private confidenceHistory: number[] = [];
  private readonly SMOOTHING_FRAMES = 10;

  // Bar indices for voice frequency ranges
  private readonly voiceStartBar: number;
  private readonly voiceEndBar: number;
  private readonly formantStartBar: number;
  private readonly formantEndBar: number;

  // PERFORMANCE: Use ring buffers instead of push/shift arrays
  // Pitch history for vibrato/stability analysis
  // At 60fps, 30 frames = 500ms of history
  private pitchHistory: Float32Array;
  private pitchHistoryPos: number = 0;
  private pitchHistoryCount: number = 0;
  private readonly PITCH_HISTORY_LENGTH = 30;
  private readonly SAMPLE_RATE = 60; // Approximate frame rate

  // Amplitude history for tremolo detection
  private amplitudeHistory: Float32Array;
  private amplitudeHistoryPos: number = 0;
  private amplitudeHistoryCount: number = 0;
  private readonly AMPLITUDE_HISTORY_LENGTH = 30;

  // PERFORMANCE: Pre-allocated working arrays to avoid allocations in hot path
  private centDeviations: Float32Array;
  private validPitchBuffer: Float32Array;

  // Vibrato detection parameters
  private readonly VIBRATO_MIN_RATE = 4.5;  // Hz - typical singing vibrato starts around 5 Hz
  private readonly VIBRATO_MAX_RATE = 8.5;  // Hz - upper limit for natural vibrato
  private readonly VIBRATO_MIN_DEPTH = 15;  // cents - minimum perceivable vibrato depth

  constructor() {
    // Pre-calculate bar indices for voice frequency ranges
    this.voiceStartBar = freqToBar(VOICE_MIN_FREQ);
    this.voiceEndBar = freqToBar(VOICE_MAX_FREQ);
    this.formantStartBar = freqToBar(FORMANT_MIN_FREQ);
    this.formantEndBar = freqToBar(FORMANT_MAX_FREQ);

    // PERFORMANCE: Pre-allocate ring buffers and working arrays
    this.pitchHistory = new Float32Array(this.PITCH_HISTORY_LENGTH);
    this.amplitudeHistory = new Float32Array(this.AMPLITUDE_HISTORY_LENGTH);
    this.centDeviations = new Float32Array(this.PITCH_HISTORY_LENGTH);
    this.validPitchBuffer = new Float32Array(this.PITCH_HISTORY_LENGTH);
  }

  /**
   * Process spectrum data and detect voice/vocals
   * @param spectrum - Normalized spectrum data (0-1 per bar)
   * @returns Voice detection results
   */
  process(spectrum: Float32Array): VoiceInfo {
    // Calculate energy in voice frequency range
    let voiceEnergy = 0;
    let totalEnergy = 0;
    let voiceWeightedSum = 0;
    let voiceSum = 0;

    for (let i = 0; i < spectrum.length; i++) {
      const energy = spectrum[i] * spectrum[i];
      totalEnergy += energy;

      if (i >= this.voiceStartBar && i <= this.voiceEndBar) {
        voiceEnergy += energy;
        const freq = barToFreq(i);
        voiceWeightedSum += freq * energy;
        voiceSum += energy;
      }
    }

    // Calculate voice ratio and centroid
    const voiceRatio = totalEnergy > 0 ? voiceEnergy / totalEnergy : 0;
    const centroid = voiceSum > 0 ? voiceWeightedSum / voiceSum : 0;

    // Detect formants (spectral peaks in voice range)
    const formants = this.detectFormants(spectrum);

    // Calculate bass energy (below voice range) - instruments typically have more bass
    let bassEnergy = 0;
    const bassEndBar = freqToBar(80);
    for (let i = 0; i < bassEndBar; i++) {
      bassEnergy += spectrum[i] * spectrum[i];
    }
    const bassRatio = totalEnergy > 0 ? bassEnergy / totalEnergy : 0;

    // Calculate mid-high voice energy (200-3000Hz) - more specific to voice
    let midVoiceEnergy = 0;
    const midStartBar = freqToBar(200);
    const midEndBar = freqToBar(3000);
    for (let i = midStartBar; i <= midEndBar; i++) {
      midVoiceEnergy += spectrum[i] * spectrum[i];
    }
    const midVoiceRatio = totalEnergy > 0 ? midVoiceEnergy / totalEnergy : 0;

    // Voice detection heuristics - STRICTER criteria
    let detected = false;
    let rawConfidence = 0;

    // Voice characteristics:
    // - Centroid in voice range (300-2500Hz is typical for vocals)
    // - Multiple formants detected (at least 2 for vowels)
    // - Mid-voice energy ratio should be significant
    // - Bass energy should NOT dominate (instruments often have strong bass)

    // Check 1: Strong formant structure with good mid-voice energy
    // This is the most reliable indicator of actual voice
    if (formants.length >= 3 && midVoiceRatio > 0.3 && centroid > 300 && centroid < 2500) {
      detected = true;
      rawConfidence = 70 + formants.length * 5;
    }

    // Check 2: Good formant structure, appropriate centroid, bass not dominant
    if (formants.length >= 2 && centroid > 250 && centroid < 3000 && bassRatio < 0.3) {
      detected = true;
      rawConfidence = Math.max(rawConfidence, 55 + formants.length * 8);
    }

    // Check 3: Very strong mid-voice with formants (likely singing)
    if (midVoiceRatio > 0.4 && formants.length >= 2 && centroid > 400 && centroid < 2000) {
      detected = true;
      rawConfidence = Math.max(rawConfidence, 65);
    }

    // Reduce confidence if bass dominates (likely instrumental)
    if (bassRatio > 0.25) {
      rawConfidence *= 0.7;
    }

    // Reduce confidence if centroid is too low (likely bass/drums)
    if (centroid < 200) {
      rawConfidence *= 0.5;
    }

    // Boost confidence for voice-like formant spacing
    // F1 typically 200-900Hz, F2 typically 700-2300Hz for vowels
    if (formants.length >= 2) {
      const f1 = formants[0];
      const f2 = formants[1];
      if (f1 >= 200 && f1 <= 900 && f2 >= 700 && f2 <= 2500 && f2 > f1 * 1.3) {
        rawConfidence = Math.min(rawConfidence * 1.2, 95);
      }
    }

    // Estimate pitch (fundamental frequency) - do this early for history tracking
    const pitch = this.estimatePitch(spectrum);

    // PERFORMANCE: Use ring buffer instead of push/shift (O(1) instead of O(n))
    this.pitchHistory[this.pitchHistoryPos] = pitch;
    this.pitchHistoryPos = (this.pitchHistoryPos + 1) % this.PITCH_HISTORY_LENGTH;
    if (this.pitchHistoryCount < this.PITCH_HISTORY_LENGTH) {
      this.pitchHistoryCount++;
    }

    // Track voice-band amplitude for tremolo detection using ring buffer
    const voiceBandAmplitude = Math.sqrt(voiceEnergy / (this.voiceEndBar - this.voiceStartBar + 1));
    this.amplitudeHistory[this.amplitudeHistoryPos] = voiceBandAmplitude;
    this.amplitudeHistoryPos = (this.amplitudeHistoryPos + 1) % this.AMPLITUDE_HISTORY_LENGTH;
    if (this.amplitudeHistoryCount < this.AMPLITUDE_HISTORY_LENGTH) {
      this.amplitudeHistoryCount++;
    }

    // Analyze vibrato and pitch stability
    const vibratoAnalysis = this.analyzeVibrato();
    const pitchStability = this.calculatePitchStability();
    const hasTremolo = this.analyzeTremolo();

    // Use vibrato detection to boost/reduce confidence
    // Voice vibrato (5-8 Hz) is a strong indicator of actual singing
    if (vibratoAnalysis.hasVibrato) {
      rawConfidence = Math.min(rawConfidence * 1.4, 95);
    }

    // High pitch stability with formants could be guitar, reduce confidence
    // Guitar sustains single notes; voice has natural pitch variation
    if (pitchStability > 0.85 && formants.length >= 2 && !vibratoAnalysis.hasVibrato) {
      rawConfidence *= 0.6;
    }

    // Very low pitch stability without proper vibrato rate = noise/multiple sources
    if (pitchStability < 0.2 && !vibratoAnalysis.hasVibrato) {
      rawConfidence *= 0.7;
    }

    // Apply temporal smoothing
    this.confidenceHistory.push(rawConfidence);
    if (this.confidenceHistory.length > this.SMOOTHING_FRAMES) {
      this.confidenceHistory.shift();
    }

    this.smoothedConfidence = this.confidenceHistory.reduce((a, b) => a + b, 0) / this.confidenceHistory.length;
    this.confidence = Math.round(this.smoothedConfidence);
    // Require higher confidence threshold (40%) to reduce false positives
    this.voiceActive = detected && this.confidence > 40;

    // Classification based on characteristics including vibrato
    this.classification = this.classifyVoiceWithModulation(
      this.confidence,
      formants,
      centroid,
      vibratoAnalysis.hasVibrato,
      pitchStability,
      hasTremolo
    );

    return {
      detected: this.voiceActive,
      confidence: this.confidence,
      probability: this.confidence / 100,
      pitch,
      formants,
      classification: this.classification,
      voiceRatio: Math.round(voiceRatio * 100) / 100,
      centroid: Math.round(centroid),
      vibratoRate: vibratoAnalysis.rate,
      vibratoDepth: vibratoAnalysis.depth,
      pitchStability,
      hasVibrato: vibratoAnalysis.hasVibrato,
    };
  }

  /**
   * Detect formant frequencies (F1-F4)
   */
  private detectFormants(spectrum: Float32Array): number[] {
    const formants: number[] = [];
    const formantBars = spectrum.slice(this.formantStartBar, this.formantEndBar + 1);

    if (formantBars.length < 10) return formants;

    const meanLevel = formantBars.reduce((a, b) => a + b, 0) / formantBars.length;

    // Find local maxima (peaks)
    for (let i = 1; i < formantBars.length - 1; i++) {
      if (formantBars[i] > formantBars[i - 1] &&
          formantBars[i] > formantBars[i + 1] &&
          formantBars[i] > meanLevel * 1.5) {
        const barIndex = this.formantStartBar + i;
        formants.push(Math.round(barToFreq(barIndex)));

        if (formants.length >= 4) break; // F1-F4
      }
    }

    return formants;
  }

  /**
   * Estimate fundamental pitch frequency
   * Uses peak detection in the typical vocal fundamental range (85-500Hz)
   */
  private estimatePitch(spectrum: Float32Array): number {
    // Vocal fundamentals typically 85Hz (bass) to 500Hz (soprano high notes)
    const pitchStartBar = freqToBar(85);
    const pitchEndBar = freqToBar(500);
    const pitchBars = spectrum.slice(pitchStartBar, pitchEndBar + 1);

    if (pitchBars.length === 0) return 0;

    const mean = pitchBars.reduce((a, b) => a + b, 0) / pitchBars.length;
    const maxInRange = Math.max(...pitchBars);

    // Need some minimum energy in the pitch range
    if (maxInRange < 0.01 || mean < 0.005) return 0;

    // Find the STRONGEST local maximum in the vocal fundamental range
    let bestPeakVal = 0;
    let bestPeakIdx = -1;

    for (let i = 1; i < pitchBars.length - 1; i++) {
      const val = pitchBars[i];
      // Must be a local maximum and above mean
      if (val > pitchBars[i - 1] && val > pitchBars[i + 1] && val > mean * 1.3) {
        if (val > bestPeakVal) {
          bestPeakVal = val;
          bestPeakIdx = i;
        }
      }
    }

    // If we found a good local maximum, use it
    if (bestPeakIdx >= 0 && bestPeakVal > maxInRange * 0.3) {
      return Math.round(barToFreq(pitchStartBar + bestPeakIdx));
    }

    // Fallback: find the strongest point in a more typical vocal range (100-350Hz)
    // This helps when there's no clear local maximum
    const fallbackStart = freqToBar(100) - pitchStartBar;
    const fallbackEnd = freqToBar(350) - pitchStartBar;

    let fallbackMax = 0;
    let fallbackIdx = -1;
    for (let i = Math.max(0, fallbackStart); i <= Math.min(pitchBars.length - 1, fallbackEnd); i++) {
      if (pitchBars[i] > fallbackMax) {
        fallbackMax = pitchBars[i];
        fallbackIdx = i;
      }
    }

    if (fallbackIdx >= 0 && fallbackMax > mean * 1.2) {
      return Math.round(barToFreq(pitchStartBar + fallbackIdx));
    }

    return 0;
  }

  /**
   * Classify voice type based on characteristics including modulation analysis
   * Uses vibrato and pitch stability to better distinguish singing from guitar
   */
  private classifyVoiceWithModulation(
    confidence: number,
    formants: number[],
    centroid: number,
    hasVibrato: boolean,
    pitchStability: number,
    hasTremolo: boolean
  ): VoiceInfo['classification'] {
    // Return 'instrumental' when no voice is confidently detected
    if (confidence < 40) return 'instrumental';

    // Strong vibrato indicator = definitely singing
    // This is the most reliable signal for distinguishing voice from guitar
    if (hasVibrato && formants.length >= 2) {
      return 'singing';
    }

    // High pitch stability without vibrato is likely guitar (sustained notes)
    // Even with formants, guitar solos can mimic voice frequencies
    if (pitchStability > 0.8 && !hasVibrato && formants.length >= 2) {
      return 'instrumental';
    }

    // Singing typically has:
    // - Higher harmonic content (3+ formants)
    // - Centroid in mid-vocal range (400-2000Hz)
    // - Moderate pitch stability with some variation
    // - Often has tremolo (amplitude modulation)
    if (formants.length >= 3 && centroid > 400 && centroid < 2000 && pitchStability < 0.75) {
      return 'singing';
    }

    // Also classify as singing with formants + moderate stability + tremolo
    if (formants.length >= 2 && confidence > 55 && hasTremolo && pitchStability > 0.3 && pitchStability < 0.8) {
      return 'singing';
    }

    // Also classify as singing if strong formant structure with moderate pitch variation
    if (formants.length >= 2 && confidence > 60 && centroid > 350 && centroid < 2500 && pitchStability < 0.7) {
      return 'singing';
    }

    // Speech typically has:
    // - Lower centroid (300-800Hz)
    // - Rapid formant transitions (low pitch stability)
    // - Less harmonic structure than singing
    // - No sustained vibrato
    if (centroid < 800 && centroid > 200 && formants.length >= 1 &&
        confidence > 45 && pitchStability < 0.5 && !hasVibrato) {
      return 'speech';
    }

    // Generic voice detection (uncertain between singing/speech)
    // Only if pitch stability suggests it's not a guitar sustain
    if (pitchStability < 0.75) {
      return 'voice';
    }

    // Default to instrumental if nothing else matches
    return 'instrumental';
  }

  /**
   * Get current detection state
   */
  isVoiceActive(): boolean {
    return this.voiceActive;
  }

  /**
   * Get current confidence
   */
  getConfidence(): number {
    return this.confidence;
  }

  /**
   * Get current classification
   */
  getClassification(): VoiceInfo['classification'] {
    return this.classification;
  }

  /**
   * Analyze pitch history for vibrato detection
   * Vibrato is characterized by periodic frequency modulation at 5-8 Hz
   * PERFORMANCE: Uses ring buffer and pre-allocated arrays
   * @returns { rate, depth, hasVibrato }
   */
  private analyzeVibrato(): { rate: number; depth: number; hasVibrato: boolean } {
    // Need enough pitch history for analysis
    if (this.pitchHistoryCount < 10) {
      return { rate: 0, depth: 0, hasVibrato: false };
    }

    // PERFORMANCE: Extract valid pitches into pre-allocated buffer without filter()
    let validCount = 0;
    let pitchSum = 0;
    for (let i = 0; i < this.pitchHistoryCount; i++) {
      const p = this.pitchHistory[i];
      if (p > 0) {
        this.validPitchBuffer[validCount++] = p;
        pitchSum += p;
      }
    }

    if (validCount < 8) {
      return { rate: 0, depth: 0, hasVibrato: false };
    }

    // Calculate mean pitch
    const meanPitch = pitchSum / validCount;
    if (meanPitch < 80) {
      return { rate: 0, depth: 0, hasVibrato: false };
    }

    // PERFORMANCE: Calculate cent deviations in pre-allocated array
    let maxCents = -Infinity;
    let minCents = Infinity;
    for (let i = 0; i < validCount; i++) {
      const cents = 1200 * Math.log2(this.validPitchBuffer[i] / meanPitch);
      this.centDeviations[i] = cents;
      if (cents > maxCents) maxCents = cents;
      if (cents < minCents) minCents = cents;
    }
    const depth = maxCents - minCents;

    // Detect zero crossings to estimate vibrato rate
    let zeroCrossings = 0;
    for (let i = 1; i < validCount; i++) {
      if ((this.centDeviations[i - 1] < 0 && this.centDeviations[i] >= 0) ||
          (this.centDeviations[i - 1] >= 0 && this.centDeviations[i] < 0)) {
        zeroCrossings++;
      }
    }

    // Calculate rate: zero crossings / 2 = cycles, divide by time
    const timeSpan = validCount / this.SAMPLE_RATE;
    const rate = (zeroCrossings / 2) / timeSpan;

    // Determine if this is voice-like vibrato
    const hasVibrato = rate >= this.VIBRATO_MIN_RATE &&
                       rate <= this.VIBRATO_MAX_RATE &&
                       depth >= this.VIBRATO_MIN_DEPTH;

    return {
      rate: Math.round(rate * 10) / 10,
      depth: Math.round(depth),
      hasVibrato
    };
  }

  /**
   * Calculate pitch stability (inverse of variance)
   * Higher values = more stable pitch (guitar-like)
   * Lower values = more variation (voice-like)
   * PERFORMANCE: Uses ring buffer without allocating new arrays
   * @returns 0-1 stability score
   */
  private calculatePitchStability(): number {
    // Need enough pitch history
    if (this.pitchHistoryCount < 5) {
      return 0.5; // Neutral
    }

    // PERFORMANCE: Count valid pitches and calculate mean without filter/reduce
    let validCount = 0;
    let sum = 0;
    for (let i = 0; i < this.pitchHistoryCount; i++) {
      const p = this.pitchHistory[i];
      if (p > 0) {
        validCount++;
        sum += p;
      }
    }

    if (validCount < 5) {
      return 0.5;
    }

    const mean = sum / validCount;
    if (mean < 80) return 0.5;

    // PERFORMANCE: Calculate variance inline without map/reduce
    let varianceSum = 0;
    for (let i = 0; i < this.pitchHistoryCount; i++) {
      const p = this.pitchHistory[i];
      if (p > 0) {
        const cents = 1200 * Math.log2(p / mean);
        varianceSum += cents * cents;
      }
    }
    const stdDev = Math.sqrt(varianceSum / validCount);

    // Map standard deviation to stability score
    // stdDev < 10 cents = very stable (0.9+)
    // stdDev > 100 cents = very unstable (0.1)
    const stability = Math.max(0, Math.min(1, 1 - (stdDev / 100)));

    return Math.round(stability * 100) / 100;
  }

  /**
   * Analyze amplitude history for tremolo detection
   * Tremolo is amplitude modulation, typically at 4-8 Hz
   * PERFORMANCE: Uses ring buffer without reduce()
   * @returns true if tremolo-like modulation detected
   */
  private analyzeTremolo(): boolean {
    if (this.amplitudeHistoryCount < 10) {
      return false;
    }

    // PERFORMANCE: Calculate mean without reduce()
    let sum = 0;
    for (let i = 0; i < this.amplitudeHistoryCount; i++) {
      sum += this.amplitudeHistory[i];
    }
    const mean = sum / this.amplitudeHistoryCount;
    if (mean < 0.01) return false;

    // Check for periodic modulation by counting peaks
    let peaks = 0;
    for (let i = 1; i < this.amplitudeHistoryCount - 1; i++) {
      if (this.amplitudeHistory[i] > this.amplitudeHistory[i - 1] &&
          this.amplitudeHistory[i] > this.amplitudeHistory[i + 1] &&
          this.amplitudeHistory[i] > mean) {
        peaks++;
      }
    }

    // Calculate modulation rate
    const timeSpan = this.amplitudeHistoryCount / this.SAMPLE_RATE;
    const rate = peaks / timeSpan;

    // Voice-like tremolo: 4-8 Hz
    return rate >= 4 && rate <= 10;
  }

  /**
   * Reset detector state
   */
  reset(): void {
    this.voiceActive = false;
    this.confidence = 0;
    this.smoothedConfidence = 0;
    this.classification = 'instrumental';
    this.confidenceHistory = [];

    // PERFORMANCE: Reset ring buffers (fill with 0 instead of reallocating)
    this.pitchHistory.fill(0);
    this.pitchHistoryPos = 0;
    this.pitchHistoryCount = 0;
    this.amplitudeHistory.fill(0);
    this.amplitudeHistoryPos = 0;
    this.amplitudeHistoryCount = 0;
  }
}
