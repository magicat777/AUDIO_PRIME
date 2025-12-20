<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { audioEngine } from '../../core/AudioEngine';
  import type { VoiceInfo } from '../../analysis/VoiceDetector';

  // Voice info state
  let voiceInfo: VoiceInfo = {
    detected: false,
    confidence: 0,
    probability: 0,
    pitch: 0,
    formants: [],
    classification: 'instrumental',
    voiceRatio: 0,
    centroid: 0,
    vibratoRate: 0,
    vibratoDepth: 0,
    pitchStability: 0.5,
    hasVibrato: false,
  };

  // Animation frame tracking
  let animationId: number | null = null;
  let frameCount = 0;

  // Reactive triggers for Svelte 5
  $: displayDetected = voiceInfo.detected;
  $: displayConfidence = voiceInfo.confidence + frameCount * 0;
  $: displayPitch = voiceInfo.pitch + frameCount * 0;
  $: displayClassification = voiceInfo.classification;
  $: displayFormants = voiceInfo.formants;
  $: displayVoiceRatio = voiceInfo.voiceRatio + frameCount * 0;
  $: displayCentroid = voiceInfo.centroid + frameCount * 0;
  $: displayVibratoRate = voiceInfo.vibratoRate + frameCount * 0;
  $: displayVibratoDepth = voiceInfo.vibratoDepth + frameCount * 0;
  $: displayPitchStability = voiceInfo.pitchStability + frameCount * 0;
  $: displayHasVibrato = voiceInfo.hasVibrato;

  // Update loop using requestAnimationFrame
  function updateVoiceInfo() {
    voiceInfo = get(audioEngine.voiceInfo);
    frameCount++;
    animationId = requestAnimationFrame(updateVoiceInfo);
  }

  // Get color based on confidence
  function getConfidenceColor(conf: number): string {
    if (conf > 70) return 'var(--meter-green)';
    if (conf > 40) return 'var(--meter-yellow)';
    if (conf > 20) return 'var(--meter-orange)';
    return 'var(--text-muted)';
  }

  // Get classification label
  function getClassificationLabel(classification: string): string {
    switch (classification) {
      case 'singing': return 'SINGING';
      case 'speech': return 'SPEECH';
      case 'voice': return 'VOICE';
      case 'instrumental': return 'INSTR';
      default: return '---';
    }
  }

  // Get classification color
  function getClassificationColor(classification: string): string {
    switch (classification) {
      case 'singing': return 'var(--accent-color)';
      case 'speech': return 'var(--meter-green)';
      case 'voice': return 'var(--meter-yellow)';
      case 'instrumental': return 'var(--text-muted)';
      default: return 'var(--text-muted)';
    }
  }

  onMount(() => {
    animationId = requestAnimationFrame(updateVoiceInfo);
  });

  onDestroy(() => {
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
    }
  });
</script>

<div class="voice-panel">
  <div class="panel-header">
    <span class="title">VOICE DETECTION</span>
    <span class="status" class:active={displayDetected}>
      {displayDetected ? 'DETECTED' : 'NONE'}
    </span>
  </div>

  <div class="voice-content">
    <!-- Left: Classification indicator -->
    <div class="classification-section">
      <div class="classification-box" class:active={displayDetected}>
        <span class="classification-label" style="color: {getClassificationColor(displayClassification)}">
          {getClassificationLabel(displayClassification)}
        </span>
      </div>
      <!-- Confidence label and value -->
      <div class="confidence-header">
        <span class="conf-label">CONFIDENCE</span>
        <span class="conf-value mono">{displayConfidence}%</span>
      </div>
    </div>

    <!-- Right: Stats grid -->
    <div class="stats-section">
      <div class="stats-grid">
        <div class="stat-item">
          <span class="stat-label">Pitch</span>
          <span class="stat-value mono">{displayPitch > 0 ? `${displayPitch} Hz` : '---'}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Vibrato</span>
          <span class="stat-value mono" class:vibrato-active={displayHasVibrato}>
            {displayHasVibrato ? `${displayVibratoRate} Hz` : '---'}
          </span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Stability</span>
          <span class="stat-value mono">{Math.round(displayPitchStability * 100)}%</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Centroid</span>
          <span class="stat-value mono">{displayCentroid > 0 ? `${displayCentroid} Hz` : '---'}</span>
        </div>
      </div>

      <!-- Formants row - always show F1-F4 labels -->
      <div class="formants-section">
        <span class="formants-label">FORMANTS</span>
        <div class="formants-list">
          <span class="formant-value mono">F1: {displayFormants[0] ? displayFormants[0] + 'Hz' : '---'}</span>
          <span class="formant-value mono">F2: {displayFormants[1] ? displayFormants[1] + 'Hz' : '---'}</span>
          <span class="formant-value mono">F3: {displayFormants[2] ? displayFormants[2] + 'Hz' : '---'}</span>
          <span class="formant-value mono">F4: {displayFormants[3] ? displayFormants[3] + 'Hz' : '---'}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Full-width confidence meter bar only -->
  <div class="meter-bar full-width">
    <div
      class="meter-fill"
      style="width: {displayConfidence}%; background: {getConfidenceColor(displayConfidence)}"
    ></div>
  </div>
