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
  import FrequencyBandsPanel from '../meters/FrequencyBandsPanel.svelte';
  import DebugPanel from '../panels/DebugPanel.svelte';
  import SpotifyPanel from '../spotify/SpotifyPanel.svelte';
  import Visualization3DPanel from '../panels/Visualization3DPanel.svelte';
  import { audioEngine } from '../../core/AudioEngine';
  import { moduleVisibility } from '../../stores/moduleVisibility';
  import { gridLayout } from '../../stores/gridLayout';
  import { renderCoordinator } from '../../core/RenderCoordinator';

  const RENDER_ID = 'app-shell-lufs';

  let sidebarOpen = false;
  let isCapturing = false;
  let isFullscreen = false;
  let fullscreenCleanup: (() => void) | null = null;

  // Track previous visibility state to detect newly enabled panels
  let prevVisibility: Record<string, boolean> = {};

  // Watch for visibility changes and bring newly enabled panels to front
  $: {
    const currentVisibility = $moduleVisibility;
    for (const [key, isVisible] of Object.entries(currentVisibility)) {
      if (isVisible && !prevVisibility[key]) {
        // Panel was just enabled, bring it to front
        gridLayout.bringToFront(key);
      }
    }
    prevVisibility = { ...currentVisibility };
  }

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

  // Update LUFS data using RenderCoordinator for Svelte 5 reactivity
  function updateLUFSData() {
    const data = get(audioEngine.loudness);
    momentary = data.momentary;
    shortTerm = data.shortTerm;
    integrated = data.integrated;
    range = data.range;
    truePeak = data.truePeak;
    frameCount++;  // Trigger reactive update
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

    const key = e.key.toLowerCase();

    // === Controls ===
    if (key === 'escape') {
      // ESC: Exit fullscreen if in fullscreen, otherwise close sidebar
      if (isFullscreen) {
        window.electronAPI?.window.toggleFullscreen();
      } else {
        sidebarOpen = false;
      }
      return;
    }

    if (key === ' ') {
      // Space: Start/Stop capture
      e.preventDefault();
      if (isCapturing) {
        audioEngine.stop();
      } else {
        audioEngine.start();
      }
      return;
    }

    if (key === 'q' && !e.altKey && !e.shiftKey && !e.ctrlKey) {
      // Q: Quit application
      window.electronAPI?.window.quit();
      return;
    }

    // === Layout Controls (Alt + key) ===
    if (e.altKey && !e.shiftKey && !e.ctrlKey) {
      switch (key) {
        case 'l':
          // Alt+L: Lock/Unlock all panels
          e.preventDefault();
          gridLayout.lockAll();
          return;
        case 't':
          // Alt+T: Toggle grid
          e.preventDefault();
          gridLayout.toggleGrid();
          return;
        case 's':
          // Alt+S: Toggle snap
          e.preventDefault();
          gridLayout.toggleSnap();
          return;
        case 'a':
          // Alt+A: Auto-arrange
          e.preventDefault();
          triggerAutoArrange();
          return;
        case 'r':
          // Alt+R: Reset layout
          e.preventDefault();
          gridLayout.reset();
          return;
      }
    }

    // === 3D Panels (Shift + key, no Alt/Ctrl) ===
    if (e.shiftKey && !e.altKey && !e.ctrlKey) {
      switch (key) {
        case 'b':
          // Shift+B: 3D Bars/Cylinder
          e.preventDefault();
          moduleVisibility.toggle('cylindricalBars');
          return;
        case 'w':
          // Shift+W: 3D Waterfall
          e.preventDefault();
          moduleVisibility.toggle('waterfall3d');
          return;
        case 'f':
          // Shift+F: Frequency Sphere
          e.preventDefault();
          moduleVisibility.toggle('frequencySphere');
          return;
        case 's':
          // Shift+S: 3D Stereo Space
          e.preventDefault();
          moduleVisibility.toggle('stereoSpace3d');
          return;
        case 't':
          // Shift+T: Tunnel Effect
          e.preventDefault();
          moduleVisibility.toggle('tunnel');
          return;
        case 'l':
          // Shift+L: Terrain Landscape
          e.preventDefault();
          moduleVisibility.toggle('terrain');
          return;
      }
    }

    // === Spotify (Alt+Shift+S) ===
    if (e.altKey && e.shiftKey && key === 's') {
      e.preventDefault();
      moduleVisibility.toggle('spotify');
      return;
    }

    // === 2D Panels and Controls (single key, no modifiers) ===
    if (!e.altKey && !e.shiftKey && !e.ctrlKey) {
      switch (key) {
        // Controls
        case 'm':
          // M: Toggle menu/sidebar
          toggleSidebar();
          return;
        case 'f':
          // F: Toggle fullscreen
          window.electronAPI?.window.toggleFullscreen();
          return;
        // 2D Panels
        case 's':
          // S: Spectrum
          moduleVisibility.toggle('spectrum');
          return;
        case 'u':
          // U: VU Meters (using U to avoid conflict with M for Menu)
          moduleVisibility.toggle('vuMeters');
          return;
        case 'b':
          // B: Bass Detail
          moduleVisibility.toggle('bassDetail');
          return;
        case 'w':
          // W: Waterfall (within bass detail)
          moduleVisibility.toggle('waterfall');
          return;
        case 'l':
          // L: LUFS
          moduleVisibility.toggle('lufsMetering');
          return;
        case 't':
          // T: Tempo/BPM
          moduleVisibility.toggle('bpmTempo');
          return;
        case 'v':
          // V: Voice Detection
          moduleVisibility.toggle('voiceDetection');
          return;
        case 'c':
          // C: Stereo Correlation
          moduleVisibility.toggle('stereoCorrelation');
          return;
        case 'g':
          // G: Goniometer
          moduleVisibility.toggle('goniometer');
          return;
        case 'o':
          // O: Oscilloscope
          moduleVisibility.toggle('oscilloscope');
          return;
        case 'n':
          // N: Frequency Bands (using N to avoid conflict with F for Fullscreen)
          moduleVisibility.toggle('frequencyBands');
          return;
        case 'd':
          // D: Debug
          moduleVisibility.toggle('debug');
          return;
      }
    }
  }

  // Helper to trigger auto-arrange
  function triggerAutoArrange() {
    const visiblePanelIds = Object.entries($moduleVisibility)
      .filter(([key, visible]) => visible && key !== 'waterfall')
      .map(([key]) => key)
      .filter(Boolean);
    gridLayout.autoArrange(visiblePanelIds);
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    // Register LUFS update with centralized render coordinator
    renderCoordinator.register(RENDER_ID, updateLUFSData, 'low');

    // Listen for fullscreen changes to auto-arrange panels
    fullscreenCleanup = window.electronAPI?.window.onFullscreenChange((newFullscreen: boolean) => {
      isFullscreen = newFullscreen;
      if (newFullscreen) {
        // Wait for container to resize before auto-arranging
        // Use multiple frames to ensure layout is complete
        let attempts = 0;
        const maxAttempts = 10;
        const waitForResize = () => {
          attempts++;
          if (attempts >= maxAttempts) {
            triggerAutoArrange();
          } else {
            requestAnimationFrame(waitForResize);
          }
        };
        // Start after a short delay to let the fullscreen transition begin
        setTimeout(() => {
          requestAnimationFrame(waitForResize);
        }, 50);
      }
    }) ?? null;

    return () => {
      window.removeEventListener('keydown', handleKeydown);
      if (fullscreenCleanup) {
        fullscreenCleanup();
      }
    };
  });

  onDestroy(() => {
    renderCoordinator.unregister(RENDER_ID);
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

      <!-- Frequency Bands -->
      {#if $moduleVisibility.frequencyBands}
        <DraggablePanel panelId="frequencyBands" title="Frequency Bands">
          <FrequencyBandsPanel />
        </DraggablePanel>
      {/if}

      <!-- 3D Visualizations -->
      {#if $moduleVisibility.cylindricalBars}
        <DraggablePanel panelId="cylindricalBars" title="3D Bars">
          <Visualization3DPanel
            visualizationType="cylindricalBars"
            visibilityKey="cylindricalBars"
            priority="normal"
          />
        </DraggablePanel>
      {/if}

      {#if $moduleVisibility.waterfall3d}
        <DraggablePanel panelId="waterfall3d" title="3D Waterfall">
          <Visualization3DPanel
            visualizationType="waterfall3d"
            visibilityKey="waterfall3d"
            priority="normal"
          />
        </DraggablePanel>
      {/if}

      {#if $moduleVisibility.frequencySphere}
        <DraggablePanel panelId="frequencySphere" title="Freq Sphere">
          <Visualization3DPanel
            visualizationType="sphere"
            visibilityKey="frequencySphere"
            priority="normal"
          />
        </DraggablePanel>
      {/if}

      {#if $moduleVisibility.stereoSpace3d}
        <DraggablePanel panelId="stereoSpace3d" title="3D Stereo">
          <Visualization3DPanel
            visualizationType="stereoSpace"
            visibilityKey="stereoSpace3d"
            priority="normal"
          />
        </DraggablePanel>
      {/if}

      {#if $moduleVisibility.tunnel}
        <DraggablePanel panelId="tunnel" title="Tunnel">
          <Visualization3DPanel
            visualizationType="tunnel"
            visibilityKey="tunnel"
            priority="normal"
          />
        </DraggablePanel>
      {/if}

      {#if $moduleVisibility.terrain}
        <DraggablePanel panelId="terrain" title="Terrain">
          <Visualization3DPanel
            visualizationType="terrain"
            visibilityKey="terrain"
            priority="normal"
          />
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
