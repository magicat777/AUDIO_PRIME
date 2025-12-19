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
  classification: 'none' | 'voice' | 'singing' | 'speech';
  voiceRatio: number;         // Energy ratio in voice band
  centroid: number;           // Spectral centroid in voice range
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
  private classification: VoiceInfo['classification'] = 'none';

  // History for temporal smoothing
  private confidenceHistory: number[] = [];
  private readonly SMOOTHING_FRAMES = 10;

  // Bar indices for voice frequency ranges
  private readonly voiceStartBar: number;
  private readonly voiceEndBar: number;
  private readonly formantStartBar: number;
  private readonly formantEndBar: number;

  constructor() {
    // Pre-calculate bar indices for voice frequency ranges
    this.voiceStartBar = freqToBar(VOICE_MIN_FREQ);
    this.voiceEndBar = freqToBar(VOICE_MAX_FREQ);
    this.formantStartBar = freqToBar(FORMANT_MIN_FREQ);
    this.formantEndBar = freqToBar(FORMANT_MAX_FREQ);
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

    // Voice detection heuristics
    let detected = false;
    let rawConfidence = 0;

    // Check 1: Energy concentrated in voice range with appropriate centroid
    if (voiceRatio > 0.35 && centroid > 120 && centroid < 4500) {
      detected = true;
      rawConfidence = Math.min(voiceRatio * 200, 90);
    }

    // Check 2: Formant structure detected
    if (formants.length >= 2) {
      detected = true;
      rawConfidence = Math.max(rawConfidence, 75);
    }

    // Check 3: Wider range for vocals (singing)
    if (voiceRatio > 0.25 && centroid > 80 && centroid < 5500 && formants.length >= 1) {
      detected = true;
      rawConfidence = Math.max(rawConfidence, 60);
    }

    // Check 4: Any significant energy in vocal range
    const voiceBars = spectrum.slice(this.voiceStartBar, this.voiceEndBar + 1);
    const maxVoice = Math.max(...voiceBars);
    const meanSpectrum = totalEnergy / spectrum.length;

    if (voiceRatio > 0.2 && maxVoice > Math.sqrt(meanSpectrum) * 2) {
      detected = true;
      rawConfidence = Math.max(rawConfidence, 40);
    }

    // Check 5: Harmonic richness (multiple peaks = likely singing)
    if (detected) {
      const harmonicBars = spectrum.slice(this.formantStartBar, this.formantEndBar + 1);
      const harmonicMean = harmonicBars.reduce((a, b) => a + b, 0) / harmonicBars.length;
      const peakCount = harmonicBars.filter(v => v > harmonicMean * 2).length;

      if (peakCount > 5) {
        rawConfidence = Math.min(rawConfidence * 1.2, 95);
      }
    }

    // Apply temporal smoothing
    this.confidenceHistory.push(rawConfidence);
    if (this.confidenceHistory.length > this.SMOOTHING_FRAMES) {
      this.confidenceHistory.shift();
    }

    this.smoothedConfidence = this.confidenceHistory.reduce((a, b) => a + b, 0) / this.confidenceHistory.length;
    this.confidence = Math.round(this.smoothedConfidence);
    this.voiceActive = detected && this.confidence > 30;

    // Classification based on characteristics
    this.classification = this.classifyVoice(this.confidence, formants, centroid, voiceRatio);

    // Estimate pitch (fundamental frequency)
    const pitch = this.estimatePitch(spectrum);

    return {
      detected: this.voiceActive,
      confidence: this.confidence,
      probability: this.confidence / 100,
      pitch,
      formants,
      classification: this.classification,
      voiceRatio: Math.round(voiceRatio * 100) / 100,
      centroid: Math.round(centroid),
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
   */
  private estimatePitch(spectrum: Float32Array): number {
    // Look for first significant peak in voice range (80-500Hz for fundamentals)
    const pitchStartBar = freqToBar(80);
    const pitchEndBar = freqToBar(500);
    const pitchBars = spectrum.slice(pitchStartBar, pitchEndBar + 1);

    if (pitchBars.length === 0) return 0;

    const threshold = Math.max(...pitchBars) * 0.3;

    for (let i = 0; i < pitchBars.length; i++) {
      if (pitchBars[i] > threshold) {
        return Math.round(barToFreq(pitchStartBar + i));
      }
    }

    return 0;
  }

  /**
   * Classify voice type based on characteristics
   */
  private classifyVoice(
    confidence: number,
    formants: number[],
    centroid: number,
    voiceRatio: number
  ): VoiceInfo['classification'] {
    if (confidence < 30) return 'none';

    // Singing typically has:
    // - Higher harmonic content (more formants)
    // - Centroid in mid-range
    // - Strong voice ratio
    if (formants.length >= 3 && voiceRatio > 0.4 && centroid > 300 && centroid < 2000) {
      return 'singing';
    }

    // Speech typically has:
    // - Lower centroid
    // - Moderate formant count
    if (centroid < 800 && formants.length >= 1 && confidence > 50) {
      return 'speech';
    }

    // Generic voice detection
    return 'voice';
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
   * Reset detector state
   */
  reset(): void {
    this.voiceActive = false;
    this.confidence = 0;
    this.smoothedConfidence = 0;
    this.classification = 'none';
    this.confidenceHistory = [];
  }
}
