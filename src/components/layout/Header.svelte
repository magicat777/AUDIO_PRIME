<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { audioEngine } from '../../core/AudioEngine';
  import { performanceMonitor } from '../../core/PerformanceMonitor';

  const dispatch = createEventDispatcher();

  let isCapturing = false;
  let currentDevice: string = 'No device';
  let fps = 0;
  let memoryUsage = 0;
  let cpuPercent = 0;
  let gpuPercent = 0;

  // Subscribe to stores
  audioEngine.state.subscribe((state) => {
    isCapturing = state.isCapturing;
    currentDevice = state.currentDevice?.name || 'No device';
  });

  performanceMonitor.stats.subscribe((stats) => {
    fps = stats.fps;
    memoryUsage = stats.memoryUsage;
    cpuPercent = stats.cpuPercent;
    gpuPercent = stats.gpuPercent;
  });

  async function toggleCapture() {
    if (isCapturing) {
      await audioEngine.stop();
    } else {
      await audioEngine.start();
    }
  }

  function handleQuit() {
    window.electronAPI?.window.quit();
  }
</script>

<header class="header">
  <div class="header-left">
    <button class="menu-button" on:click={() => dispatch('menuClick')} aria-label="Open menu">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" stroke-width="2" fill="none" />
      </svg>
    </button>
    <h1 class="title">AUDIO<span class="accent">_PRIME</span></h1>
  </div>

  <div class="header-center">
    <button
      class="capture-button"
      class:active={isCapturing}
      on:click={toggleCapture}
    >
      {#if isCapturing}
        <span class="pulse"></span>
        <span>CAPTURING</span>
      {:else}
        <span>START</span>
      {/if}
    </button>
    <span class="device-name mono">{currentDevice}</span>
  </div>

  <div class="header-right">
    <div class="stat">
      <span class="stat-label">CPU</span>
      <span class="stat-value mono" class:warning={cpuPercent > 80} class:good={cpuPercent < 50}>{cpuPercent}%</span>
    </div>
    <div class="stat">
      <span class="stat-label">GPU</span>
      <span class="stat-value mono" class:warning={gpuPercent > 80} class:good={gpuPercent < 50}>{gpuPercent}%</span>
    </div>
    <div class="stat">
      <span class="stat-label">FPS</span>
      <span class="stat-value mono" class:warning={fps < 50} class:good={fps >= 55}>{fps}</span>
    </div>
    <div class="stat">
      <span class="stat-label">MEM</span>
      <span class="stat-value mono">{memoryUsage.toFixed(0)}MB</span>
    </div>
    <button class="power-button" on:click={handleQuit} aria-label="Quit application" title="Quit (Q)">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
        <line x1="12" y1="2" x2="12" y2="12" />
      </svg>
    </button>
  </div>
</header>

<style>
  .header {
    height: var(--header-height);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 var(--panel-padding);
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    gap: 1rem;
  }

  .header-left,
  .header-right {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .header-center {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .menu-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 4px;
    transition: background var(--transition-fast);
  }

  .menu-button:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .title {
    font-size: 1.25rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    color: var(--text-primary);
  }

  .accent {
    color: var(--accent-color);
  }

  .capture-button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 0.85rem;
    font-weight: 500;
    letter-spacing: 0.05em;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .capture-button:hover {
    background: var(--bg-panel);
    border-color: var(--accent-color);
  }

  .capture-button.active {
    background: rgba(239, 68, 68, 0.15);
    border-color: var(--error-color);
    color: var(--error-color);
  }

  .pulse {
    width: 8px;
    height: 8px;
    background: var(--error-color);
    border-radius: 50%;
    animation: pulse 1s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  .device-name {
    font-size: 0.8rem;
    color: var(--text-muted);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .stat {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.1rem;
  }

  .stat-label {
    font-size: 0.65rem;
    color: var(--text-muted);
    letter-spacing: 0.1em;
  }

  .stat-value {
    font-size: 0.9rem;
    color: var(--text-secondary);
  }

  .stat-value.good {
    color: var(--success-color);
  }

  .stat-value.warning {
    color: var(--warning-color);
  }

  .power-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid var(--error-color);
    border-radius: 4px;
    color: var(--error-color);
    cursor: pointer;
    transition: all var(--transition-fast);
    margin-left: 0.5rem;
  }

  .power-button:hover {
    background: rgba(239, 68, 68, 0.3);
    border-color: var(--error-color);
    color: var(--error-color);
  }
</style>
