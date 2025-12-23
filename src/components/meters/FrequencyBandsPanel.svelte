<script lang="ts">
  import { onDestroy } from 'svelte';
  import { audioEngine } from '../../core/AudioEngine';

  // Display mode: 'horizontal' or 'vertical'
  type DisplayMode = 'horizontal' | 'vertical';
  let displayMode: DisplayMode = 'horizontal';

  function toggleDisplayMode() {
    displayMode = displayMode === 'horizontal' ? 'vertical' : 'horizontal';
  }

  // Reactive label for toggle button
  $: modeLabel = displayMode === 'horizontal' ? 'HORIZ' : 'VERT';

  // Frequency band analysis with peak hold
  interface BandInfo {
    name: string;
    label: string;
    range: string;
    peak: number;
    avg: number;
    peakHold: number;
    peakHoldTime: number;
  }

  let bands: BandInfo[] = [];
  let dominantFreq = 0;
  let signalPresent = false;

  // Track previous mode to reset peak holds on mode change
  let previousMode: DisplayMode = displayMode;

  // Peak hold settings
  const PEAK_HOLD_TIME_MS = 1500;
  const PEAK_DECAY_RATE = 0.15;

  // Spectrum configuration
  const TOTAL_BARS = 512;
  const SPECTRUM_MIN_FREQ = 20;
  const SPECTRUM_MAX_FREQ = 20000;

  // Band definitions for horizontal mode (7 bands)
  const BAND_RANGES_HORIZONTAL = [
    { name: 'Sub-Bass', label: '20', min: 20, max: 60 },
    { name: 'Bass', label: '60', min: 60, max: 250 },
    { name: 'Low-Mid', label: '250', min: 250, max: 500 },
    { name: 'Mid', label: '500', min: 500, max: 2000 },
    { name: 'Upper-Mid', label: '2k', min: 2000, max: 4000 },
    { name: 'Presence', label: '4k', min: 4000, max: 6000 },
    { name: 'Brilliance', label: '6k', min: 6000, max: 20000 },
  ];

  // Band definitions for vertical mode (14 bands with frequency labels)
  const BAND_RANGES_VERTICAL = [
    { name: '20-40', label: '20', min: 20, max: 40 },
    { name: '40-63', label: '40', min: 40, max: 63 },
    { name: '63-125', label: '63', min: 63, max: 125 },
    { name: '125-250', label: '125', min: 125, max: 250 },
    { name: '250-500', label: '250', min: 250, max: 500 },
    { name: '500-1k', label: '500', min: 500, max: 1000 },
    { name: '1k-2k', label: '1k', min: 1000, max: 2000 },
    { name: '2k-3k', label: '2k', min: 2000, max: 3000 },
    { name: '3k-4k', label: '3k', min: 3000, max: 4000 },
    { name: '4k-5k', label: '4k', min: 4000, max: 5000 },
    { name: '5k-6k', label: '5k', min: 5000, max: 6000 },
    { name: '6k-10k', label: '6k', min: 6000, max: 10000 },
    { name: '10k-16k', label: '10k', min: 10000, max: 16000 },
    { name: '16k-20k', label: '16k', min: 16000, max: 20000 },
  ];

  // Get current band ranges based on display mode
  function getCurrentBandRanges() {
    return displayMode === 'horizontal' ? BAND_RANGES_HORIZONTAL : BAND_RANGES_VERTICAL;
  }

  // Peak hold state (dynamically sized based on mode)
  let peakHolds: number[] = new Array(14).fill(0);
  let peakHoldTimes: number[] = new Array(14).fill(0);

  // Reset peak holds when mode changes
  $: if (displayMode !== previousMode) {
    const ranges = getCurrentBandRanges();
    peakHolds = new Array(ranges.length).fill(0);
    peakHoldTimes = new Array(ranges.length).fill(0);
    previousMode = displayMode;
  }

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
    const bandRanges = getCurrentBandRanges();
    return bandRanges.map((band, idx) => {
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
        label: band.label,
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
    <button
      class="mode-toggle"
      on:click={toggleDisplayMode}
      title="Toggle between horizontal and vertical bars"
      aria-label="Toggle display mode"
    >
      <span class="toggle-label">{modeLabel}</span>
      <span class="toggle-indicator" class:vertical-mode={displayMode === 'vertical'}></span>
    </button>
  </div>

  {#if displayMode === 'horizontal'}
    <div class="bands-container horizontal">
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
  {:else}
    <div class="bands-container vertical">
      {#each bands as band}
        <div class="band-column">
          <span class="band-value-top">{band.peakHold.toFixed(0)}</span>
          <div class="band-meter-vertical">
            <div class="band-fill-vertical" style="height: {Math.max(0, Math.min(100, band.avg))}%"></div>
            <div class="band-peak-hold-vertical" style="bottom: {Math.min(100, band.peakHold)}%"></div>
          </div>
          <span class="band-name-vertical">{band.label}</span>
        </div>
      {/each}
    </div>
  {/if}
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
    justify-content: space-between;
    align-items: center;
    padding-bottom: 0.25rem;
    border-bottom: 1px solid var(--border-color);
  }

  .dominant-freq {
    font-size: 0.7rem;
    font-family: var(--font-mono);
    color: var(--accent-color);
    font-weight: 500;
    text-align: right;
  }

  /* Mode Toggle Button */
  .mode-toggle {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 2px 6px;
    background: rgba(30, 35, 45, 0.9);
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 3px;
    color: #a0a0a0;
    font-size: 9px;
    font-family: monospace;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .mode-toggle:hover {
    background: rgba(40, 50, 70, 0.95);
    border-color: rgba(139, 92, 246, 0.6);
    color: #ffffff;
  }

  .toggle-label {
    font-weight: 600;
    letter-spacing: 0.05em;
  }

  .toggle-indicator {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #8b5cf6;
    transition: background 0.15s ease;
  }

  .toggle-indicator.vertical-mode {
    background: #22c55e;
  }

  /* Horizontal Mode (default) */
  .bands-container.horizontal {
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

  /* Vertical Mode */
  .bands-container.vertical {
    display: flex;
    flex-direction: row;
    gap: 0.25rem;
    flex: 1;
    justify-content: space-around;
    align-items: stretch;
  }

  .band-column {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    flex: 1;
    min-width: 0;
  }

  .band-value-top {
    font-size: 0.6rem;
    font-family: var(--font-mono);
    color: var(--text-secondary);
    height: 14px;
  }

  .band-meter-vertical {
    flex: 1;
    width: 100%;
    max-width: 16px;
    position: relative;
    background: var(--bg-secondary);
    border-radius: 2px;
    overflow: visible;
  }

  .band-fill-vertical {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    max-height: 100%;
    background: linear-gradient(0deg,
      var(--meter-green) 0%,
      var(--meter-yellow) 60%,
      var(--meter-red) 100%
    );
    transition: height 50ms ease-out;
    border-radius: 2px;
  }

  .band-peak-hold-vertical {
    position: absolute;
    left: 0;
    width: 100%;
    height: 2px;
    background: #fff;
    transform: translateY(1px);
    transition: bottom 50ms ease-out;
    box-shadow: 0 0 4px rgba(255, 255, 255, 0.6);
  }

  .band-name-vertical {
    font-size: 0.55rem;
    color: var(--text-muted);
    white-space: nowrap;
    text-align: center;
    height: 14px;
  }
</style>
