<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { audioEngine } from '../../core/AudioEngine';

  // Display levels (with VU ballistics applied)
  let leftLevel = -100;
  let rightLevel = -100;
  let peakLevel = -100;

  // Raw input levels (before ballistics)
  let rawLeftLevel = -100;
  let rawRightLevel = -100;

  // VU meter ballistics (PPM-style response)
  const VU_ATTACK_MS = 10;  // Fast attack
  const VU_RELEASE_MS = 300; // Slower release (VU standard is ~300ms)

  // Peak hold values
  let peakHoldL = -100;
  let peakHoldR = -100;
  let peakHoldTime = 0;
  const PEAK_HOLD_MS = 1500;
  const PEAK_DECAY_RATE = 0.05; // dB per frame

  // Animation frame tracking
  let lastTime = performance.now();
  let animationId: number | null = null;

  // Crest factor tracking
  let crestFactorL = 0;
  let crestFactorR = 0;

  // Reactive trigger for Svelte 5 - forces DOM update
  let frameCount = 0;
  $: displayLeftLevel = leftLevel + frameCount * 0;  // Depend on frameCount for reactivity
  $: displayRightLevel = rightLevel + frameCount * 0;
  $: displayPeakLevel = peakLevel + frameCount * 0;
  $: displayPeakHoldL = peakHoldL + frameCount * 0;
  $: displayPeakHoldR = peakHoldR + frameCount * 0;
  $: displayCrestL = crestFactorL + frameCount * 0;
  $: displayCrestR = crestFactorR + frameCount * 0;

  // Update loop (runs every frame for smooth animation)
  function updateMeters() {
    const levels = get(audioEngine.levels);
    rawLeftLevel = levels.left;
    rawRightLevel = levels.right;
    peakLevel = levels.peak;
    frameCount++; // Trigger reactive update

    const now = performance.now();
    const deltaTime = Math.min(now - lastTime, 100); // Cap deltaTime to avoid jumps
    lastTime = now;

    // Apply VU ballistics to left channel
    if (rawLeftLevel > leftLevel) {
      // Attack - fast rise
      const attackCoeff = 1 - Math.exp(-deltaTime / VU_ATTACK_MS);
      leftLevel = leftLevel + (rawLeftLevel - leftLevel) * attackCoeff;
    } else {
      // Release - slower fall
      const releaseCoeff = 1 - Math.exp(-deltaTime / VU_RELEASE_MS);
      leftLevel = leftLevel + (rawLeftLevel - leftLevel) * releaseCoeff;
    }

    // Apply VU ballistics to right channel
    if (rawRightLevel > rightLevel) {
      const attackCoeff = 1 - Math.exp(-deltaTime / VU_ATTACK_MS);
      rightLevel = rightLevel + (rawRightLevel - rightLevel) * attackCoeff;
    } else {
      const releaseCoeff = 1 - Math.exp(-deltaTime / VU_RELEASE_MS);
      rightLevel = rightLevel + (rawRightLevel - rightLevel) * releaseCoeff;
    }

    // Update peak hold for left channel
    if (rawLeftLevel > peakHoldL) {
      peakHoldL = rawLeftLevel;
      peakHoldTime = now;
    } else if (now - peakHoldTime > PEAK_HOLD_MS) {
      peakHoldL = Math.max(peakHoldL - PEAK_DECAY_RATE * (deltaTime / 16.67), rawLeftLevel);
    }

    // Update peak hold for right channel
    if (rawRightLevel > peakHoldR) {
      peakHoldR = rawRightLevel;
    } else if (now - peakHoldTime > PEAK_HOLD_MS) {
      peakHoldR = Math.max(peakHoldR - PEAK_DECAY_RATE * (deltaTime / 16.67), rawRightLevel);
    }

    // Calculate crest factor (Peak - RMS in dB)
    // Crest factor indicates dynamic range / punchiness
    // Typical values: 3-6 dB for compressed audio, 12-20+ dB for dynamic audio
    if (rawLeftLevel > -99 && peakHoldL > -99) {
      const newCrestL = peakHoldL - rawLeftLevel;
      crestFactorL = crestFactorL * 0.9 + newCrestL * 0.1; // Smooth
    }
    if (rawRightLevel > -99 && peakHoldR > -99) {
      const newCrestR = peakHoldR - rawRightLevel;
      crestFactorR = crestFactorR * 0.9 + newCrestR * 0.1; // Smooth
    }

    // Continue animation loop
    animationId = requestAnimationFrame(updateMeters);
  }

  onMount(() => {
    // Start animation loop
    animationId = requestAnimationFrame(updateMeters);
  });

  onDestroy(() => {
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
    }
  });

  function dbToPercent(db: number): number {
    // Map -60dB to 0dB to 0-100%
    const minDb = -60;
    const maxDb = 0;
    return Math.max(0, Math.min(100, ((db - minDb) / (maxDb - minDb)) * 100));
  }

  function getMeterColor(db: number): string {
    if (db > -3) return 'var(--meter-red)';
    if (db > -6) return 'var(--meter-orange)';
    if (db > -12) return 'var(--meter-yellow)';
    return 'var(--meter-green)';
  }

  function getPeakHoldColor(db: number): string {
    if (db > -1) return 'var(--meter-red)';
    if (db > -3) return 'var(--meter-orange)';
    return 'var(--text-bright)';
  }
</script>

