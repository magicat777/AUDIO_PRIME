/**
 * AudioEngine - Central audio coordination for AUDIO_PRIME
 * Manages audio capture, FFT processing, and data distribution
 */

import { writable, get } from 'svelte/store';
import type { Writable } from 'svelte/store';
import type {} from '../types/global'; // Import global type declarations
import { LUFSMeter } from '../analysis/LUFSMeter';
import { TruePeakDetector } from '../analysis/TruePeakDetector';
import { BeatDetector } from '../analysis/BeatDetector';
import type { BeatInfo } from '../analysis/BeatDetector';
import { VoiceDetector } from '../analysis/VoiceDetector';
import type { VoiceInfo } from '../analysis/VoiceDetector';
import { SpectrumAnalyzer } from '../audio/SpectrumAnalyzer';
import { MultiResolutionSpectrumAnalyzer } from '../audio/MultiResolutionSpectrumAnalyzer';
import type { MultiResolutionBands, MultiResolutionFrequencies } from '../audio/MultiResolutionSpectrumAnalyzer';

// Types
export type FFTMode = 'standard' | 'multiResolution';

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

export interface AudioState {
  isCapturing: boolean;
  currentDevice: AudioDevice | null;
  sampleRate: number;
  bufferSize: number;
  fftMode: FFTMode;
}

export interface SpectrumData {
  frequencies: Float32Array;
  magnitudes: Float32Array;
  timestamp: number;
}

export interface LoudnessData {
  momentary: number;
  shortTerm: number;
  integrated: number;
  range: number;
  truePeak: number;
}

export interface StereoAnalysisData {
  correlation: number;      // -1 to +1: phase coherence
  stereoWidth: number;      // 0 to 1: stereo spread
  balance: number;          // -1 to +1: L/R balance
  midLevel: number;         // dB: mid (mono) level
  sideLevel: number;        // dB: side (stereo) level
}

// Constants
const SAMPLE_RATE = 48000;
const FFT_SIZE = 4096;  // Standard FFT size
const FFT_SIZE_MAX = 8192;  // Max size for multi-resolution (sub-bass needs this)
const FFT_HOP_SIZE = 512;  // Process every 512 samples (~10ms) for fast updates

class AudioEngineClass {
  // Stores
  public state: Writable<AudioState>;
  public spectrum: Writable<Float32Array>;
  public spectrumMultiRes: Writable<Float32Array>;  // Multi-resolution output
  public waveform: Writable<Float32Array>;
  public levels: Writable<{ left: number; right: number; peak: number }>;
  public loudness: Writable<LoudnessData>;
  public stereoAnalysis: Writable<StereoAnalysisData>;
  public stereoSamples: Writable<Float32Array>;  // Interleaved L/R samples for goniometer
  public beatInfo: Writable<BeatInfo>;
  public voiceInfo: Writable<VoiceInfo>;

  // Internal state
  private devices: AudioDevice[] = [];
  private fftWorker: Worker | null = null;
  private multiResWorker: Worker | null = null;
  private audioCleanup: (() => void) | null = null;
  private audioBuffer: Float32Array;
  private bufferWritePos = 0;
  private samplesSinceLastFFT = 0;

  // PERFORMANCE: Pre-allocated buffers to avoid GC pressure
  private stereoSampleBuffer: Float32Array;
  private monoSampleBuffer: Float32Array;
  private fftInputBuffer: Float32Array;
  private multiResInputBuffer: Float32Array;
  private waveformBuffer: Float32Array;

  // Analysis modules
  private lufsMeter: LUFSMeter;
  private truePeakDetector: TruePeakDetector;
  private spectrumAnalyzer: SpectrumAnalyzer;
  private multiResAnalyzer: MultiResolutionSpectrumAnalyzer;
  private beatDetector: BeatDetector;
  private voiceDetector: VoiceDetector;

