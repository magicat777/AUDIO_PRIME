<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { audioEngine } from '../../core/AudioEngine';
  import type { StereoAnalysisData } from '../../core/AudioEngine';
  import { renderCoordinator } from '../../core/RenderCoordinator';
  import { moduleVisibility } from '../../stores/moduleVisibility';

  const RENDER_ID = 'stereo-correlation-panel';

  // Display values with smoothing
  let correlation = 0;
  let stereoWidth = 0;
  let balance = 0;
  let midLevel = -100;
  let sideLevel = -100;

  // Smoothing for display
  const SMOOTHING = 0.85;
  let smoothedCorrelation = 0;
  let smoothedWidth = 0;
  let smoothedBalance = 0;

  // Sync visibility with RenderCoordinator
  $: renderCoordinator.setVisibility(RENDER_ID, $moduleVisibility.stereoCorrelation);

  // Reactive trigger for Svelte 5
  let frameCount = 0;
  $: displayCorrelation = smoothedCorrelation + frameCount * 0;
  $: displayWidth = smoothedWidth + frameCount * 0;
  $: displayBalance = smoothedBalance + frameCount * 0;
  $: displayMidLevel = midLevel + frameCount * 0;
  $: displaySideLevel = sideLevel + frameCount * 0;

  function updateDisplay() {
    const data = get(audioEngine.stereoAnalysis);

    correlation = data.correlation;
    stereoWidth = data.stereoWidth;
    balance = data.balance;
    midLevel = data.midLevel;
    sideLevel = data.sideLevel;

    // Apply smoothing
    smoothedCorrelation = smoothedCorrelation * SMOOTHING + correlation * (1 - SMOOTHING);
    smoothedWidth = smoothedWidth * SMOOTHING + stereoWidth * (1 - SMOOTHING);
    smoothedBalance = smoothedBalance * SMOOTHING + balance * (1 - SMOOTHING);

    frameCount++;
  }

  onMount(() => {
    // Register with centralized render coordinator (low priority for non-visual updates)
    renderCoordinator.register(RENDER_ID, updateDisplay, 'low');
  });

  onDestroy(() => {
    renderCoordinator.unregister(RENDER_ID);
  });

  // Correlation color: green = good (+1), yellow = wide (0), red = out of phase (-1)
  function getCorrelationColor(value: number): string {
    if (value < -0.5) return 'var(--meter-red)';
    if (value < 0) return 'var(--meter-orange)';
    if (value < 0.5) return 'var(--meter-yellow)';
    return 'var(--meter-green)';
  }

  // Get correlation label
  function getCorrelationLabel(value: number): string {
    if (value > 0.9) return 'MONO';
    if (value > 0.5) return 'CORR';
    if (value > 0) return 'WIDE';
    if (value > -0.5) return 'DIFF';
    return 'OUT';
  }

  // Convert correlation to meter position (0-100%)
  // -1 maps to 0%, 0 maps to 50%, +1 maps to 100%
  function correlationToPercent(value: number): number {
    return ((value + 1) / 2) * 100;
  }

  function formatDb(value: number): string {
    if (!isFinite(value) || value < -99) return '---';
    return value.toFixed(1);
  }
</script>

