<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { writable } from 'svelte/store';

  // LUFS data store (will be connected to AudioEngine)
  export let momentary = -Infinity;
  export let shortTerm = -Infinity;
  export let integrated = -Infinity;
  export let range = 0;
  export let truePeak = -Infinity;

  // Display formatting
  function formatLUFS(value: number): string {
    if (!isFinite(value) || value < -70) return '---';
    return value.toFixed(1);
  }

  function formatLRA(value: number): string {
    if (!isFinite(value) || value <= 0) return '---';
    return value.toFixed(1);
  }

  function formatTP(value: number): string {
    if (!isFinite(value) || value < -70) return '---';
    return value.toFixed(1);
  }

  // Meter bar calculations
  function lufsToPercent(lufs: number): number {
    // Map -60 LUFS to 0 LUFS -> 0% to 100%
    const minLufs = -60;
    const maxLufs = 0;
    if (!isFinite(lufs)) return 0;
    return Math.max(0, Math.min(100, ((lufs - minLufs) / (maxLufs - minLufs)) * 100));
  }

  function getLUFSColor(lufs: number): string {
    if (lufs > -9) return 'var(--meter-red)';
    if (lufs > -14) return 'var(--meter-orange)';
    if (lufs > -18) return 'var(--meter-yellow)';
    return 'var(--meter-green)';
  }

  function getTPColor(tp: number): string {
    if (tp > -1) return 'var(--meter-red)';
    if (tp > -3) return 'var(--meter-orange)';
    return 'var(--meter-green)';
  }

  // Target references (EBU R128)
  const TARGET_INTEGRATED = -23; // EBU R128 broadcast
  const TARGET_STREAMING = -14; // Typical streaming target
</script>

<div class="lufs-panel">
  <div class="panel-header">
    <span class="title">LOUDNESS</span>
    <span class="standard">ITU-R BS.1770-4</span>
  </div>

  <div class="meters-grid">
    <!-- Momentary (M) -->
    <div class="meter-row">
      <div class="meter-label">M</div>
      <div class="meter-bar-container">
        <div class="meter-bar">
          <div
            class="meter-fill"
            style="width: {lufsToPercent(momentary)}%; background: {getLUFSColor(momentary)}"
          ></div>
          <!-- Target markers -->
          <div class="target-marker" style="left: {lufsToPercent(TARGET_INTEGRATED)}%" title="-23 LUFS (EBU)"></div>
          <div class="target-marker streaming" style="left: {lufsToPercent(TARGET_STREAMING)}%" title="-14 LUFS (Streaming)"></div>
        </div>
      </div>
      <div class="meter-value mono">{formatLUFS(momentary)}</div>
    </div>

    <!-- Short-term (S) -->
    <div class="meter-row">
      <div class="meter-label">S</div>
      <div class="meter-bar-container">
        <div class="meter-bar">
          <div
            class="meter-fill"
            style="width: {lufsToPercent(shortTerm)}%; background: {getLUFSColor(shortTerm)}"
          ></div>
          <div class="target-marker" style="left: {lufsToPercent(TARGET_INTEGRATED)}%"></div>
          <div class="target-marker streaming" style="left: {lufsToPercent(TARGET_STREAMING)}%"></div>
        </div>
      </div>
      <div class="meter-value mono">{formatLUFS(shortTerm)}</div>
    </div>

    <!-- Integrated (I) -->
    <div class="meter-row highlight">
      <div class="meter-label">I</div>
      <div class="meter-bar-container">
        <div class="meter-bar">
          <div
            class="meter-fill integrated"
            style="width: {lufsToPercent(integrated)}%; background: {getLUFSColor(integrated)}"
          ></div>
          <div class="target-marker" style="left: {lufsToPercent(TARGET_INTEGRATED)}%"></div>
          <div class="target-marker streaming" style="left: {lufsToPercent(TARGET_STREAMING)}%"></div>
        </div>
      </div>
      <div class="meter-value mono integrated-value">{formatLUFS(integrated)}</div>
    </div>

    <!-- Scale at bottom of all meters -->
    <div class="meter-scale-row">
      <div class="meter-label"></div>
      <div class="scale">
        <span>-60</span>
        <span>-36</span>
        <span>-24</span>
        <span>-14</span>
        <span>0</span>
      </div>
      <div class="meter-value"></div>
    </div>
  </div>

  <div class="stats-row">
    <!-- Loudness Range -->
    <div class="stat-box">
      <span class="stat-label">LRA</span>
      <span class="stat-value mono">{formatLRA(range)}</span>
      <span class="stat-unit">LU</span>
    </div>

    <!-- True Peak -->
    <div class="stat-box" class:warning={truePeak > -1}>
      <span class="stat-label">TP</span>
      <span class="stat-value mono" style="color: {getTPColor(truePeak)}">{formatTP(truePeak)}</span>
      <span class="stat-unit">dBTP</span>
    </div>

    <!-- Target Difference -->
    <div class="stat-box">
      <span class="stat-label">vs -14</span>
      <span class="stat-value mono" class:over={integrated > TARGET_STREAMING} class:under={integrated <= TARGET_STREAMING}>
        {isFinite(integrated) ? (integrated - TARGET_STREAMING > 0 ? '+' : '') + (integrated - TARGET_STREAMING).toFixed(1) : '---'}
      </span>
      <span class="stat-unit">LU</span>
    </div>
  </div>