  constructor() {
    // Initialize stores
    this.state = writable<AudioState>({
      isCapturing: false,
      currentDevice: null,
      sampleRate: SAMPLE_RATE,
      bufferSize: FFT_SIZE,
      fftMode: 'standard',
    });

    this.spectrum = writable(new Float32Array(512));  // 512 bars output
    this.spectrumMultiRes = writable(new Float32Array(512));  // Multi-res output
    this.waveform = writable(new Float32Array(1024));
    this.levels = writable({ left: -100, right: -100, peak: -100 });
    this.loudness = writable<LoudnessData>({
      momentary: -Infinity,
      shortTerm: -Infinity,
      integrated: -Infinity,
      range: 0,
      truePeak: -Infinity,
    });
    this.stereoAnalysis = writable<StereoAnalysisData>({
      correlation: 0,
      stereoWidth: 0,
      balance: 0,
      midLevel: -Infinity,
      sideLevel: -Infinity,
    });
    this.stereoSamples = writable(new Float32Array(2048)); // 1024 stereo pairs
    this.beatInfo = writable<BeatInfo>({
      bpm: 0,
      confidence: 0,
      beat: false,
      beatPhase: 0,
      beatStrength: 0,
      downbeat: false,
      beatCount: 0,
    });
    this.voiceInfo = writable<VoiceInfo>({
      detected: false,
      confidence: 0,
      probability: 0,
      pitch: 0,
      formants: [],
      classification: 'instrumental',
      voiceRatio: 0,
      centroid: 0,
      vibratoRate: 0,
      vibratoDepth: 0,
      pitchStability: 0.5,
      hasVibrato: false,
    });

    // Pre-allocate audio buffer (large enough for max FFT size)
    this.audioBuffer = new Float32Array(FFT_SIZE_MAX * 2);

    // PERFORMANCE: Pre-allocate processing buffers to avoid per-frame allocations
    this.stereoSampleBuffer = new Float32Array(2048);  // 1024 stereo pairs for goniometer
    this.monoSampleBuffer = new Float32Array(4096);    // Mono conversion buffer
    this.fftInputBuffer = new Float32Array(FFT_SIZE);  // Standard FFT input
    this.multiResInputBuffer = new Float32Array(FFT_SIZE_MAX);  // Multi-res FFT input
    this.waveformBuffer = new Float32Array(1024);      // Waveform display buffer

    // Initialize analysis modules
    this.lufsMeter = new LUFSMeter(SAMPLE_RATE, 2);
    this.truePeakDetector = new TruePeakDetector(SAMPLE_RATE);
    this.spectrumAnalyzer = new SpectrumAnalyzer(512, FFT_SIZE, SAMPLE_RATE);
    this.multiResAnalyzer = new MultiResolutionSpectrumAnalyzer(512);
    this.beatDetector = new BeatDetector(SAMPLE_RATE, FFT_SIZE);
    this.voiceDetector = new VoiceDetector();
  }

  /**
   * Get spectrum analyzer for external access
   */
  getSpectrumAnalyzer(): SpectrumAnalyzer {
    return this.spectrumAnalyzer;
  }

  /**
   * Get multi-resolution spectrum analyzer
   */
  getMultiResAnalyzer(): MultiResolutionSpectrumAnalyzer {
    return this.multiResAnalyzer;
  }

  /**
   * Get beat detector
   */
  getBeatDetector(): BeatDetector {
    return this.beatDetector;
  }

  /**
   * Tap tempo - call when user taps to manually set tempo
   */
  tapTempo(): void {
    this.beatDetector.tapTempo();
  }

  /**
   * Reset beat detector
   */
  resetBeat(): void {
    this.beatDetector.reset();
  }

  /**
   * Get voice detector
   */
  getVoiceDetector(): VoiceDetector {
    return this.voiceDetector;
  }

  /**
   * Reset voice detector
   */
  resetVoice(): void {
    this.voiceDetector.reset();
  }

  /**
   * Get current FFT mode
   */
  getFFTMode(): FFTMode {
    return get(this.state).fftMode;
  }

  /**
   * Set FFT mode (standard or multiResolution)
   */
  setFFTMode(mode: FFTMode): void {
    this.state.update((s) => ({ ...s, fftMode: mode }));
    console.log(`FFT mode changed to: ${mode}`);
  }

  /**
   * Toggle between FFT modes
   */
  toggleFFTMode(): FFTMode {
    const currentMode = this.getFFTMode();
    const newMode = currentMode === 'standard' ? 'multiResolution' : 'standard';
    this.setFFTMode(newMode);
    return newMode;
  }

