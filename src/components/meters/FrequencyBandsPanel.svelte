<script lang="ts">
  import { onDestroy } from 'svelte';
  import { audioEngine } from '../../core/AudioEngine';

  // Frequency band analysis with peak hold
  interface BandInfo {
    name: string;
    range: string;
    peak: number;
    avg: number;
    peakHold: number;
    peakHoldTime: number;
  }

  let bands: BandInfo[] = [];
  let dominantFreq = 0;
  let signalPresent = false;

  // Peak hold settings
  const PEAK_HOLD_TIME_MS = 1500;
  const PEAK_DECAY_RATE = 0.15;

  // Spectrum configuration
  const TOTAL_BARS = 512;
  const SPECTRUM_MIN_FREQ = 20;
  const SPECTRUM_MAX_FREQ = 20000;

  // Band definitions (Hz)
  const BAND_RANGES = [
    { name: 'Sub-Bass', min: 20, max: 60 },
    { name: 'Bass', min: 60, max: 250 },
    { name: 'Low-Mid', min: 250, max: 500 },
    { name: 'Mid', min: 500, max: 2000 },
    { name: 'Upper-Mid', min: 2000, max: 4000 },
    { name: 'Presence', min: 4000, max: 6000 },
    { name: 'Brilliance', min: 6000, max: 20000 },
  ];

  // Peak hold state
  const peakHolds: number[] = BAND_RANGES.map(() => 0);
  const peakHoldTimes: number[] = BAND_RANGES.map(() => 0);

  // Convert frequency to bar index (logarithmic mapping)
  function freqToBar(freq: number): number {
    const t = Math.log(freq / SPECTRUM_MIN_FREQ) / Math.log(SPECTRUM_MAX_FREQ / SPECTRUM_MIN_FREQ);
    return Math.floor(t * (TOTAL_BARS - 1));
  }

  // Convert bar index back to frequency
  function barToFreq(bar: number): number {
    const t = bar / (TOTAL_BARS - 1);
    return SPECTRUM_MIN_FREQ * Math.pow(SPECTRUM_MAX_FREQ / SPECTRUM_MIN_FREQ, t);
  }

  function analyzeBands(spec: Float32Array, now: number): BandInfo[] {
    return BAND_RANGES.map((band, idx) => {
      const startBar = freqToBar(band.min);
      const endBar = Math.min(freqToBar(band.max), spec.length - 1);

      let peak = 0;
      let sum = 0;
      let count = 0;

      for (let i = startBar; i <= endBar; i++) {
        const val = spec[i] || 0;
        peak = Math.max(peak, val);
        sum += val;
        count++;
      }

      const avgPercent = count > 0 ? (sum / count) * 100 : 0;

      // Update peak hold with decay
      if (avgPercent > peakHolds[idx]) {
        peakHolds[idx] = avgPercent;
        peakHoldTimes[idx] = now;
      } else if (now - peakHoldTimes[idx] > PEAK_HOLD_TIME_MS) {
        peakHolds[idx] = Math.max(avgPercent, peakHolds[idx] - PEAK_DECAY_RATE * peakHolds[idx]);
      }

      return {
        name: band.name,
        range: `${band.min}-${band.max}Hz`,
        peak: peak * 100,
        avg: avgPercent,
        peakHold: peakHolds[idx],
        peakHoldTime: peakHoldTimes[idx],
      };
    });
  }

  function findDominantFreq(spec: Float32Array): number {
    let maxVal = 0;
    let maxBar = 0;

    for (let i = 1; i < spec.length; i++) {
      if (spec[i] > maxVal) {
        maxVal = spec[i];
        maxBar = i;
      }
    }

    return barToFreq(maxBar);
  }

  // Subscribe to spectrum data
  const unsubSpectrum = audioEngine.spectrum.subscribe((data) => {
    const now = performance.now();
    bands = analyzeBands(data, now);
    dominantFreq = findDominantFreq(data);
    signalPresent = data.some(v => v > 0.05);
  });

  onDestroy(() => {
    unsubSpectrum();
  });
</script>

<div class="frequency-bands-panel">
  <div class="panel-header">
    <span class="dominant-freq">
      {signalPresent ? `${dominantFreq.toFixed(0)} Hz` : '--- Hz'}
    </span>
  </div>

  <div class="bands-container">
    {#each bands as band}
      <div class="band-row">
        <span class="band-name">{band.name}</span>
        <div class="band-meter">
          <div class="band-fill" style="width: {Math.max(0, Math.min(100, band.avg))}%"></div>
          <div class="band-peak-hold" style="left: {Math.min(100, band.peakHold)}%"></div>
        </div>
        <span class="band-value">{band.peakHold.toFixed(0)}</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .frequency-bands-panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding: 0.5rem;
    background: var(--bg-panel);
    border-radius: var(--border-radius);
    gap: 0.5rem;
    box-sizing: border-box;
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    padding-bottom: 0.25rem;
    border-bottom: 1px solid var(--border-color);
  }

  .dominant-freq {
    font-size: 0.7rem;
    font-family: var(--font-mono);
    color: var(--accent-color);
    font-weight: 500;
  }

  .bands-container {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    flex: 1;
    justify-content: space-around;
  }

  .band-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .band-name {
    width: 65px;
    font-size: 0.65rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .band-meter {
    flex: 1;
    height: 10px;
    position: relative;
    background: var(--bg-secondary);
    border-radius: 2px;
    overflow: visible;
  }

  .band-fill {
    height: 100%;
    max-width: 100%;
    background: linear-gradient(90deg,
      var(--meter-green) 0%,
      var(--meter-yellow) 60%,
      var(--meter-red) 100%
    );
    transition: width 50ms ease-out;
    border-radius: 2px;
  }

  .band-peak-hold {
    position: absolute;
    top: 0;
    width: 2px;
    height: 100%;
    background: #fff;
    transform: translateX(-1px);
    transition: left 50ms ease-out;
    box-shadow: 0 0 4px rgba(255, 255, 255, 0.6);
  }

  .band-value {
    width: 28px;
    text-align: right;
    font-size: 0.65rem;
    font-family: var(--font-mono);
    color: var(--text-secondary);
  }
</style>
