/**
 * Multi-Resolution FFT Worker for AUDIO_PRIME
 * Uses fft.js library for optimized FFT computation with pre-computed twiddle factors.
 *
 * Provides band-specific FFT sizes for optimal frequency resolution:
 * - Sub-bass (20-60Hz): 8192 samples for ~5.9Hz resolution
 * - Bass (60-250Hz): 4096 samples for ~11.7Hz resolution
 * - Mids (250-4kHz): 2048 samples for ~23.4Hz resolution
 * - Highs (4k-20kHz): 1024 samples for ~46.9Hz resolution
 */

// Import fft.js - uses pre-computed twiddle factors for ~2x speedup
import FFT from 'fft.js';

const SAMPLE_RATE = 48000;

// FFT configurations per band
const FFT_CONFIGS = {
  subBass: { size: 8192, minFreq: 20, maxFreq: 60 },
  bass: { size: 4096, minFreq: 60, maxFreq: 250 },
  lowMid: { size: 2048, minFreq: 250, maxFreq: 1000 },
  mid: { size: 2048, minFreq: 1000, maxFreq: 4000 },
  high: { size: 1024, minFreq: 4000, maxFreq: 20000 },
};

// Pre-allocated FFT instances and arrays for each size
const fftInstances: Map<number, InstanceType<typeof FFT>> = new Map();
const windows: Map<number, Float32Array> = new Map();
const inputArrays: Map<number, Float32Array> = new Map();
const outputArrays: Map<number, Float32Array> = new Map();

// Initialize FFT instances and arrays for each size
function initializeArrays(): void {
  const sizes = [1024, 2048, 4096, 8192];

  for (const size of sizes) {
    // Create FFT instance with pre-computed twiddle factors
    fftInstances.set(size, new FFT(size));

    // Create Blackman-Harris window (better frequency resolution than Hann)
    const window = new Float32Array(size);
    const a0 = 0.35875;
    const a1 = 0.48829;
    const a2 = 0.14128;
    const a3 = 0.01168;
    for (let i = 0; i < size; i++) {
      const t = (2 * Math.PI * i) / (size - 1);
      window[i] = a0 - a1 * Math.cos(t) + a2 * Math.cos(2 * t) - a3 * Math.cos(3 * t);
    }
    windows.set(size, window);

    // Pre-allocate work arrays (fft.js uses interleaved complex format)
    inputArrays.set(size, new Float32Array(size));
    outputArrays.set(size, new Float32Array(size * 2)); // Complex output
  }
}

// Compute FFT and return magnitude spectrum (linear scale for SpectrumAnalyzer)
function computeFFT(input: Float32Array, fftSize: number): Float32Array {
  const fftInstance = fftInstances.get(fftSize)!;
  const window = windows.get(fftSize)!;
  const inputArray = inputArrays.get(fftSize)!;
  const outputArray = outputArrays.get(fftSize)!;

  // Apply window and copy to input array
  const inputLength = Math.min(input.length, fftSize);
  for (let i = 0; i < fftSize; i++) {
    if (i < inputLength) {
      inputArray[i] = input[i] * window[i];
    } else {
      inputArray[i] = 0; // Zero-pad if input is shorter
    }
  }

  // Perform FFT using fft.js (much faster with pre-computed twiddle factors)
  // fft.js realTransform outputs interleaved complex: [re0, im0, re1, im1, ...]
  fftInstance.realTransform(outputArray, inputArray);

  // Compute magnitude spectrum (only positive frequencies)
  // Output is linear magnitude for SpectrumAnalyzer to process
  const output = new Float32Array(fftSize / 2);
  for (let i = 0; i < fftSize / 2; i++) {
    const re = outputArray[i * 2];
    const im = outputArray[i * 2 + 1];
    // Linear magnitude normalized by FFT size
    output[i] = Math.sqrt(re * re + im * im) / fftSize;
  }

  return output;
}

// Extract frequency band from FFT result
function extractBand(
  spectrum: Float32Array,
  fftSize: number,
  minFreq: number,
  maxFreq: number
): Float32Array {
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

// Compute multi-resolution spectrum
function computeMultiResolutionFFT(input: Float32Array): {
  fullSpectrum: Float32Array;
  bands: {
    subBass: Float32Array;
    bass: Float32Array;
    lowMid: Float32Array;
    mid: Float32Array;
    high: Float32Array;
  };
  frequencies: {
    subBass: Float32Array;
    bass: Float32Array;
    lowMid: Float32Array;
    mid: Float32Array;
    high: Float32Array;
  };
} {
  // Compute FFT at each resolution
  const spectrum8192 = computeFFT(input, 8192);
  const spectrum4096 = computeFFT(input, 4096);
  const spectrum2048 = computeFFT(input, 2048);
  const spectrum1024 = computeFFT(input, 1024);

  // Extract bands at optimal resolution
  const subBass = extractBand(spectrum8192, 8192, FFT_CONFIGS.subBass.minFreq, FFT_CONFIGS.subBass.maxFreq);
  const bass = extractBand(spectrum4096, 4096, FFT_CONFIGS.bass.minFreq, FFT_CONFIGS.bass.maxFreq);
  const lowMid = extractBand(spectrum2048, 2048, FFT_CONFIGS.lowMid.minFreq, FFT_CONFIGS.lowMid.maxFreq);
  const mid = extractBand(spectrum2048, 2048, FFT_CONFIGS.mid.minFreq, FFT_CONFIGS.mid.maxFreq);
  const high = extractBand(spectrum1024, 1024, FFT_CONFIGS.high.minFreq, FFT_CONFIGS.high.maxFreq);

  // Generate frequency arrays for each band
  const generateFrequencies = (size: number, minFreq: number, maxFreq: number): Float32Array => {
    const binWidth = SAMPLE_RATE / size;
    const startBin = Math.floor(minFreq / binWidth);
    const endBin = Math.ceil(maxFreq / binWidth);
    const numBins = endBin - startBin;
    const freqs = new Float32Array(numBins);
    for (let i = 0; i < numBins; i++) {
      freqs[i] = (startBin + i) * binWidth;
    }
    return freqs;
  };

  return {
    fullSpectrum: spectrum4096, // Use 4096 for general display
    bands: { subBass, bass, lowMid, mid, high },
    frequencies: {
      subBass: generateFrequencies(8192, FFT_CONFIGS.subBass.minFreq, FFT_CONFIGS.subBass.maxFreq),
      bass: generateFrequencies(4096, FFT_CONFIGS.bass.minFreq, FFT_CONFIGS.bass.maxFreq),
      lowMid: generateFrequencies(2048, FFT_CONFIGS.lowMid.minFreq, FFT_CONFIGS.lowMid.maxFreq),
      mid: generateFrequencies(2048, FFT_CONFIGS.mid.minFreq, FFT_CONFIGS.mid.maxFreq),
      high: generateFrequencies(1024, FFT_CONFIGS.high.minFreq, FFT_CONFIGS.high.maxFreq),
    },
  };
}

// Initialize on worker start
initializeArrays();

// Message handler
self.onmessage = (e: MessageEvent) => {
  const { type, data } = e.data;

  switch (type) {
    case 'process': {
      const result = computeMultiResolutionFFT(data);
      self.postMessage({
        type: 'spectrum',
        fullSpectrum: result.fullSpectrum,
        bands: result.bands,
        frequencies: result.frequencies,
      });
      break;
    }

    case 'processSingle': {
      // Simple single-resolution FFT for backwards compatibility
      const spectrum = computeFFT(data, 4096);
      self.postMessage({ type: 'spectrum', data: spectrum });
      break;
    }
  }
};

export {};