  async initialize(): Promise<void> {
    // Check for Electron API
    if (!window.electronAPI) {
      console.warn('Electron API not available - running in browser dev mode');
      // Initialize FFT Workers even in dev mode for testing
      this.initFFTWorker();
      this.initMultiResWorker();
      // Start demo mode with synthetic data
      this.startDemoMode();
      return;
    }

    // Get available devices
    this.devices = await window.electronAPI.audio.getDevices();

    if (this.devices.length === 0) {
      console.warn('No audio monitor sources found');
    }

    // Initialize both FFT Workers
    this.initFFTWorker();
    this.initMultiResWorker();

    console.log('AudioEngine initialized with devices:', this.devices);
  }

  private demoAnimationFrame: number | null = null;

  private startDemoMode(): void {
    console.log('Starting demo mode with synthetic audio data');

    // Demo state for smooth LUFS simulation
    let demoIntegrated = -23;
    let demoShortTerm = -18;

    const generateDemoData = () => {
      const time = performance.now() / 1000;

      // Generate synthetic FFT magnitude data (linear scale)
      const rawFFT = new Float32Array(FFT_SIZE / 2);
      for (let i = 0; i < rawFFT.length; i++) {
        const freq = (i / rawFFT.length) * (SAMPLE_RATE / 2);
        // Simulate bass-heavy spectrum with some variation
        const bassBump = Math.exp(-freq / 100) * 0.5;
        const midPresence = Math.exp(-Math.pow((freq - 1000) / 500, 2)) * 0.3;
        const noise = Math.random() * 0.05;
        const pulse = Math.sin(time * 2 + i * 0.01) * 0.1;
        rawFFT[i] = Math.max(0, bassBump + midPresence + noise + pulse);
      }
      // Process through spectrum analyzer
      const processed = this.spectrumAnalyzer.process(rawFFT);
      this.spectrum.set(processed);

      // Process beat detection
      const beatResult = this.beatDetector.process(processed);
      this.beatInfo.set(beatResult);

      // Process voice detection
      const voiceResult = this.voiceDetector.process(processed);
      this.voiceInfo.set(voiceResult);

      // Generate synthetic levels
      const beatPhase = Math.sin(time * 4) * 0.5 + 0.5;
      this.levels.set({
        left: -20 + beatPhase * 15 + Math.random() * 5,
        right: -22 + beatPhase * 15 + Math.random() * 5,
        peak: -6 + beatPhase * 3,
      });

      // Generate synthetic LUFS data
      const momentary = -18 + Math.sin(time * 3) * 6 + Math.random() * 2;
      demoShortTerm = demoShortTerm * 0.99 + momentary * 0.01;
      demoIntegrated = demoIntegrated * 0.999 + momentary * 0.001;

      this.loudness.set({
        momentary: momentary,
        shortTerm: demoShortTerm,
        integrated: demoIntegrated,
        range: 8 + Math.sin(time * 0.1) * 2,
        truePeak: -3 + beatPhase * 2 + Math.random(),
      });

      // Generate waveform
      const waveform = new Float32Array(1024);
      for (let i = 0; i < waveform.length; i++) {
        waveform[i] = Math.sin(time * 440 * 2 * Math.PI + i * 0.1) * 0.3 +
                      Math.sin(time * 880 * 2 * Math.PI + i * 0.2) * 0.15 +
                      Math.random() * 0.05;
      }
      this.waveform.set(waveform);

      // Generate synthetic stereo analysis data
      const demoCorrelation = 0.7 + Math.sin(time * 0.5) * 0.25 + Math.random() * 0.05;
      const demoWidth = 0.3 + Math.sin(time * 0.3) * 0.2 + Math.random() * 0.05;
      const demoBalance = Math.sin(time * 0.2) * 0.15;
      this.stereoAnalysis.set({
        correlation: Math.max(-1, Math.min(1, demoCorrelation)),
        stereoWidth: Math.max(0, Math.min(1, demoWidth)),
        balance: Math.max(-1, Math.min(1, demoBalance)),
        midLevel: -18 + Math.sin(time * 2) * 5,
        sideLevel: -28 + Math.sin(time * 1.5) * 5,
      });

      // Generate synthetic stereo samples for goniometer
      const stereoSamples = new Float32Array(2048);
      for (let i = 0; i < stereoSamples.length; i += 2) {
        const t = time * 1000 + i / 10;
        const mono = Math.sin(t * 0.1) * 0.3 + Math.sin(t * 0.23) * 0.15;
        const side = Math.sin(t * 0.15 + 1.2) * demoWidth * 0.3;
        stereoSamples[i] = mono + side + (Math.random() - 0.5) * 0.05;     // L
        stereoSamples[i + 1] = mono - side + (Math.random() - 0.5) * 0.05; // R
      }
      this.stereoSamples.set(stereoSamples);

      this.demoAnimationFrame = requestAnimationFrame(generateDemoData);
    };

    this.state.update((s) => ({ ...s, isCapturing: true }));
    generateDemoData();
  }

