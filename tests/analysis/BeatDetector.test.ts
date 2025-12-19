/**
 * BeatDetector Tests
 *
 * Tests for onset detection, tempo estimation, and beat tracking.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BeatDetector } from '../../src/analysis/BeatDetector';

// Spectrum configuration matching SpectrumAnalyzer output
const SPECTRUM_BARS = 512;
const SPECTRUM_MIN_FREQ = 20;
const SPECTRUM_MAX_FREQ = 20000;

/**
 * Convert frequency to spectrum bar index (logarithmic mapping)
 */
function freqToBar(freq: number): number {
  const t = Math.log(freq / SPECTRUM_MIN_FREQ) / Math.log(SPECTRUM_MAX_FREQ / SPECTRUM_MIN_FREQ);
  return Math.max(0, Math.min(SPECTRUM_BARS - 1, Math.floor(t * (SPECTRUM_BARS - 1))));
}

/**
 * Generate spectrum data with a kick drum pulse
 * Simulates energy in the 60-150Hz range (logarithmic bars)
 */
function generateKickSpectrum(intensity: number = 0.8): Float32Array {
  const spectrum = new Float32Array(SPECTRUM_BARS);

  // Kick drum: energy in 60-150Hz range (logarithmic)
  const kickMinBar = freqToBar(60);
  const kickMaxBar = freqToBar(150);

  for (let i = 0; i < spectrum.length; i++) {
    if (i >= kickMinBar && i <= kickMaxBar) {
      const center = (kickMinBar + kickMaxBar) / 2;
      const width = kickMaxBar - kickMinBar;
      spectrum[i] = intensity * (1 - Math.abs(i - center) / width);
    } else {
      spectrum[i] = Math.random() * 0.02; // Noise floor
    }
  }

  return spectrum;
}

/**
 * Generate quiet spectrum (noise floor only)
 */
function generateQuietSpectrum(): Float32Array {
  const spectrum = new Float32Array(SPECTRUM_BARS);
  for (let i = 0; i < spectrum.length; i++) {
    spectrum[i] = Math.random() * 0.01;
  }
  return spectrum;
}

/**
 * Simulate multiple frames at a given BPM
 * @param detector - BeatDetector instance
 * @param bpm - Target tempo
 * @param durationSeconds - Duration to simulate
 * @param framesPerSecond - Frame rate
 */
function simulateBPM(
  detector: BeatDetector,
  bpm: number,
  durationSeconds: number,
  framesPerSecond: number = 60
): void {
  const totalFrames = durationSeconds * framesPerSecond;
  const msPerBeat = 60000 / bpm;
  const msPerFrame = 1000 / framesPerSecond;

  let timeMs = 0;
  let lastBeatTime = 0;

  for (let i = 0; i < totalFrames; i++) {
    // Determine if this frame should have a kick
    const timeSinceLastBeat = timeMs - lastBeatTime;
    const isOnBeat = timeSinceLastBeat >= msPerBeat - msPerFrame / 2;

    if (isOnBeat) {
      detector.process(generateKickSpectrum(0.9));
      lastBeatTime = timeMs;
    } else {
      detector.process(generateQuietSpectrum());
    }

    timeMs += msPerFrame;
  }
}

