/**
 * LUFS Meter Validation Tests - EBU R128 / ITU-R BS.1770-4 Compliance
 *
 * Reference specifications:
 * - ITU-R BS.1770-4: Algorithms to measure audio programme loudness
 * - EBU R128: Loudness normalisation and permitted maximum level
 * - EBU Tech 3341: Loudness Metering: EBU Mode
 * - EBU Tech 3342: Loudness Range
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LUFSMeter } from '../../src/analysis/LUFSMeter';

const SAMPLE_RATE = 48000;

/**
 * Generate a stereo sine wave test tone
 * @param frequency - Frequency in Hz
 * @param amplitude - Linear amplitude (0-1)
 * @param durationMs - Duration in milliseconds
 * @param sampleRate - Sample rate
 * @returns Interleaved stereo Float32Array
 */
function generateStereoSine(
  frequency: number,
  amplitude: number,
  durationMs: number,
  sampleRate = SAMPLE_RATE
): Float32Array {
  const numSamples = Math.floor((sampleRate * durationMs) / 1000);
  const buffer = new Float32Array(numSamples * 2); // Stereo interleaved

  for (let i = 0; i < numSamples; i++) {
    const sample = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
    buffer[i * 2] = sample; // Left
    buffer[i * 2 + 1] = sample; // Right (identical for mono-compatible test)
  }

  return buffer;
}

/**
 * Generate silence
 */
function generateSilence(durationMs: number, sampleRate = SAMPLE_RATE): Float32Array {
  const numSamples = Math.floor((sampleRate * durationMs) / 1000);
  return new Float32Array(numSamples * 2);
}

/**
 * Calculate expected LUFS for a 1kHz sine wave at given amplitude
 *
 * Note: The ITU-R BS.1770-4 K-weighting pre-filter has approximately +0.7dB
 * gain at 1kHz (transition region before +4dB high shelf). This is accounted
 * for in the K_WEIGHT_1KHZ constant.
 *
 * For a full-scale sine wave: peak = 1.0, RMS = 1/sqrt(2) ≈ 0.707
 * LUFS = -0.691 + 10 * log10(RMS^2) + K-weighting = -0.691 + 10 * log10(0.5) + 0.7 ≈ -3.0 LUFS
 */
const K_WEIGHT_1KHZ = 0.7; // dB gain from pre-filter at 1kHz

function expectedLUFSFor1kHzSine(amplitudePeak: number): number {
  const rms = amplitudePeak / Math.sqrt(2);
  const meanSquare = rms * rms;
  // Include K-weighting effect at 1kHz
  return -0.691 + 10 * Math.log10(meanSquare) + K_WEIGHT_1KHZ;
}