<div class="meter-panel">
  <div class="panel-header">
    <span class="title">VU METERS</span>
    <span class="peak-label" class:clipping={displayPeakLevel > -1}>
      PEAK: {displayPeakLevel > -100 ? displayPeakLevel.toFixed(1) : '---'} dB
    </span>
  </div>

  <div class="vu-meter">
    <div class="meter-label">L</div>
    <div class="meter-bar">
      <div
        class="meter-fill"
        style="width: {dbToPercent(displayLeftLevel)}%; background: {getMeterColor(displayLeftLevel)}"
      ></div>
      <div
        class="peak-hold"
        style="left: {dbToPercent(displayPeakHoldL)}%; background: {getPeakHoldColor(displayPeakHoldL)}"
      ></div>
    </div>
    <div class="meter-value mono">{displayLeftLevel > -100 ? displayLeftLevel.toFixed(1) : '---'}</div>
  </div>

  <div class="vu-meter">
    <div class="meter-label">R</div>
    <div class="meter-bar">
      <div
        class="meter-fill"
        style="width: {dbToPercent(displayRightLevel)}%; background: {getMeterColor(displayRightLevel)}"
      ></div>
      <div
        class="peak-hold"
        style="left: {dbToPercent(displayPeakHoldR)}%; background: {getPeakHoldColor(displayPeakHoldR)}"
      ></div>
    </div>
    <div class="meter-value mono">{displayRightLevel > -100 ? displayRightLevel.toFixed(1) : '---'}</div>
  </div>

  <div class="meter-scale">
    <span>-60</span>
    <span>-40</span>
    <span>-20</span>
    <span>-12</span>
    <span>-6</span>
    <span>-3</span>
    <span>0</span>
  </div>

  <div class="stats-row">
    <div class="stat-group">
      <span class="stat-label">RMS</span>
      <span class="stat-value mono">L: {displayLeftLevel > -100 ? displayLeftLevel.toFixed(1) : '---'}</span>
      <span class="stat-value mono">R: {displayRightLevel > -100 ? displayRightLevel.toFixed(1) : '---'}</span>
    </div>
    <div class="stat-group">
      <span class="stat-label">CREST</span>
      <span class="stat-value mono" class:high-crest={displayCrestL > 12}>
        L: {displayCrestL > 0 ? displayCrestL.toFixed(1) : '---'}
      </span>
      <span class="stat-value mono" class:high-crest={displayCrestR > 12}>
        R: {displayCrestR > 0 ? displayCrestR.toFixed(1) : '---'}
      </span>
    </div>
    <div class="stat-group">
      <span class="stat-label">AVG CREST</span>
      <span class="stat-value mono crest-avg" class:compressed={((displayCrestL + displayCrestR) / 2) < 6} class:dynamic={((displayCrestL + displayCrestR) / 2) >= 12}>
        {((displayCrestL + displayCrestR) / 2) > 0 ? ((displayCrestL + displayCrestR) / 2).toFixed(1) : '---'} dB
      </span>
    </div>
  </div>
</div>

<style>
  .meter-panel {
    width: 100%;
    height: 100%;
    min-width: 300px;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: var(--panel-padding);
    background: var(--bg-panel);
    border-radius: var(--border-radius);
    border: 1px solid var(--border-color);
    box-sizing: border-box;
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding-bottom: 0.25rem;
    border-bottom: 1px solid var(--border-color);
  }

  .title {
    font-size: 0.7rem;
    font-weight: 500;
    color: var(--text-secondary);
    letter-spacing: 0.1em;
  }

  .peak-label {
    font-size: 0.7rem;
    font-family: var(--font-mono);
    color: var(--text-muted);
  }

  .peak-label.clipping {
    color: var(--meter-red);
    font-weight: 600;
  }

  .vu-meter {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .meter-label {
    width: 16px;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-secondary);
    text-align: center;
  }

  .meter-bar {
    flex: 1;
    height: 20px;
    background: var(--bg-secondary);
    border-radius: 2px;
    position: relative;
    overflow: visible;
  }

  .meter-fill {
    height: 100%;
    transition: width 50ms ease-out;
    border-radius: 2px;
  }

  .peak-hold {
    position: absolute;
    top: -2px;
    width: 3px;
    height: calc(100% + 4px);
    border-radius: 1px;
    transition: left 50ms ease-out;
    transform: translateX(-50%);
  }

  .meter-value {
    width: 50px;
    font-size: 0.75rem;
    color: var(--text-secondary);
    text-align: right;
  }

  .meter-scale {
    display: flex;
    justify-content: space-between;
    margin-left: 24px;
    margin-right: 58px;
    padding-top: 0.25rem;
    border-top: 1px solid var(--border-color);
    font-family: var(--font-mono);
    font-size: 0.55rem;
    color: var(--text-muted);
  }

  .stats-row {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding-top: 0.35rem;
    border-top: 1px solid var(--border-color);
  }

  .stat-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .stat-label {
    font-size: 0.6rem;
    color: var(--text-muted);
    letter-spacing: 0.05em;
  }

  .stat-value {
    font-size: 0.7rem;
    color: var(--text-secondary);
  }

  .stat-value.high-crest {
    color: var(--meter-green);
  }

  .crest-avg {
    font-weight: 500;
  }

  .crest-avg.compressed {
    color: var(--meter-orange);
  }

  .crest-avg.dynamic {
    color: var(--meter-green);
  }
</style>