<div class="stereo-panel">
  <div class="panel-header">
    <span class="title">STEREO CORRELATION</span>
    <span class="status" style="color: {getCorrelationColor(displayCorrelation)}">
      {getCorrelationLabel(displayCorrelation)}
    </span>
  </div>

  <!-- Correlation Meter -->
  <div class="correlation-meter">
    <div class="meter-labels">
      <span class="label-left">-1</span>
      <span class="label-center">0</span>
      <span class="label-right">+1</span>
    </div>
    <div class="meter-bar">
      <!-- Center line at 0 -->
      <div class="center-line"></div>
      <!-- Fill from center -->
      <div
        class="meter-fill"
        style="
          left: {displayCorrelation >= 0 ? '50%' : correlationToPercent(displayCorrelation) + '%'};
          width: {Math.abs(displayCorrelation) * 50}%;
          background: {getCorrelationColor(displayCorrelation)};
        "
      ></div>
      <!-- Current position indicator -->
      <div
        class="position-indicator"
        style="left: {correlationToPercent(displayCorrelation)}%; background: {getCorrelationColor(displayCorrelation)};"
      ></div>
    </div>
    <div class="correlation-value mono">
      {displayCorrelation >= 0 ? '+' : ''}{displayCorrelation.toFixed(2)}
    </div>
  </div>

  <!-- Stats Row -->
  <div class="stats-row">
    <!-- Stereo Width -->
    <div class="stat-box">
      <span class="stat-label">WIDTH</span>
      <div class="mini-meter">
        <div class="mini-fill" style="width: {displayWidth * 100}%;"></div>
      </div>
      <span class="stat-value mono">{(displayWidth * 100).toFixed(0)}%</span>
    </div>

    <!-- Balance -->
    <div class="stat-box">
      <span class="stat-label">BALANCE</span>
      <div class="balance-meter">
        <div class="balance-center"></div>
        <div
          class="balance-indicator"
          style="left: {50 + displayBalance * 50}%;"
        ></div>
      </div>
      <span class="stat-value mono">
        {displayBalance < -0.05 ? 'L' : displayBalance > 0.05 ? 'R' : 'C'}
        {Math.abs(displayBalance) > 0.05 ? Math.abs(displayBalance * 100).toFixed(0) : ''}
      </span>
    </div>

    <!-- M/S Levels -->
    <div class="stat-box ms-levels">
      <div class="ms-item">
        <span class="stat-label">MID</span>
        <span class="stat-value mono">{formatDb(displayMidLevel)}</span>
      </div>
      <div class="ms-item">
        <span class="stat-label">SIDE</span>
        <span class="stat-value mono side-value">{formatDb(displaySideLevel)}</span>
      </div>
    </div>
  </div>
</div>

<style>
  .stereo-panel {
    display: flex;
    flex-direction: column;
    padding: 0.75rem;
    background: var(--bg-panel);
    border-radius: var(--border-radius);
    border: 1px solid var(--border-color);
    gap: 0.5rem;
    width: 100%;
    height: 100%;
    min-width: 200px;
    box-sizing: border-box;
    justify-content: space-between;
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

  .status {
    font-size: 0.7rem;
    font-weight: 600;
    font-family: var(--font-mono);
  }

  .correlation-meter {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .meter-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.6rem;
    font-family: var(--font-mono);
    color: var(--text-muted);
    padding: 0 2px;
  }

  .label-center {
    position: relative;
    left: 0;
  }

  .meter-bar {
    height: 32px;
    background: var(--bg-secondary);
    border-radius: 3px;
    position: relative;
    overflow: visible;
  }

  .center-line {
    position: absolute;
    left: 50%;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--border-color);
    transform: translateX(-50%);
    z-index: 1;
  }

  .meter-fill {
    position: absolute;
    top: 2px;
    height: calc(100% - 4px);
    border-radius: 2px;
    transition: all 50ms ease-out;
  }

  .position-indicator {
    position: absolute;
    top: -2px;
    width: 4px;
    height: calc(100% + 4px);
    border-radius: 2px;
    transform: translateX(-50%);
    transition: left 50ms ease-out;
    z-index: 2;
  }

  .correlation-value {
    font-size: 1.4rem;
    font-weight: 500;
    color: var(--text-primary);
    text-align: center;
    padding-top: 0.5rem;
  }

  .stats-row {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    padding-top: 0.25rem;
    border-top: 1px solid var(--border-color);
  }

  .stat-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    flex: 1;
  }

  .stat-label {
    font-size: 0.55rem;
    color: var(--text-muted);
    letter-spacing: 0.05em;
  }

  .stat-value {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .mini-meter {
    width: 100%;
    height: 6px;
    background: var(--bg-secondary);
    border-radius: 3px;
    overflow: hidden;
  }

  .mini-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--meter-green), var(--meter-yellow));
    border-radius: 3px;
    transition: width 50ms ease-out;
  }

  .balance-meter {
    width: 100%;
    height: 6px;
    background: var(--bg-secondary);
    border-radius: 3px;
    position: relative;
  }

  .balance-center {
    position: absolute;
    left: 50%;
    top: 0;
    width: 2px;
    height: 100%;
    background: var(--border-color);
    transform: translateX(-50%);
  }

  .balance-indicator {
    position: absolute;
    top: -1px;
    width: 6px;
    height: 8px;
    background: var(--accent-color);
    border-radius: 2px;
    transform: translateX(-50%);
    transition: left 50ms ease-out;
  }

  .ms-levels {
    flex-direction: row;
    gap: 0.75rem;
  }

  .ms-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
  }

  .side-value {
    color: var(--accent-color);
  }
</style>