  private stopDemoMode(): void {
    if (this.demoAnimationFrame) {
      cancelAnimationFrame(this.demoAnimationFrame);
      this.demoAnimationFrame = null;
    }
  }

  private initFFTWorker(): void {
    // Optimized FFT worker with pre-computed twiddle factors and Blackman-Harris window
    // This provides ~2x speedup over computing sin/cos in the butterfly loop
    const workerCode = `
      // Optimized FFT Worker for AUDIO_PRIME
      const FFT_SIZE = ${FFT_SIZE};
      const SAMPLE_RATE = ${SAMPLE_RATE};

      // Pre-allocate arrays
      const windowFunc = new Float32Array(FFT_SIZE);
      const real = new Float32Array(FFT_SIZE);
      const imag = new Float32Array(FFT_SIZE);

      // Pre-compute twiddle factors (the key optimization)
      const twiddleReal = new Float32Array(FFT_SIZE / 2);
      const twiddleImag = new Float32Array(FFT_SIZE / 2);
      for (let i = 0; i < FFT_SIZE / 2; i++) {
        const angle = -2 * Math.PI * i / FFT_SIZE;
        twiddleReal[i] = Math.cos(angle);
        twiddleImag[i] = Math.sin(angle);
      }

      // Pre-compute bit reversal table
      const bitReversal = new Uint16Array(FFT_SIZE);
      const bits = Math.log2(FFT_SIZE);
      for (let i = 0; i < FFT_SIZE; i++) {
        let j = 0;
        for (let k = 0; k < bits; k++) {
          j = (j << 1) | ((i >> k) & 1);
        }
        bitReversal[i] = j;
      }

      // Create Blackman-Harris window (better frequency resolution than Hann)
      const a0 = 0.35875, a1 = 0.48829, a2 = 0.14128, a3 = 0.01168;
      for (let i = 0; i < FFT_SIZE; i++) {
        const t = 2 * Math.PI * i / (FFT_SIZE - 1);
        windowFunc[i] = a0 - a1 * Math.cos(t) + a2 * Math.cos(2*t) - a3 * Math.cos(3*t);
      }

      function computeFFT(input) {
        const N = FFT_SIZE;
        const output = new Float32Array(N / 2);

        // Apply window and bit-reverse copy
        for (let i = 0; i < N; i++) {
          const j = bitReversal[i];
          real[j] = (i < input.length ? input[i] : 0) * windowFunc[i];
          imag[j] = 0;
        }

        // FFT butterfly with pre-computed twiddle factors
        for (let size = 2; size <= N; size *= 2) {
          const halfsize = size >> 1;
          const tablestep = N / size;

          for (let i = 0; i < N; i += size) {
            for (let j = 0, k = 0; j < halfsize; j++, k += tablestep) {
              const idx1 = i + j;
              const idx2 = i + j + halfsize;

              const tReal = real[idx2] * twiddleReal[k] - imag[idx2] * twiddleImag[k];
              const tImag = real[idx2] * twiddleImag[k] + imag[idx2] * twiddleReal[k];

              real[idx2] = real[idx1] - tReal;
              imag[idx2] = imag[idx1] - tImag;
              real[idx1] = real[idx1] + tReal;
              imag[idx1] = imag[idx1] + tImag;
            }
          }
        }

        // Compute magnitude (linear scale for SpectrumAnalyzer)
        for (let i = 0; i < N / 2; i++) {
          output[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / N;
        }

        return output;
      }

      self.onmessage = (e) => {
        const { type, data } = e.data;

        if (type === 'process') {
          const spectrum = computeFFT(data);
          self.postMessage({ type: 'spectrum', data: spectrum });
        }
      };
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    this.fftWorker = new Worker(URL.createObjectURL(blob));

    this.fftWorker.onmessage = (e) => {
      if (e.data.type === 'spectrum') {
        // Process through perceptual spectrum analyzer
        const processed = this.spectrumAnalyzer.process(new Float32Array(e.data.data));
        this.spectrum.set(processed);

        // Process beat detection using the spectrum data
        const beatResult = this.beatDetector.process(processed);
        this.beatInfo.set(beatResult);

        // Process voice detection using the spectrum data
        const voiceResult = this.voiceDetector.process(processed);
        this.voiceInfo.set(voiceResult);
      }
    };
  }

  private initMultiResWorker(): void {
    // Multi-resolution FFT worker - uses different FFT sizes per frequency band
    // Sub-bass (8192), Bass (4096), Mids (2048), Highs (1024)
    const workerCode = `
      const SAMPLE_RATE = ${SAMPLE_RATE};

      // FFT configurations per band
      const FFT_CONFIGS = {
        subBass: { size: 8192, minFreq: 20, maxFreq: 60 },
        bass: { size: 4096, minFreq: 60, maxFreq: 250 },
        lowMid: { size: 2048, minFreq: 250, maxFreq: 1000 },
        mid: { size: 2048, minFreq: 1000, maxFreq: 4000 },
        high: { size: 1024, minFreq: 4000, maxFreq: 20000 },
      };

      // Pre-allocated arrays for each FFT size
      const sizes = [1024, 2048, 4096, 8192];
      const windows = new Map();
      const reals = new Map();
      const imags = new Map();
      const twiddleReals = new Map();
      const twiddleImags = new Map();
      const bitReversals = new Map();

      // Initialize for each FFT size
      for (const size of sizes) {
        // Window function
        const window = new Float32Array(size);
        const a0 = 0.35875, a1 = 0.48829, a2 = 0.14128, a3 = 0.01168;
        for (let i = 0; i < size; i++) {
          const t = 2 * Math.PI * i / (size - 1);
          window[i] = a0 - a1 * Math.cos(t) + a2 * Math.cos(2*t) - a3 * Math.cos(3*t);
        }
        windows.set(size, window);

        // Real/imag arrays
        reals.set(size, new Float32Array(size));
        imags.set(size, new Float32Array(size));

        // Twiddle factors
        const twiddleReal = new Float32Array(size / 2);
        const twiddleImag = new Float32Array(size / 2);
        for (let i = 0; i < size / 2; i++) {
          const angle = -2 * Math.PI * i / size;
          twiddleReal[i] = Math.cos(angle);
          twiddleImag[i] = Math.sin(angle);
        }
        twiddleReals.set(size, twiddleReal);
        twiddleImags.set(size, twiddleImag);

        // Bit reversal
        const bitReversal = new Uint16Array(size);
        const bits = Math.log2(size);
        for (let i = 0; i < size; i++) {
          let j = 0;
          for (let k = 0; k < bits; k++) {
            j = (j << 1) | ((i >> k) & 1);
          }
          bitReversal[i] = j;
        }
        bitReversals.set(size, bitReversal);
      }

      function computeFFT(input, fftSize) {
        const N = fftSize;
        const window = windows.get(N);
        const real = reals.get(N);
        const imag = imags.get(N);
        const twiddleReal = twiddleReals.get(N);
        const twiddleImag = twiddleImags.get(N);
        const bitReversal = bitReversals.get(N);
        const output = new Float32Array(N / 2);

        // Apply window and bit-reverse copy
        for (let i = 0; i < N; i++) {
          const j = bitReversal[i];
          real[j] = (i < input.length ? input[i] : 0) * window[i];
          imag[j] = 0;
        }

        // FFT butterfly
        for (let size = 2; size <= N; size *= 2) {
          const halfsize = size >> 1;
          const tablestep = N / size;

          for (let i = 0; i < N; i += size) {
            for (let j = 0, k = 0; j < halfsize; j++, k += tablestep) {
              const idx1 = i + j;
              const idx2 = i + j + halfsize;

              const tReal = real[idx2] * twiddleReal[k] - imag[idx2] * twiddleImag[k];
              const tImag = real[idx2] * twiddleImag[k] + imag[idx2] * twiddleReal[k];

              real[idx2] = real[idx1] - tReal;
              imag[idx2] = imag[idx1] - tImag;
              real[idx1] = real[idx1] + tReal;
              imag[idx1] = imag[idx1] + tImag;
            }
          }
        }

        // Magnitude (linear scale)
        for (let i = 0; i < N / 2; i++) {
          output[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / N;
        }

        return output;
      }

      function extractBand(spectrum, fftSize, minFreq, maxFreq) {
        const binWidth = SAMPLE_RATE / fftSize;
        const startBin = Math.floor(minFreq / binWidth);
        const endBin = Math.ceil(maxFreq / binWidth);
        const numBins = endBin - startBin;

        const band = new Float32Array(numBins);
        for (let i = 0; i < numBins; i++) {
          band[i] = spectrum[startBin + i] || 0;
        }

        return band;
      }

      function generateFrequencies(fftSize, minFreq, maxFreq) {
        const binWidth = SAMPLE_RATE / fftSize;
        const startBin = Math.floor(minFreq / binWidth);
        const endBin = Math.ceil(maxFreq / binWidth);
        const numBins = endBin - startBin;

        const freqs = new Float32Array(numBins);
        for (let i = 0; i < numBins; i++) {
          freqs[i] = (startBin + i) * binWidth;
        }

        return freqs;
      }

      self.onmessage = (e) => {
        const { type, data } = e.data;

        if (type === 'process') {
          // Compute FFT at each resolution
          const spectrum8192 = computeFFT(data, 8192);
          const spectrum4096 = computeFFT(data, 4096);
          const spectrum2048 = computeFFT(data, 2048);
          const spectrum1024 = computeFFT(data, 1024);

          // Extract bands at optimal resolution
          const bands = {
            subBass: extractBand(spectrum8192, 8192, FFT_CONFIGS.subBass.minFreq, FFT_CONFIGS.subBass.maxFreq),
            bass: extractBand(spectrum4096, 4096, FFT_CONFIGS.bass.minFreq, FFT_CONFIGS.bass.maxFreq),
            lowMid: extractBand(spectrum2048, 2048, FFT_CONFIGS.lowMid.minFreq, FFT_CONFIGS.lowMid.maxFreq),
            mid: extractBand(spectrum2048, 2048, FFT_CONFIGS.mid.minFreq, FFT_CONFIGS.mid.maxFreq),
            high: extractBand(spectrum1024, 1024, FFT_CONFIGS.high.minFreq, FFT_CONFIGS.high.maxFreq),
          };

          const frequencies = {
            subBass: generateFrequencies(8192, FFT_CONFIGS.subBass.minFreq, FFT_CONFIGS.subBass.maxFreq),
            bass: generateFrequencies(4096, FFT_CONFIGS.bass.minFreq, FFT_CONFIGS.bass.maxFreq),
            lowMid: generateFrequencies(2048, FFT_CONFIGS.lowMid.minFreq, FFT_CONFIGS.lowMid.maxFreq),
            mid: generateFrequencies(2048, FFT_CONFIGS.mid.minFreq, FFT_CONFIGS.mid.maxFreq),
            high: generateFrequencies(1024, FFT_CONFIGS.high.minFreq, FFT_CONFIGS.high.maxFreq),
          };

          self.postMessage({ type: 'multiResSpectrum', bands, frequencies });
        }
      };
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    this.multiResWorker = new Worker(URL.createObjectURL(blob));

    this.multiResWorker.onmessage = (e) => {
      if (e.data.type === 'multiResSpectrum') {
        // Process through multi-resolution analyzer
        const processed = this.multiResAnalyzer.process(
          e.data.bands as MultiResolutionBands,
          e.data.frequencies as MultiResolutionFrequencies
        );
        this.spectrumMultiRes.set(processed);
      }
    };
  }

  getDevices(): AudioDevice[] {
    return [...this.devices];
  }

  async start(device?: AudioDevice): Promise<void> {
    const targetDevice = device || this.devices[0];

    if (!targetDevice) {
      throw new Error('No audio device available');
    }

    // Set up audio data listener
    this.audioCleanup = window.electronAPI.audio.onData((samples) => {
      this.processAudioData(new Float32Array(samples));
    });

    // Start capture
    await window.electronAPI.audio.start(targetDevice.id);

    this.state.update((s) => ({
      ...s,
      isCapturing: true,
      currentDevice: targetDevice,
    }));

    console.log('Audio capture started:', targetDevice.name);
  }

  async stop(): Promise<void> {
    if (this.audioCleanup) {
      this.audioCleanup();
      this.audioCleanup = null;
    }

    await window.electronAPI.audio.stop();

    this.state.update((s) => ({
      ...s,
      isCapturing: false,
    }));

    console.log('Audio capture stopped');
  }

  private processAudioData(samples: Float32Array): void {

    // Clamp samples to valid range to protect downstream processing
    // parec float32le should be in -1 to 1, but clamp just in case
    for (let i = 0; i < samples.length; i++) {
      if (!isFinite(samples[i])) {
        samples[i] = 0;
      } else {
        samples[i] = Math.max(-1, Math.min(1, samples[i]));
      }
    }

    // Calculate levels (simple RMS for now)
    let sumL = 0;
    let sumR = 0;
    let maxL = 0;
    let maxR = 0;

    for (let i = 0; i < samples.length; i += 2) {
      const l = samples[i] || 0;
      const r = samples[i + 1] || 0;

      sumL += l * l;
      sumR += r * r;
      maxL = Math.max(maxL, Math.abs(l));
      maxR = Math.max(maxR, Math.abs(r));
    }

    const rmsL = Math.sqrt(sumL / (samples.length / 2));
    const rmsR = Math.sqrt(sumR / (samples.length / 2));
    const peak = Math.max(maxL, maxR);

    const dbL = rmsL > 1e-10 ? 20 * Math.log10(rmsL) : -100;
    const dbR = rmsR > 1e-10 ? 20 * Math.log10(rmsR) : -100;
    const dbPeak = peak > 1e-10 ? 20 * Math.log10(peak) : -100;

    this.levels.set({ left: dbL, right: dbR, peak: dbPeak });

    // Calculate stereo analysis (correlation, width, balance, M/S levels)
    let sumLR = 0;      // Sum of L*R products for correlation
    let sumLsq = 0;     // Sum of L^2
    let sumRsq = 0;     // Sum of R^2
    let sumMid = 0;     // Sum of (L+R)^2 for mid level
    let sumSide = 0;    // Sum of (L-R)^2 for side level

    const numStereoSamples = samples.length / 2;
    for (let i = 0; i < samples.length; i += 2) {
      const l = samples[i] || 0;
      const r = samples[i + 1] || 0;

      sumLR += l * r;
      sumLsq += l * l;
      sumRsq += r * r;

      // M/S encoding: Mid = (L+R)/2, Side = (L-R)/2
      const mid = (l + r) * 0.5;
      const side = (l - r) * 0.5;
      sumMid += mid * mid;
      sumSide += side * side;
    }

    // Pearson correlation coefficient: r = Σ(L*R) / sqrt(Σ(L²) * Σ(R²))
    const denom = Math.sqrt(sumLsq * sumRsq);
    const correlation = denom > 1e-10 ? sumLR / denom : 0;

    // Stereo width: 0 = mono, 1 = wide stereo
    // Based on side/mid ratio (clamped)
    const rmsMid = Math.sqrt(sumMid / numStereoSamples);
    const rmsSide = Math.sqrt(sumSide / numStereoSamples);
    const stereoWidth = rmsMid > 1e-10 ? Math.min(1, rmsSide / rmsMid) : 0;

    // Balance: -1 = left, 0 = center, +1 = right
    const balance = (rmsL + rmsR) > 1e-10 ? (rmsR - rmsL) / (rmsL + rmsR) : 0;

    // M/S levels in dB
    const midLevel = rmsMid > 1e-10 ? 20 * Math.log10(rmsMid) : -100;
    const sideLevel = rmsSide > 1e-10 ? 20 * Math.log10(rmsSide) : -100;

    this.stereoAnalysis.set({
      correlation,
      stereoWidth,
      balance,
      midLevel,
      sideLevel,
    });

    // Store stereo samples for goniometer display (last 2048 samples = 1024 pairs)
    // PERFORMANCE: Copy into pre-allocated buffer instead of creating new array
    if (samples.length >= 2048) {
      const startIdx = samples.length - 2048;
      for (let i = 0; i < 2048; i++) {
        this.stereoSampleBuffer[i] = samples[startIdx + i];
      }
      this.stereoSamples.set(this.stereoSampleBuffer);
    } else if (samples.length > 0) {
      // For smaller buffers, still avoid slice
      for (let i = 0; i < samples.length && i < 2048; i++) {
        this.stereoSampleBuffer[i] = samples[i];
      }
      this.stereoSamples.set(this.stereoSampleBuffer.subarray(0, samples.length));
    }

    // Process LUFS metering (expects interleaved stereo)
    const lufsResult = this.lufsMeter.process(samples);
    const truePeakResult = this.truePeakDetector.process(samples);

    this.loudness.set({
      momentary: lufsResult.momentary,
      shortTerm: lufsResult.shortTerm,
      integrated: lufsResult.integrated,
      range: lufsResult.range,
      truePeak: truePeakResult.truePeakMax,
    });

    // Mix to mono and add to buffer
    // PERFORMANCE: Use pre-allocated buffer, resize only if needed
    const monoLength = samples.length / 2;
    let monoSamples: Float32Array;
    if (monoLength <= this.monoSampleBuffer.length) {
      monoSamples = this.monoSampleBuffer;
    } else {
      // Rare case: input larger than expected, reallocate
      this.monoSampleBuffer = new Float32Array(monoLength);
      monoSamples = this.monoSampleBuffer;
    }

    for (let i = 0; i < monoLength; i++) {
      monoSamples[i] = (samples[i * 2] + samples[i * 2 + 1]) * 0.5;
    }

    // Update waveform using pre-allocated buffer
    if (monoLength >= 1024) {
      for (let i = 0; i < 1024; i++) {
        this.waveformBuffer[i] = monoSamples[i];
      }
      this.waveform.set(this.waveformBuffer);
    }

    // Accumulate in ring buffer
    for (let i = 0; i < monoLength; i++) {
      this.audioBuffer[this.bufferWritePos] = monoSamples[i];
      this.bufferWritePos = (this.bufferWritePos + 1) % this.audioBuffer.length;
    }

    // Track samples and trigger FFT at hop intervals
    this.samplesSinceLastFFT += monoLength;

    // Send to FFT workers when we've accumulated enough samples
    while (this.samplesSinceLastFFT >= FFT_HOP_SIZE) {
      // Standard FFT (4096 samples)
      // PERFORMANCE: Use pre-allocated buffer
      const startPos = (this.bufferWritePos - FFT_SIZE + this.audioBuffer.length) % this.audioBuffer.length;

      for (let i = 0; i < FFT_SIZE; i++) {
        this.fftInputBuffer[i] = this.audioBuffer[(startPos + i) % this.audioBuffer.length];
      }

      // Note: postMessage will copy the buffer, so reusing is safe
      this.fftWorker?.postMessage({ type: 'process', data: this.fftInputBuffer });

      // Multi-resolution FFT (needs 8192 samples for sub-bass)
      // PERFORMANCE: Use pre-allocated buffer
      const multiResStartPos = (this.bufferWritePos - FFT_SIZE_MAX + this.audioBuffer.length) % this.audioBuffer.length;

      for (let i = 0; i < FFT_SIZE_MAX; i++) {
        this.multiResInputBuffer[i] = this.audioBuffer[(multiResStartPos + i) % this.audioBuffer.length];
      }

      this.multiResWorker?.postMessage({ type: 'process', data: this.multiResInputBuffer });

      this.samplesSinceLastFFT -= FFT_HOP_SIZE;
    }
  }

  /**
   * Reset LUFS integrated measurement
   */
  resetLUFS(): void {
    this.lufsMeter.reset();
    this.truePeakDetector.resetPeaks();
  }

  destroy(): void {
    this.stop();
    this.stopDemoMode();
    this.fftWorker?.terminate();
    this.fftWorker = null;
    this.multiResWorker?.terminate();
    this.multiResWorker = null;
  }
}

// Export singleton
export const audioEngine = new AudioEngineClass();