</div>

<style>
  .lufs-panel {
    display: flex;
    flex-direction: column;
    padding: 0.75rem;
    padding-bottom: 0.5rem;
    background: var(--bg-panel);
    border-radius: var(--border-radius);
    border: 1px solid var(--border-color);
    gap: 0.5rem;
    width: 100%;
    height: 100%;
    min-width: 200px;
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

  .standard {
    font-size: 0.6rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .meters-grid {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .meter-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .meter-row.highlight {
    background: rgba(74, 158, 255, 0.05);
    margin: 0 -0.25rem;
    padding: 0.2rem 0.25rem;
    border-radius: 3px;
  }

  .meter-scale-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.1rem;
  }

  .meter-label {
    width: 14px;
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--text-muted);
    text-align: center;
  }

  .meter-bar-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .meter-bar {
    height: 12px;
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

  .meter-fill.integrated {
    background: linear-gradient(90deg, var(--meter-green), var(--accent-color)) !important;
  }

  .target-marker {
    position: absolute;
    top: -2px;
    width: 2px;
    height: calc(100% + 4px);
    background: rgba(255, 255, 255, 0.4);
    transform: translateX(-50%);
  }

  .target-marker.streaming {
    background: rgba(251, 191, 36, 0.5);
  }

  .scale {
    flex: 1;
    display: flex;
    justify-content: space-between;
    font-size: 0.55rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
    padding: 0 2px;
    border-top: 1px solid var(--border-color);
    padding-top: 0.15rem;
  }

  .meter-value {
    width: 36px;
    font-size: 0.75rem;
    color: var(--text-secondary);
    text-align: right;
  }

  .integrated-value {
    color: var(--accent-color);
    font-weight: 500;
  }

  .stats-row {
    display: flex;
    justify-content: space-between;
    padding-top: 0.25rem;
    border-top: 1px solid var(--border-color);
  }

  .stat-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    padding: 0.25rem 0.5rem;
    border-radius: 3px;
    transition: background var(--transition-fast);
  }

  .stat-box.warning {
    background: rgba(239, 68, 68, 0.1);
  }

  .stat-label {
    font-size: 0.6rem;
    color: var(--text-muted);
    letter-spacing: 0.05em;
  }

  .stat-value {
    font-size: 0.85rem;
    color: var(--text-primary);
  }

  .stat-value.over {
    color: var(--meter-red);
  }

  .stat-value.under {
    color: var(--meter-green);
  }

  .stat-unit {
    font-size: 0.55rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }
</style>
