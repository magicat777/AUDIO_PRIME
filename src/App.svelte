<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import AppShell from './components/layout/AppShell.svelte';
  import { audioEngine } from './core/AudioEngine';
  import { performanceMonitor } from './core/PerformanceMonitor';

  let initialized = false;
  let error: string | null = null;

  onMount(async () => {
    try {
      await audioEngine.initialize();
      performanceMonitor.start();
      initialized = true;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to initialize';
      console.error('Initialization error:', err);
    }
  });

  onDestroy(() => {
    audioEngine.destroy();
    performanceMonitor.stop();
  });
</script>

<main class="app">
  {#if error}
    <div class="error-screen">
      <h1>Initialization Error</h1>
      <p>{error}</p>
      <button on:click={() => window.location.reload()}>Retry</button>
    </div>
  {:else if !initialized}
    <div class="loading-screen">
      <div class="spinner"></div>
      <p>Initializing AUDIO_PRIME...</p>
    </div>
  {:else}
    <AppShell />
  {/if}
</main>

<style>
  .app {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg-primary);
  }

  .loading-screen,
  .error-screen {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
  }

  .spinner {
    width: 48px;
    height: 48px;
    border: 3px solid var(--border-color);
    border-top-color: var(--accent-color);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .error-screen h1 {
    color: var(--error-color);
  }

  .error-screen button {
    padding: 0.5rem 1.5rem;
    background: var(--accent-color);
    border: none;
    border-radius: 4px;
    color: white;
    cursor: pointer;
    font-size: 1rem;
  }

  .error-screen button:hover {
    opacity: 0.9;
  }
</style>
