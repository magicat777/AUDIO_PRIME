<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { audioEngine } from '../../core/AudioEngine';
  import { renderCoordinator } from '../../core/RenderCoordinator';
  import { moduleVisibility } from '../../stores/moduleVisibility';
  import type { MenuGroup } from '../ui/PanelGearMenu.svelte';

  const RENDER_ID = 'meter-panel';

  // Sync visibility with RenderCoordinator
  $: renderCoordinator.setVisibility(RENDER_ID, $moduleVisibility.vuMeters);

  // Display mode: 'horizontal' or 'vertical'
  type DisplayMode = 'horizontal' | 'vertical';
  let displayMode: DisplayMode = 'horizontal';

  // Gear menu configuration
  let gearMenuGroups: MenuGroup[] = [];
  $: gearMenuGroups = [
    {
      id: 'displayMode',
      label: 'Layout',
      type: 'select',
      value: displayMode,
      options: [
        { value: 'horizontal', label: 'HORIZ', color: '#4a9eff' },
        { value: 'vertical', label: 'VERT', color: '#22c55e' },
      ],
    },
  ];

  export function handleGearMenuChange(event: CustomEvent<{ groupId: string; value: string | boolean }>) {
    const { groupId, value } = event.detail;
    if (groupId === 'displayMode') {
      displayMode = value as DisplayMode;
    }
  }

  // Allow parent to set display mode
  export function setDisplayMode(mode: DisplayMode) {
    displayMode = mode;
  }

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
  }

  onMount(() => {
    // Register with centralized render coordinator (high priority for VU meters)
    renderCoordinator.register(RENDER_ID, updateMeters, 'high');
  });

  onDestroy(() => {
    renderCoordinator.unregister(RENDER_ID);
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

<div class="meter-panel" class:vertical-mode={displayMode === 'vertical'}>
  <div class="panel-header">
    <span class="peak-label" class:clipping={displayPeakLevel > -1}>
      PEAK: {displayPeakLevel > -100 ? displayPeakLevel.toFixed(1) : '---'} dB
    </span>
  </div>

  {#if displayMode === 'horizontal'}
    <!-- Horizontal Mode -->
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
  {:else}
    <!-- Vertical Mode -->
    <div class="vertical-meters">
      <div class="vu-meter-vertical">
        <div class="meter-value-top mono">{displayLeftLevel > -100 ? displayLeftLevel.toFixed(1) : '---'}</div>
        <div class="meter-bar-vertical">
          <div
            class="meter-fill-vertical"
            style="height: {dbToPercent(displayLeftLevel)}%; background: {getMeterColor(displayLeftLevel)}"
          ></div>
          <div
            class="peak-hold-vertical"
            style="bottom: {dbToPercent(displayPeakHoldL)}%; background: {getPeakHoldColor(displayPeakHoldL)}"
          ></div>
        </div>
        <div class="meter-label-vertical">L</div>
      </div>

      <div class="meter-scale-vertical">
        <span>0</span>
        <span>-6</span>
        <span>-12</span>
        <span>-24</span>
        <span>-40</span>
        <span>-60</span>
      </div>

      <div class="vu-meter-vertical">
        <div class="meter-value-top mono">{displayRightLevel > -100 ? displayRightLevel.toFixed(1) : '---'}</div>
        <div class="meter-bar-vertical">
          <div
            class="meter-fill-vertical"
            style="height: {dbToPercent(displayRightLevel)}%; background: {getMeterColor(displayRightLevel)}"
          ></div>
          <div
            class="peak-hold-vertical"
            style="bottom: {dbToPercent(displayPeakHoldR)}%; background: {getPeakHoldColor(displayPeakHoldR)}"
          ></div>
        </div>
        <div class="meter-label-vertical">R</div>
      </div>
    </div>

    <div class="stats-vertical">
      <div class="stat-row-vertical">
        <span class="stat-label">RMS</span>
        <span class="stat-value mono">L: {displayLeftLevel > -100 ? displayLeftLevel.toFixed(1) : '---'}</span>
        <span class="stat-value mono">R: {displayRightLevel > -100 ? displayRightLevel.toFixed(1) : '---'}</span>
      </div>
      <div class="stat-row-vertical">
        <span class="stat-label">CREST</span>
        <span class="stat-value mono" class:high-crest={displayCrestL > 12}>
          L: {displayCrestL > 0 ? displayCrestL.toFixed(1) : '---'}
        </span>
        <span class="stat-value mono" class:high-crest={displayCrestR > 12}>
          R: {displayCrestR > 0 ? displayCrestR.toFixed(1) : '---'}
        </span>
      </div>
      <div class="stat-row-vertical">
        <span class="stat-label">AVG CREST</span>
        <span class="stat-value mono crest-avg" class:compressed={((displayCrestL + displayCrestR) / 2) < 6} class:dynamic={((displayCrestL + displayCrestR) / 2) >= 12}>
          {((displayCrestL + displayCrestR) / 2) > 0 ? ((displayCrestL + displayCrestR) / 2).toFixed(1) : '---'} dB
        </span>
      </div>
    </div>
  {/if}
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

  /* Vertical Mode Styles */
  .vertical-meters {
    display: flex;
    justify-content: center;
    align-items: stretch;
    gap: 0.5rem;
    flex: 1;
    min-height: 0;
  }

  .vu-meter-vertical {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    flex: 1;
    max-width: 40px;
  }

  .meter-value-top {
    font-size: 0.65rem;
    color: var(--text-secondary);
    height: 14px;
    text-align: center;
  }

  .meter-bar-vertical {
    flex: 1;
    width: 100%;
    background: var(--bg-secondary);
    border-radius: 2px;
    position: relative;
    overflow: visible;
    min-height: 60px;
  }

  .meter-fill-vertical {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    max-height: 100%;
    transition: height 50ms ease-out;
    border-radius: 2px;
  }

  .peak-hold-vertical {
    position: absolute;
    left: -2px;
    width: calc(100% + 4px);
    height: 3px;
    border-radius: 1px;
    transition: bottom 50ms ease-out;
    transform: translateY(50%);
  }

  .meter-label-vertical {
    font-size: 0.7rem;
    font-weight: 500;
    color: var(--text-secondary);
    text-align: center;
  }

  .meter-scale-vertical {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 14px 0.25rem;
    font-family: var(--font-mono);
    font-size: 0.5rem;
    color: var(--text-muted);
    text-align: center;
    min-height: 60px;
  }

  .stats-vertical {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding-top: 0.35rem;
    border-top: 1px solid var(--border-color);
  }

  .stat-row-vertical {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .stat-row-vertical .stat-label {
    width: 70px;
    text-align: left;
  }
</style>
