<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { audioEngine } from '../../core/AudioEngine';
  import type { BeatInfo } from '../../analysis/BeatDetector';

  // Beat info state
  let beatInfo: BeatInfo = {
    bpm: 0,
    confidence: 0,
    beat: false,
    beatPhase: 0,
    beatStrength: 0,
    downbeat: false,
    beatCount: 0,
  };

  // Animation frame tracking
  let animationId: number | null = null;
  let frameCount = 0;

  // Reactive triggers for Svelte 5
  $: displayBPM = beatInfo.bpm + frameCount * 0;
  $: displayConfidence = beatInfo.confidence + frameCount * 0;
  $: displayBeatPhase = beatInfo.beatPhase + frameCount * 0;
  $: displayBeatStrength = beatInfo.beatStrength + frameCount * 0;
  $: displayBeatCount = beatInfo.beatCount + frameCount * 0;

  // Beat flash animation
  let beatFlash = false;
  let flashTimeout: number | null = null;
  let lastBeatCount = 0;

  // Update loop using requestAnimationFrame
  function updateBeatInfo() {
    const info = get(audioEngine.beatInfo);
    beatInfo = info;
    frameCount++;

    // Detect beat change for flash animation
    if (info.beatCount > lastBeatCount) {
      beatFlash = true;
      if (flashTimeout) clearTimeout(flashTimeout);
      flashTimeout = window.setTimeout(() => {
        beatFlash = false;
      }, 100);
      lastBeatCount = info.beatCount;
    }

    animationId = requestAnimationFrame(updateBeatInfo);
  }

  // Tap tempo
  function handleTap() {
    audioEngine.tapTempo();
  }

  // Reset
  function handleReset() {
    audioEngine.resetBeat();
  }

  // Format confidence as percentage
  function formatConfidence(conf: number): string {
    return Math.round(conf * 100) + '%';
  }

  // Get confidence color
  function getConfidenceColor(conf: number): string {
    if (conf > 0.7) return 'var(--meter-green)';
    if (conf > 0.4) return 'var(--meter-yellow)';
    return 'var(--meter-orange)';
  }

  onMount(() => {
    animationId = requestAnimationFrame(updateBeatInfo);
  });

  onDestroy(() => {
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
    }
    if (flashTimeout) clearTimeout(flashTimeout);
  });
</script>

<div class="bpm-panel">
  <div class="panel-header">
    <span class="title">TEMPO</span>
    <span class="standard">BPM</span>
  </div>

  <div class="bpm-display">
    <!-- Beat indicator -->
    <div class="beat-indicator" class:flash={beatFlash} class:downbeat={beatInfo.downbeat && beatFlash}>
      <div class="beat-ring" style="--phase: {displayBeatPhase}"></div>
    </div>

    <!-- BPM value -->
    <div class="bpm-value">
      <span class="bpm-number mono">{displayBPM > 0 ? displayBPM : '---'}</span>
    </div>

    <!-- Phase meter -->
    <div class="phase-meter">
      <div class="phase-fill" style="width: {displayBeatPhase * 100}%"></div>
    </div>
  </div>

  <div class="stats-row">
    <!-- Confidence -->
    <div class="stat-box">
      <span class="stat-label">CONF</span>
      <span class="stat-value mono" style="color: {getConfidenceColor(displayConfidence)}">
        {formatConfidence(displayConfidence)}
      </span>
    </div>

    <!-- Beat count -->
    <div class="stat-box">
      <span class="stat-label">BEATS</span>
      <span class="stat-value mono">{displayBeatCount}</span>
    </div>

    <!-- Strength -->
    <div class="stat-box">
      <span class="stat-label">STR</span>
      <div class="strength-bar">
        <div class="strength-fill" style="width: {displayBeatStrength * 100}%"></div>
      </div>
    </div>
  </div>

  <div class="controls-row">
    <button class="tap-button" on:click={handleTap} title="Tap to set tempo manually">
      TAP
    </button>
    <button class="reset-button" on:click={handleReset} title="Reset beat detection">
      RST
    </button>
  </div>
</div>

<style>
  .bpm-panel {
    display: flex;
    flex-direction: column;
    padding: 0.75rem;
    padding-bottom: 0.5rem;
    background: var(--bg-panel);
    border-radius: var(--border-radius);
    border: 1px solid var(--border-color);
    gap: 0.5rem;
    min-width: 160px;
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

  .bpm-display {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0;
  }

  .beat-indicator {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--bg-secondary);
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.05s ease;
  }

  .beat-indicator.flash {
    background: var(--accent-color);
    box-shadow: 0 0 20px rgba(74, 158, 255, 0.5);
  }

  .beat-indicator.downbeat {
    background: var(--meter-green);
    box-shadow: 0 0 25px rgba(34, 197, 94, 0.6);
  }

  .beat-ring {
    position: absolute;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    border: 2px solid transparent;
    border-top-color: var(--accent-color);
    transform: rotate(calc(var(--phase) * 360deg));
    transition: transform 16ms linear;
  }

  .bpm-value {
    display: flex;
    align-items: baseline;
    gap: 0.25rem;
  }

  .bpm-number {
    font-size: 2rem;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1;
  }

  .phase-meter {
    width: 100%;
    height: 4px;
    background: var(--bg-secondary);
    border-radius: 2px;
    overflow: hidden;
  }

  .phase-fill {
    height: 100%;
    background: var(--accent-color);
    transition: width 16ms linear;
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
    gap: 0.15rem;
    flex: 1;
  }

  .stat-label {
    font-size: 0.55rem;
    color: var(--text-muted);
    letter-spacing: 0.05em;
  }

  .stat-value {
    font-size: 0.75rem;
    color: var(--text-primary);
  }

  .strength-bar {
    width: 100%;
    max-width: 40px;
    height: 6px;
    background: var(--bg-secondary);
    border-radius: 3px;
    overflow: hidden;
  }

  .strength-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--meter-green), var(--meter-yellow), var(--meter-orange));
    transition: width 50ms ease-out;
  }

  .controls-row {
    display: flex;
    gap: 0.5rem;
    padding-top: 0.25rem;
  }

  .tap-button,
  .reset-button {
    flex: 1;
    padding: 0.4rem 0.5rem;
    font-size: 0.7rem;
    font-weight: 600;
    font-family: var(--font-mono);
    letter-spacing: 0.05em;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .tap-button {
    background: var(--accent-color);
    color: white;
    border-color: var(--accent-color);
  }

  .tap-button:hover {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  .tap-button:active {
    transform: scale(0.95);
  }

  .reset-button {
    background: var(--bg-secondary);
    color: var(--text-secondary);
  }

  .reset-button:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
</style>