describe('BeatDetector', () => {
  let detector: BeatDetector;

  beforeEach(() => {
    detector = new BeatDetector();
  });

  describe('Initialization', () => {
    it('should initialize with correct parameters', () => {
      expect(detector).toBeDefined();
      expect(detector.getBPM()).toBe(120); // Default BPM
      expect(detector.getConfidence()).toBe(0);
    });

    it('should reset correctly', () => {
      // Process some data
      detector.process(generateKickSpectrum());
      detector.process(generateKickSpectrum());

      // Reset
      detector.reset();

      expect(detector.getBPM()).toBe(120);
      expect(detector.getConfidence()).toBe(0);
      expect(detector.getBeatPhase()).toBe(0);
    });
  });

  describe('Onset Detection', () => {
    it('should detect onset when kick energy increases', () => {
      // Start with silence
      let result = detector.process(generateQuietSpectrum());
      const initialStrength = result.beatStrength;

      // Add kick
      result = detector.process(generateKickSpectrum(0.9));

      // Strength should increase
      expect(result.beatStrength).toBeGreaterThan(initialStrength);
    });

    it('should return low strength for silence', () => {
      const result = detector.process(generateQuietSpectrum());
      expect(result.beatStrength).toBeLessThan(0.1);
    });

    it('should adapt threshold after loud onset', () => {
      // Loud onset
      detector.process(generateKickSpectrum(0.9));

      // Slightly less loud shouldn't trigger as strong
      const result = detector.process(generateKickSpectrum(0.5));

      // Should still detect but not as strongly due to adaptive threshold
      expect(result.beatStrength).toBeLessThan(0.9);
    });
  });

  describe('Beat Tracking', () => {
    it('should track beat phase between 0 and 1', () => {
      for (let i = 0; i < 10; i++) {
        const result = detector.process(generateKickSpectrum());
        expect(result.beatPhase).toBeGreaterThanOrEqual(0);
        expect(result.beatPhase).toBeLessThanOrEqual(1);
      }
    });

    it('should increment beat count on detected beats', () => {
      let lastBeatCount = 0;
      let beatDetected = false;

      // Process multiple frames
      for (let i = 0; i < 100; i++) {
        const spectrum = i % 30 === 0 ? generateKickSpectrum(0.9) : generateQuietSpectrum();
        const result = detector.process(spectrum);

        if (result.beat) {
          beatDetected = true;
          expect(result.beatCount).toBeGreaterThan(lastBeatCount);
          lastBeatCount = result.beatCount;
        }
      }

      expect(beatDetected).toBe(true);
    });
  });

  describe('Tap Tempo', () => {
    it('should update tempo on tap', () => {
      const initialBPM = detector.getBPM();

      // Simulate taps at 100 BPM (600ms apart)
      detector.tapTempo(0);
      detector.tapTempo(600);
      detector.tapTempo(1200);
      detector.tapTempo(1800);

      // BPM should be close to 100
      expect(detector.getBPM()).toBeGreaterThan(95);
      expect(detector.getBPM()).toBeLessThan(105);
    });

    it('should ignore invalid tap intervals', () => {
      detector.tapTempo(0);

      // Too fast (would be 600 BPM)
      detector.tapTempo(100);

      // BPM should not change to extreme value
      expect(detector.getBPM()).toBeLessThanOrEqual(180);
    });

    it('should increase confidence with consistent taps', () => {
      detector.tapTempo(0);
      expect(detector.getConfidence()).toBe(0);

      detector.tapTempo(500);
      const conf1 = detector.getConfidence();

      detector.tapTempo(1000);
      const conf2 = detector.getConfidence();

      detector.tapTempo(1500);
      const conf3 = detector.getConfidence();

      // Confidence should increase
      expect(conf2).toBeGreaterThan(conf1);
      expect(conf3).toBeGreaterThanOrEqual(conf2);
    });
  });

  describe('BeatInfo Structure', () => {
    it('should return all required fields', () => {
      const result = detector.process(generateKickSpectrum());

      expect(result).toHaveProperty('bpm');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('beat');
      expect(result).toHaveProperty('beatPhase');
      expect(result).toHaveProperty('beatStrength');
      expect(result).toHaveProperty('downbeat');
      expect(result).toHaveProperty('beatCount');
    });

    it('should return valid types', () => {
      const result = detector.process(generateKickSpectrum());

      expect(typeof result.bpm).toBe('number');
      expect(typeof result.confidence).toBe('number');
      expect(typeof result.beat).toBe('boolean');
      expect(typeof result.beatPhase).toBe('number');
      expect(typeof result.beatStrength).toBe('number');
      expect(typeof result.downbeat).toBe('boolean');
      expect(typeof result.beatCount).toBe('number');
    });

    it('should round BPM to integer', () => {
      detector.tapTempo(0);
      detector.tapTempo(545); // Would give ~110.09 BPM

      expect(Number.isInteger(detector.getBPM())).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty spectrum', () => {
      const emptySpectrum = new Float32Array(512);
      expect(() => detector.process(emptySpectrum)).not.toThrow();
    });

    it('should handle very loud input', () => {
      const loudSpectrum = new Float32Array(512).fill(1.0);
      const result = detector.process(loudSpectrum);

      expect(result.beatStrength).toBeLessThanOrEqual(1);
    });

    it('should handle single sample spectrum', () => {
      const tinySpectrum = new Float32Array(1);
      tinySpectrum[0] = 0.5;
      expect(() => detector.process(tinySpectrum)).not.toThrow();
    });
  });

  describe('Confidence', () => {
    it('should start with zero confidence', () => {
      expect(detector.getConfidence()).toBe(0);
    });

    it('should have confidence between 0 and 1', () => {
      // Process many frames
      for (let i = 0; i < 200; i++) {
        const spectrum = i % 30 === 0 ? generateKickSpectrum() : generateQuietSpectrum();
        detector.process(spectrum);
      }

      expect(detector.getConfidence()).toBeGreaterThanOrEqual(0);
      expect(detector.getConfidence()).toBeLessThanOrEqual(1);
    });
  });
});
