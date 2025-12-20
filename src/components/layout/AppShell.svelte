<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import Header from './Header.svelte';
  import Sidebar from './Sidebar.svelte';
  import SpectrumPanel from '../panels/SpectrumPanel.svelte';
  import MeterPanel from '../panels/MeterPanel.svelte';
  import BassDetailPanel from '../panels/BassDetailPanel.svelte';
  import LUFSMeterPanel from '../meters/LUFSMeterPanel.svelte';
  import BPMPanel from '../meters/BPMPanel.svelte';
  import VoicePanel from '../meters/VoicePanel.svelte';
  import StereoCorrelationPanel from '../meters/StereoCorrelationPanel.svelte';
  import GoniometerPanel from '../meters/GoniometerPanel.svelte';
  import OscilloscopePanel from '../meters/OscilloscopePanel.svelte';
  import DebugPanel from '../panels/DebugPanel.svelte';
  import SpotifyPanel from '../spotify/SpotifyPanel.svelte';
  import { audioEngine } from '../../core/AudioEngine';
  import { moduleVisibility } from '../../stores/moduleVisibility';

  let sidebarOpen = false;
  let isCapturing = false;
  let lufsAnimationId: number | null = null;

  // LUFS data
  let momentary = -Infinity;
  let shortTerm = -Infinity;
  let integrated = -Infinity;
  let range = 0;
  let truePeak = -Infinity;

  // Reactive trigger for Svelte 5
  let frameCount = 0;
  $: displayMomentary = momentary + frameCount * 0;
  $: displayShortTerm = shortTerm + frameCount * 0;
  $: displayIntegrated = integrated + frameCount * 0;
  $: displayRange = range + frameCount * 0;
  $: displayTruePeak = truePeak + frameCount * 0;

  // Subscribe to audio state
  audioEngine.state.subscribe((state) => {
    isCapturing = state.isCapturing;
  });

  // Update LUFS data using requestAnimationFrame for Svelte 5 reactivity
  function updateLUFSData() {
    const data = get(audioEngine.loudness);
    momentary = data.momentary;
    shortTerm = data.shortTerm;
    integrated = data.integrated;
    range = data.range;
    truePeak = data.truePeak;
    frameCount++;  // Trigger reactive update
    lufsAnimationId = requestAnimationFrame(updateLUFSData);
  }

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
  }

  // Keyboard shortcuts
  function handleKeydown(e: KeyboardEvent) {
    // Ignore if typing in input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }

    switch (e.key.toLowerCase()) {
      case 'escape':
        sidebarOpen = false;
        break;
      case 'm':
        toggleSidebar();
        break;
      case 'f':
        window.electronAPI?.window.toggleFullscreen();
        break;
      case ' ':
        e.preventDefault();
        if (isCapturing) {
          audioEngine.stop();
        } else {
          audioEngine.start();
        }
        break;
      case 'd':
        moduleVisibility.toggle('debug');
        break;
      case 't':
        // Tap tempo
        audioEngine.tapTempo();
        break;
      case 'b':
        // Reset beat detector
        audioEngine.resetBeat();
        break;
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    // Start LUFS update loop
    lufsAnimationId = requestAnimationFrame(updateLUFSData);
    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  });

  onDestroy(() => {
    if (lufsAnimationId !== null) {
      cancelAnimationFrame(lufsAnimationId);
    }
  });
</script>

<div class="app-shell">
  <Header on:menuClick={toggleSidebar} />

  <div class="main-content">
    <Sidebar open={sidebarOpen} on:close={() => (sidebarOpen = false)} />

    <div class="visualization-area">
      <div class="top-row">
        {#if $moduleVisibility.spectrum}
          <div class="spectrum-container">
            <SpectrumPanel />
          </div>
        {/if}
        {#if $moduleVisibility.bassDetail}
          <div class="bass-container">
            <BassDetailPanel />
          </div>
        {/if}
        {#if $moduleVisibility.debug}
          <div class="debug-container">
            <DebugPanel />
          </div>
        {/if}
      </div>

      <div class="meters-container">
        {#if $moduleVisibility.vuMeters}
          <MeterPanel />
        {/if}
        {#if $moduleVisibility.lufsMetering}
          <LUFSMeterPanel
            momentary={displayMomentary}
            shortTerm={displayShortTerm}
            integrated={displayIntegrated}
            range={displayRange}
            truePeak={displayTruePeak}
          />
        {/if}
        {#if $moduleVisibility.bpmTempo}
          <BPMPanel />
        {/if}
        {#if $moduleVisibility.voiceDetection}
          <VoicePanel />
        {/if}
        {#if $moduleVisibility.spotify}
          <SpotifyPanel />
        {/if}
      </div>

      {#if $moduleVisibility.stereoCorrelation || $moduleVisibility.goniometer || $moduleVisibility.oscilloscope}
        <div class="stereo-analysis-container">
          {#if $moduleVisibility.stereoCorrelation}
            <StereoCorrelationPanel />
          {/if}
          {#if $moduleVisibility.goniometer}
            <GoniometerPanel />
          {/if}
          {#if $moduleVisibility.oscilloscope}
            <OscilloscopePanel />
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: var(--bg-primary);
  }

  .main-content {
    flex: 1;
    display: flex;
    overflow: hidden;
    position: relative;
  }

  .visualization-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: var(--panel-padding);
    gap: var(--panel-padding);
    overflow: hidden;
  }

  .top-row {
    flex: 1;
    display: flex;
    gap: var(--panel-padding);
    min-height: 300px;
  }

  .spectrum-container {
    flex: 2;
    min-width: 400px;
    background: var(--bg-panel);
    border-radius: var(--border-radius);
    border: 1px solid var(--border-color);
    overflow: hidden;
  }

  .bass-container {
    flex: 1;
    min-width: 280px;
    max-width: 400px;
  }

  .debug-container {
    width: 220px;
    min-width: 200px;
    max-width: 250px;
    overflow: hidden;
  }

  .meters-container {
    height: 140px;
    display: flex;
    gap: var(--panel-padding);
  }

  .stereo-analysis-container {
    display: flex;
    gap: var(--panel-padding);
    align-items: stretch;
  }

  @media (max-width: 1400px) {
    .top-row {
      flex-direction: column;
    }

    .spectrum-container {
      flex: 2;
      min-height: 250px;
    }

    .bass-container {
      flex: 1;
      min-height: 150px;
      max-width: none;
    }
  }

  @media (max-width: 1000px) {
    .meters-container {
      flex-direction: column;
      height: auto;
    }
  }
</style>
