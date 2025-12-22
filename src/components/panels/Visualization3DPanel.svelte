<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { audioEngine } from '../../core/AudioEngine';
  import { renderCoordinator } from '../../core/RenderCoordinator';
  import { moduleVisibility } from '../../stores/moduleVisibility';
  import type { Base3DRenderer, Renderer3DConfig } from '../../rendering/renderers/Base3DRenderer';

  // Extended renderer interface for optional methods on specific renderers
  interface ExtendedRenderer extends Base3DRenderer {
    setSmoothMode?(enabled: boolean): void;
    setShowRings?(enabled: boolean): void;
    setShowRadials?(enabled: boolean): void;
    setShowFloor?(enabled: boolean): void;
    cycleRenderMode?(): 'lines' | 'filled' | 'filled+lines';
    render(spectrum: Float32Array, deltaTime: number, stereoSamples?: Float32Array): void;
  }

  // Props
  export let visualizationType: 'cylindricalBars' | 'waterfall3d' | 'sphere' | 'stereoSpace' | 'tunnel' | 'terrain';
  export let visibilityKey: string;  // Key in moduleVisibility store
  export let config: Partial<Renderer3DConfig> = {};
  export let priority: 'high' | 'normal' | 'low' = 'normal';

  const RENDER_ID = `3d-panel-${visualizationType}`;

  let canvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  let renderer: ExtendedRenderer | null = null;
  let gl: WebGL2RenderingContext | null = null;
  let spectrum = new Float32Array(512);
  let stereoSamples = new Float32Array(2048);
  let lastFrameTime = 0;

  // Subscribe to spectrum data
  const unsubSpectrum = audioEngine.spectrum.subscribe((data) => {
    spectrum = data;
  });

  // Subscribe to stereo samples (only for stereo space visualization)
  let unsubStereo: (() => void) | null = null;
  if (visualizationType === 'stereoSpace') {
    unsubStereo = audioEngine.stereoSamples.subscribe((data) => {
      stereoSamples = data;
    });
  }

  // Subscribe to beat info for reactive effects
  let beatPhase = 0;
  let beatStrength = 0;
  const unsubBeat = audioEngine.beatInfo.subscribe((info) => {
    beatPhase = info.beatPhase;
    beatStrength = info.beatStrength;
  });

  // Sync visibility with RenderCoordinator
  $: {
    const visibility = $moduleVisibility as Record<string, boolean>;
    renderCoordinator.setVisibility(RENDER_ID, visibility[visibilityKey] ?? false);
  }

  // Track if renderer is available (currently all renderers are implemented)
  const rendererNotImplemented = false;

  // Smooth mode toggle (for cylindrical bars)
  let smoothMode = false;

  function toggleSmoothMode() {
    smoothMode = !smoothMode;
    renderer?.setSmoothMode?.(smoothMode);
  }

  // Grid toggles (for cylindrical bars)
  let showRings = false;
  let showRadials = false;
  let showFloor = false;

  function toggleRings() {
    showRings = !showRings;
    renderer?.setShowRings?.(showRings);
  }

  function toggleRadials() {
    showRadials = !showRadials;
    renderer?.setShowRadials?.(showRadials);
  }

  function toggleFloor() {
    showFloor = !showFloor;
    renderer?.setShowFloor?.(showFloor);
  }

  // Render mode for tunnel (cycles: lines → filled → filled+lines)
  let tunnelRenderMode: 'lines' | 'filled' | 'filled+lines' = 'lines';

  // Reactive label for tunnel mode
  $: tunnelModeLabel = tunnelRenderMode === 'lines' ? 'Lines'
    : tunnelRenderMode === 'filled' ? 'Filled'
    : 'Both';

  function cycleTunnelMode() {
    const newMode = renderer?.cycleRenderMode?.();
    if (newMode) {
      tunnelRenderMode = newMode;
    }
  }

  // Dynamically import and create the appropriate renderer
  async function createRenderer(): Promise<ExtendedRenderer | null> {
    if (!gl) return null;

    try {
      switch (visualizationType) {
        case 'cylindricalBars': {
          const { CylindricalBarsRenderer } = await import('../../rendering/renderers/CylindricalBarsRenderer');
          return new CylindricalBarsRenderer(gl, canvas.width, canvas.height, config);
        }
        case 'waterfall3d': {
          const { Waterfall3DRenderer } = await import('../../rendering/renderers/Waterfall3DRenderer');
          return new Waterfall3DRenderer(gl, canvas.width, canvas.height, config);
        }
        case 'sphere': {
          const { FrequencySphereRenderer } = await import('../../rendering/renderers/FrequencySphereRenderer');
          return new FrequencySphereRenderer(gl, canvas.width, canvas.height, config);
        }
        case 'stereoSpace': {
          const { StereoSpace3DRenderer } = await import('../../rendering/renderers/StereoSpace3DRenderer');
          return new StereoSpace3DRenderer(gl, canvas.width, canvas.height, config);
        }
        case 'tunnel': {
          const { TunnelRenderer } = await import('../../rendering/renderers/TunnelRenderer');
          return new TunnelRenderer(gl, canvas.width, canvas.height, config);
        }
        case 'terrain': {
          const { TerrainRenderer } = await import('../../rendering/renderers/TerrainRenderer');
          return new TerrainRenderer(gl, canvas.width, canvas.height, config);
        }
        default:
          console.error(`Unknown visualization type: ${visualizationType}`);
          return null;
      }
    } catch (error) {
      console.error(`Failed to load renderer for ${visualizationType}:`, error);
      return null;
    }
  }

  // Render callback for RenderCoordinator
  function renderFrame(timestamp: number) {
    if (!renderer) return;

    const deltaTime = lastFrameTime > 0 ? timestamp - lastFrameTime : 16.67;
    lastFrameTime = timestamp;

    // Update beat info for reactive effects
    renderer.setBeatInfo(beatPhase, beatStrength);

    // Render the visualization (pass stereo samples for stereoSpace)
    if (visualizationType === 'stereoSpace') {
      const currentStereoSamples = get(audioEngine.stereoSamples);
      renderer.render(spectrum, deltaTime, currentStereoSamples);
    } else {
      renderer.render(spectrum, deltaTime);
    }
  }

  // Store observer reference for cleanup
  let resizeObserver: ResizeObserver | null = null;

  onMount(async () => {
    // Initialize WebGL2 context with depth buffer
    gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,  // Enable antialiasing for 3D
      depth: true,       // Enable depth buffer
      powerPreference: 'high-performance',
    });

    if (!gl) {
      console.error('WebGL2 not supported');
      return;
    }

    // Create the appropriate renderer
    renderer = await createRenderer();

    if (!renderer) {
      console.error(`Failed to create renderer for ${visualizationType}`);
      return;
    }

    // Handle resize
    resizeObserver = new ResizeObserver((entries) => {
      // Guard against callback firing after canvas is destroyed
      if (!canvas) return;

      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        renderer?.resize(canvas.width, canvas.height);
      }
    });

    resizeObserver.observe(container);

    // Register with centralized render coordinator
    renderCoordinator.register(RENDER_ID, renderFrame, priority);
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    unsubSpectrum();
    unsubStereo?.();
    unsubBeat();
    renderCoordinator.unregister(RENDER_ID);
    renderer?.destroy();
  });

  // Expose config update for external control
  export function updateConfig(newConfig: Partial<Renderer3DConfig>) {
    renderer?.setConfig(newConfig);
  }

  // Expose camera angle control
  export function setCameraAngle(angle: number) {
    renderer?.setCameraAngle(angle);
  }

  export function getCameraAngle(): number {
    return renderer?.getCameraAngle() ?? 0;
  }