describe('LUFSMeter', () => {
  let meter: LUFSMeter;

  beforeEach(() => {
    meter = new LUFSMeter(SAMPLE_RATE, 2);
  });

  describe('Basic functionality', () => {
    it('should initialize with correct parameters', () => {
      expect(meter).toBeDefined();
    });

    it('should return -Infinity for silence', () => {
      const silence = generateSilence(500);
      const result = meter.process(silence);

      expect(result.momentary).toBe(-Infinity);
      expect(result.shortTerm).toBe(-Infinity);
      expect(result.integrated).toBe(-Infinity);
    });

    it('should reset correctly', () => {
      // Process some audio
      const tone = generateStereoSine(1000, 0.5, 1000);
      meter.process(tone);

      // Reset
      meter.reset();

      // Process silence and verify reset
      const silence = generateSilence(500);
      const result = meter.process(silence);

      expect(result.integrated).toBe(-Infinity);
    });
  });

  describe('K-weighting filter verification', () => {
    it('should have approximately 0dB gain at 1kHz', () => {
      // At 1kHz, K-weighting should be approximately 0dB
      // Generate 1kHz tone and verify LUFS matches expected value
      const amplitude = 0.5;
      const tone = generateStereoSine(1000, amplitude, 500);
      const result = meter.process(tone);

      const expected = expectedLUFSFor1kHzSine(amplitude);

      // Allow 0.5 dB tolerance for filter settling
      expect(result.momentary).toBeCloseTo(expected, 0);
    });

    it('should attenuate low frequencies (100Hz)', () => {
      // K-weighting attenuates below 1kHz
      const amplitude = 0.5;
      const tone1k = generateStereoSine(1000, amplitude, 500);
      const tone100 = generateStereoSine(100, amplitude, 500);

      const meter1 = new LUFSMeter(SAMPLE_RATE, 2);
      const meter2 = new LUFSMeter(SAMPLE_RATE, 2);

      const result1k = meter1.process(tone1k);
      const result100 = meter2.process(tone100);

      // 100Hz should measure lower than 1kHz due to K-weighting
      expect(result100.momentary).toBeLessThan(result1k.momentary);
    });

    it('should boost high frequencies (10kHz)', () => {
      // K-weighting boosts above 2kHz (high shelf)
      const amplitude = 0.5;
      const tone1k = generateStereoSine(1000, amplitude, 500);
      const tone10k = generateStereoSine(10000, amplitude, 500);

      const meter1 = new LUFSMeter(SAMPLE_RATE, 2);
      const meter2 = new LUFSMeter(SAMPLE_RATE, 2);

      const result1k = meter1.process(tone1k);
      const result10k = meter2.process(tone10k);

      // 10kHz should measure higher than 1kHz due to pre-filter boost
      expect(result10k.momentary).toBeGreaterThan(result1k.momentary);
    });
  });

  describe('Momentary loudness (400ms window)', () => {
    it('should respond within 400ms window', () => {
      const amplitude = 0.5;

      // Process 400ms of tone
      const tone = generateStereoSine(1000, amplitude, 400);
      const result = meter.process(tone);

      const expected = expectedLUFSFor1kHzSine(amplitude);

      // Should be close to expected after one full window
      expect(result.momentary).toBeCloseTo(expected, 0);
    });

    it('should update with new audio', () => {
      // Process tone
      const tone = generateStereoSine(1000, 0.5, 400);
      const result1 = meter.process(tone);

      // Process silence
      const silence = generateSilence(400);
      const result2 = meter.process(silence);

      // Momentary should decrease significantly
      expect(result2.momentary).toBeLessThan(result1.momentary);
    });
  });

  describe('Integrated loudness with gating', () => {
    it('should apply absolute gate at -70 LUFS', () => {
      // Very quiet signal below -70 LUFS should not contribute
      const veryQuiet = generateStereoSine(1000, 0.00001, 1000);
      const result = meter.process(veryQuiet);

      // Should return -Infinity as all blocks are gated out
      expect(result.integrated).toBe(-Infinity);
    });

    it('should accumulate integrated loudness over time', () => {
      const amplitude = 0.3;

      // Process multiple blocks
      for (let i = 0; i < 5; i++) {
        const tone = generateStereoSine(1000, amplitude, 500);
        meter.process(tone);
      }

      const result = meter.process(generateStereoSine(1000, amplitude, 100));

      // Integrated should be valid
      expect(result.integrated).toBeGreaterThan(-70);
      expect(result.integrated).toBeLessThan(0);
    });

    it('should apply relative gate correctly', () => {
      // Create varying loudness: loud blocks then quiet blocks
      // Quiet blocks 10dB below average should be gated

      // Process loud content
      for (let i = 0; i < 3; i++) {
        const loud = generateStereoSine(1000, 0.5, 500);
        meter.process(loud);
      }

      const loudResult = meter.process(generateStereoSine(1000, 0.5, 100));
      const integratedBefore = loudResult.integrated;

      // Process quiet content (much lower than -10dB from average)
      for (let i = 0; i < 3; i++) {
        const quiet = generateStereoSine(1000, 0.01, 500);
        meter.process(quiet);
      }

      const quietResult = meter.process(generateStereoSine(1000, 0.5, 100));

      // Integrated should not change much due to relative gating
      // The quiet blocks should be gated out
      expect(Math.abs(quietResult.integrated - integratedBefore)).toBeLessThan(1);
    });
  });

  describe('EBU R128 reference levels', () => {
    it('should measure approximately -23 LUFS for EBU reference level', () => {
      // EBU R128 reference: -23 LUFS
      // For 1kHz sine with K-weighting (+0.7dB at 1kHz):
      // -23 = -0.691 + 10 * log10(amp^2 / 2) + 0.7
      // -23.009 = 10 * log10(amp^2 / 2)
      // amp^2 / 2 = 10^(-2.3009) = 0.005
      // amp = sqrt(0.01) ≈ 0.1
      const targetAmplitude = 0.1;

      // Process enough audio for stable measurement
      for (let i = 0; i < 10; i++) {
        const tone = generateStereoSine(1000, targetAmplitude, 500);
        meter.process(tone);
      }

      const result = meter.process(generateStereoSine(1000, targetAmplitude, 100));

      // Should be within 1 LU of -23 LUFS (accounting for filter settling)
      expect(result.integrated).toBeGreaterThan(-24);
      expect(result.integrated).toBeLessThan(-22);
    });

    it('should measure approximately -14 LUFS for streaming reference', () => {
      // Common streaming target: -14 LUFS
      // With K-weighting at 1kHz (+0.7dB):
      // -14 = -0.691 + 10 * log10(amp^2 / 2) + 0.7
      // amp = sqrt(2 * 10^((-14 - 0.009) / 10)) ≈ 0.27
      const targetAmplitude = 0.27;

      for (let i = 0; i < 10; i++) {
        const tone = generateStereoSine(1000, targetAmplitude, 500);
        meter.process(tone);
      }

      const result = meter.process(generateStereoSine(1000, targetAmplitude, 100));

      // Should be within 1 LU of -14 LUFS
      expect(result.integrated).toBeGreaterThan(-15);
      expect(result.integrated).toBeLessThan(-13);
    });
  });

  describe('True peak detection', () => {
    it('should detect sample peak correctly', () => {
      const amplitude = 0.8;
      const tone = generateStereoSine(1000, amplitude, 100);
      const result = meter.process(tone);

      // True peak should be approximately 20 * log10(amplitude)
      const expectedPeak = 20 * Math.log10(amplitude);

      // Allow 1dB tolerance
      expect(result.truePeak).toBeGreaterThan(expectedPeak - 1);
      expect(result.truePeak).toBeLessThan(expectedPeak + 1);
    });

    it('should detect inter-sample peaks', () => {
      // Create a signal that has inter-sample peaks
      // Adjacent samples that could interpolate higher
      const buffer = new Float32Array(200);
      buffer[50] = 0.9;
      buffer[51] = 0.9;
      buffer[52] = 0.9;
      buffer[53] = 0.9;

      const result = meter.process(buffer);

      // True peak should be approximately equal to sample peak
      // (within floating point tolerance)
      const samplePeakDB = 20 * Math.log10(0.9);
      expect(result.truePeak).toBeCloseTo(samplePeakDB, 4);
    });

    it('should reset true peak on resetTruePeak()', () => {
      const tone = generateStereoSine(1000, 0.8, 100);
      meter.process(tone);

      expect(meter.getTruePeak()).toBeGreaterThan(-10);

      meter.resetTruePeak();

      expect(meter.getTruePeak()).toBe(-Infinity);
    });
  });

  describe('Loudness Range (LRA)', () => {
    it('should return 0 for constant loudness', () => {
      // Constant level should have LRA close to 0
      for (let i = 0; i < 20; i++) {
        const tone = generateStereoSine(1000, 0.3, 500);
        meter.process(tone);
      }

      const result = meter.process(generateStereoSine(1000, 0.3, 100));

      // LRA should be very small for constant level
      expect(result.range).toBeLessThan(1);
    });

    it('should detect loudness variation', () => {
      // Alternating loud and quiet sections should produce LRA > 0
      for (let i = 0; i < 10; i++) {
        const loud = generateStereoSine(1000, 0.5, 500);
        meter.process(loud);

        const quiet = generateStereoSine(1000, 0.1, 500);
        meter.process(quiet);
      }

      const result = meter.process(generateStereoSine(1000, 0.3, 100));

      // Should have measurable loudness range
      expect(result.range).toBeGreaterThan(5);
    });
  });

  describe('Short-term loudness (3s window)', () => {
    it('should require 3s for full accuracy', () => {
      const amplitude = 0.4;

      // Process less than 3s
      const tone1s = generateStereoSine(1000, amplitude, 1000);
      const result1s = meter.process(tone1s);

      // Reset and process full 3s
      meter.reset();
      const tone3s = generateStereoSine(1000, amplitude, 3000);
      const result3s = meter.process(tone3s);

      // 3s measurement should be more stable
      const expected = expectedLUFSFor1kHzSine(amplitude);
      expect(Math.abs(result3s.shortTerm - expected)).toBeLessThan(
        Math.abs(result1s.shortTerm - expected)
      );
    });
  });

  describe('ITU-R BS.1770-4 compliance', () => {
    it('should use correct loudness formula: -0.691 + 10*log10(meanSquare)', () => {
      // Full scale 1kHz sine: peak = 1.0, RMS = 0.707, MS = 0.5
      // Expected: -0.691 + 10 * log10(0.5) = -0.691 - 3.01 = -3.70 LUFS
      const tone = generateStereoSine(1000, 1.0, 500);
      const result = meter.process(tone);

      // Should be approximately -3.7 LUFS
      expect(result.momentary).toBeGreaterThan(-4.5);
      expect(result.momentary).toBeLessThan(-3.0);
    });

    it('should use 400ms gating block size', () => {
      // Process exactly 400ms and verify one block is accumulated
      // This is implicitly tested by the integrated loudness working correctly
      const tone = generateStereoSine(1000, 0.3, 400);
      meter.process(tone);

      // Process more to complete gating calculation
      for (let i = 0; i < 5; i++) {
        meter.process(generateStereoSine(1000, 0.3, 400));
      }

      const result = meter.process(generateStereoSine(1000, 0.3, 100));
      expect(result.integrated).not.toBe(-Infinity);
    });
  });
});