</div>

<style>
  .voice-panel {
    display: flex;
    flex-direction: column;
    padding: 0.6rem 0.75rem;
    background: var(--bg-panel);
    border-radius: var(--border-radius);
    border: 1px solid var(--border-color);
    gap: 0.4rem;
    box-sizing: border-box;
    width: 465px;
    flex-shrink: 0;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 0.3rem;
    border-bottom: 1px solid var(--border-color);
  }

  .title {
    font-size: 0.7rem;
    font-weight: 500;
    color: var(--text-secondary);
    letter-spacing: 0.1em;
  }

  .status {
    font-size: 0.6rem;
    font-family: var(--font-mono);
    color: var(--text-muted);
    padding: 0.15rem 0.4rem;
    border-radius: 2px;
    background: var(--bg-secondary);
  }

  .status.active {
    color: var(--meter-green);
    background: rgba(34, 197, 94, 0.15);
  }

  .voice-content {
    display: flex;
    gap: 0.75rem;
    align-items: stretch;
  }

  .classification-section {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    width: 95px;
    flex-shrink: 0;
  }

  .classification-box {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.4rem 0.6rem;
    background: var(--bg-secondary);
    border-radius: 4px;
    transition: background 0.15s ease;
    flex: 1;
    min-height: 32px;
  }

  .classification-box.active {
    background: rgba(74, 158, 255, 0.1);
  }

  .classification-label {
    font-size: 1.1rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    white-space: nowrap;
  }

  .confidence-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .conf-label {
    font-size: 0.55rem;
    color: var(--text-muted);
    letter-spacing: 0.05em;
  }

  .conf-value {
    font-size: 0.7rem;
    color: var(--text-secondary);
  }

  .meter-bar {
    height: 6px;
    background: var(--bg-secondary);
    border-radius: 3px;
    overflow: hidden;
  }

  .meter-bar.full-width {
    height: 8px;
    border-radius: 4px;
  }

  .meter-fill {
    height: 100%;
    transition: width 50ms ease-out;
    border-radius: 3px;
  }

  .stats-section {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .stats-grid {
    display: flex;
    gap: 0.75rem;
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .stat-label {
    font-size: 0.55rem;
    color: var(--text-muted);
    letter-spacing: 0.03em;
  }

  .stat-value {
    font-size: 0.8rem;
    color: var(--text-secondary);
  }

  .formants-section {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding-top: 0.35rem;
    border-top: 1px solid var(--border-color);
  }

  .formants-label {
    font-size: 0.5rem;
    color: var(--text-muted);
    letter-spacing: 0.05em;
  }

  .formants-list {
    display: flex;
    gap: 0.3rem;
  }

  .formant-value {
    font-size: 0.65rem;
    color: var(--text-secondary);
    background: var(--bg-secondary);
    padding: 0.1rem 0.3rem;
    border-radius: 2px;
    white-space: nowrap;
  }

  .mono {
    font-family: var(--font-mono);
  }

  .vibrato-active {
    color: var(--accent-color);
    font-weight: 600;
  }
</style>
