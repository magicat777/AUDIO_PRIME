<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import Header from './Header.svelte';
  import Sidebar from './Sidebar.svelte';
  import GridLayout from './GridLayout.svelte';
  import DraggablePanel from './DraggablePanel.svelte';
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
  import { gridLayout } from '../../stores/gridLayout';

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

    <GridLayout>
      <!-- Spectrum Analyzer -->
      {#if $moduleVisibility.spectrum}
        <DraggablePanel panelId="spectrum" title="Spectrum">
          <SpectrumPanel />
        </DraggablePanel>
      {/if}

      <!-- Bass Detail -->
      {#if $moduleVisibility.bassDetail}
        <DraggablePanel panelId="bassDetail" title="Bass Detail">
          <BassDetailPanel />
        </DraggablePanel>
      {/if}

      <!-- Debug Panel -->
      {#if $moduleVisibility.debug}
        <DraggablePanel panelId="debug" title="Debug">
          <DebugPanel />
        </DraggablePanel>
      {/if}

      <!-- VU Meters -->
      {#if $moduleVisibility.vuMeters}
        <DraggablePanel panelId="vuMeters" title="VU Meters">
          <MeterPanel />
        </DraggablePanel>
      {/if}

      <!-- LUFS Metering -->
      {#if $moduleVisibility.lufsMetering}
        <DraggablePanel panelId="lufsMetering" title="LUFS">
          <LUFSMeterPanel
            momentary={displayMomentary}
            shortTerm={displayShortTerm}
            integrated={displayIntegrated}
            range={displayRange}
            truePeak={displayTruePeak}
          />
        </DraggablePanel>
      {/if}

      <!-- BPM/Tempo -->
      {#if $moduleVisibility.bpmTempo}
        <DraggablePanel panelId="bpmTempo" title="BPM/Tempo">
          <BPMPanel />
        </DraggablePanel>
      {/if}

      <!-- Voice Detection -->
      {#if $moduleVisibility.voiceDetection}
        <DraggablePanel panelId="voiceDetection" title="Voice">
          <VoicePanel />
        </DraggablePanel>
      {/if}

      <!-- Spotify -->
      {#if $moduleVisibility.spotify}
        <DraggablePanel panelId="spotify" title="Spotify">
          <SpotifyPanel />
        </DraggablePanel>
      {/if}

      <!-- Stereo Correlation -->
      {#if $moduleVisibility.stereoCorrelation}
        <DraggablePanel panelId="stereoCorrelation" title="Stereo">
          <StereoCorrelationPanel />
        </DraggablePanel>
      {/if}

      <!-- Goniometer -->
      {#if $moduleVisibility.goniometer}
        <DraggablePanel panelId="goniometer" title="Goniometer">
          <GoniometerPanel />
        </DraggablePanel>
      {/if}

      <!-- Oscilloscope -->
      {#if $moduleVisibility.oscilloscope}
        <DraggablePanel panelId="oscilloscope" title="Oscilloscope">
          <OscilloscopePanel />
        </DraggablePanel>
      {/if}
    </GridLayout>
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
</style>