</script>

<div class="visualization-3d-panel" bind:this={container}>
  <canvas class="webgl-canvas" bind:this={canvas}></canvas>

  <!-- Show message for unimplemented renderers -->
  {#if rendererNotImplemented}
    <div class="not-implemented">
      <span class="coming-soon">Coming Soon</span>
      <span class="viz-name">{visualizationType}</span>
    </div>
  {/if}


  <!-- Visualization-specific controls -->
  {#if visualizationType === 'cylindricalBars' && !rendererNotImplemented}
    <div class="controls-overlay">
      <button
        class="control-btn"
        class:active={smoothMode}
        on:click={toggleSmoothMode}
        title="Toggle smooth/discrete bars"
      >
        {smoothMode ? 'Smooth' : 'Discrete'}
      </button>
      <button
        class="control-btn"
        class:active={showRings}
        on:click={toggleRings}
        title="Toggle magnitude rings"
      >
        Rings
      </button>
      <button
        class="control-btn"
        class:active={showRadials}
        on:click={toggleRadials}
        title="Toggle frequency radials"
      >
        Radials
      </button>
      <button
        class="control-btn"
        class:active={showFloor}
        on:click={toggleFloor}
        title="Toggle floor grid"
      >
        Floor
      </button>
    </div>
  {/if}

  {#if visualizationType === 'tunnel' && !rendererNotImplemented}
    <div class="controls-overlay">
      <button
        class="control-btn"
        class:active={tunnelRenderMode !== 'lines'}
        on:click={cycleTunnelMode}
        title="Cycle render mode: Lines → Filled → Both"
      >
        {tunnelModeLabel}
      </button>
    </div>
  {/if}

  <!-- Optional controls overlay slot -->
  <slot name="controls"></slot>
</div>

<style>
  .visualization-3d-panel {
    width: 100%;
    height: 100%;
    display: flex;
    position: relative;
    overflow: hidden;
  }

  .webgl-canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: var(--bg-primary);
  }

  .not-implemented {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    color: var(--text-muted);
  }

  .coming-soon {
    font-size: 1.2rem;
    font-weight: 500;
    color: var(--accent-color);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .viz-name {
    font-size: 0.9rem;
    opacity: 0.7;
  }

  .controls-overlay {
    position: absolute;
    bottom: 8px;
    right: 8px;
    display: flex;
    gap: 4px;
  }

  .control-btn {
    padding: 4px 10px;
    font-size: 0.75rem;
    font-weight: 500;
    background: rgba(30, 30, 35, 0.85);
    border: 1px solid var(--border-color, #333);
    border-radius: 4px;
    color: var(--text-secondary, #999);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .control-btn:hover {
    background: rgba(50, 50, 55, 0.9);
    color: var(--text-primary, #fff);
  }

  .control-btn.active {
    background: var(--accent-color, #00d4aa);
    color: var(--bg-primary, #0a0a0f);
    border-color: var(--accent-color, #00d4aa);
  }

</style>