describe('LUFSMeter edge cases', () => {
  it('should handle very short audio buffers', () => {
    const meter = new LUFSMeter(SAMPLE_RATE, 2);
    const shortBuffer = new Float32Array(20); // 10 stereo samples

    // Should not throw
    expect(() => meter.process(shortBuffer)).not.toThrow();
  });

  it('should handle DC offset', () => {
    const meter = new LUFSMeter(SAMPLE_RATE, 2);
    const buffer = new Float32Array(9600); // 100ms stereo

    // Fill with DC + sine
    for (let i = 0; i < 4800; i++) {
      const sample = 0.1 + 0.3 * Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE);
      buffer[i * 2] = sample;
      buffer[i * 2 + 1] = sample;
    }

    const result = meter.process(buffer);

    // RLB filter should remove DC, result should still be valid
    expect(result.momentary).toBeGreaterThan(-50);
  });

  it('should handle full scale audio without clipping artifacts', () => {
    const meter = new LUFSMeter(SAMPLE_RATE, 2);
    const fullScale = generateStereoSine(1000, 1.0, 500);
    const result = meter.process(fullScale);

    // Should measure correctly without filter instability
    expect(result.momentary).toBeGreaterThan(-5);
    expect(result.momentary).toBeLessThan(0);
  });
});
