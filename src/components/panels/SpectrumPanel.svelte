<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { audioEngine } from '../../core/AudioEngine';
  import type { FFTMode } from '../../core/AudioEngine';
  import { SpectrumRenderer } from '../../rendering/renderers/SpectrumRenderer';
  import ScaleOverlay from './ScaleOverlay.svelte';

  let canvas: HTMLCanvasElement;
  let peakCanvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  let renderer: SpectrumRenderer | null = null;
  let peakCtx: CanvasRenderingContext2D | null = null;
  let animationId: number | null = null;
  let spectrumStandard = new Float32Array(512);
  let spectrumMultiRes = new Float32Array(512);
  let fftMode: FFTMode = 'standard';
  let containerWidth = 0;
  let containerHeight = 0;

  // Frequency cursor state
  let cursorX = 0;
  let cursorY = 0;
  let cursorVisible = false;
  let cursorFreq = 0;
  let cursorDb = -100;

  // Subscribe to both spectrum sources
  const unsubStandard = audioEngine.spectrum.subscribe((data) => {
    spectrumStandard = data;
  });

  const unsubMultiRes = audioEngine.spectrumMultiRes.subscribe((data) => {
    spectrumMultiRes = data;
  });

  // Subscribe to state for FFT mode
  const unsubState = audioEngine.state.subscribe((state) => {
    fftMode = state.fftMode;
  });

  // Get current spectrum based on mode
  $: currentSpectrum = fftMode === 'standard' ? spectrumStandard : spectrumMultiRes;

  // Toggle FFT mode
  function toggleMode() {
    audioEngine.toggleFFTMode();
  }

  // Frequency cursor handlers
  function handleMouseMove(event: MouseEvent) {
    const rect = container.getBoundingClientRect();
    cursorX = event.clientX - rect.left;
    cursorY = event.clientY - rect.top;
    cursorVisible = true;

    // Calculate frequency and dB at cursor position
    const graphLeft = MARGIN_LEFT;
    const graphRight = containerWidth - MARGIN_RIGHT;
    const graphTop = MARGIN_TOP;
    const graphBottom = containerHeight - MARGIN_BOTTOM;
    const graphWidth = graphRight - graphLeft;
    const graphHeight = graphBottom - graphTop;

    // Check if cursor is within graph area
    if (cursorX >= graphLeft && cursorX <= graphRight &&
        cursorY >= graphTop && cursorY <= graphBottom) {

      // Calculate normalized position (0-1) in graph area
      const normalizedX = (cursorX - graphLeft) / graphWidth;

      // Logarithmic frequency mapping (20Hz - 20kHz)
      const minFreq = 20;
      const maxFreq = 20000;
      const logMin = Math.log10(minFreq);
      const logMax = Math.log10(maxFreq);
      const logFreq = logMin + normalizedX * (logMax - logMin);
      cursorFreq = Math.pow(10, logFreq);

      // Get the closest bar index
      const barIndex = Math.floor(normalizedX * currentSpectrum.length);
      const clampedIndex = Math.max(0, Math.min(currentSpectrum.length - 1, barIndex));

      // Get the amplitude value (0-1 linear) and convert to dB
      const amplitude = currentSpectrum[clampedIndex] || 0;
      // Map the normalized amplitude to dB (-60 to 0)
      cursorDb = amplitude > 0.001 ? -60 + amplitude * 60 : -100;
    }
  }

  function handleMouseLeave() {
    cursorVisible = false;
  }

  // Format frequency for display
  function formatFreq(freq: number): string {
    if (freq >= 1000) {
      return (freq / 1000).toFixed(freq >= 10000 ? 1 : 2) + ' kHz';
    }
    return freq.toFixed(0) + ' Hz';
  }

  // Margin configuration (must match ScaleOverlay and SpectrumRenderer)
  const MARGIN_LEFT = 45;
  const MARGIN_RIGHT = 15;
  const MARGIN_TOP = 20;
  const MARGIN_BOTTOM = 30;

  // Draw peak hold indicators on 2D overlay (mirrored for stereo display)
  function drawPeakHold() {
    if (!peakCtx) return;

    // Get peak holds from appropriate analyzer
    const analyzer = fftMode === 'standard'
      ? audioEngine.getSpectrumAnalyzer()
      : audioEngine.getMultiResAnalyzer();
    const peakHold = analyzer.getPeakHolds();
    const barCount = peakHold.length;
    const width = peakCanvas.width;
    const height = peakCanvas.height;

    // Clear overlay
    peakCtx.clearRect(0, 0, width, height);

    if (barCount === 0) return;

    // Account for DPR in margin calculations
    const dpr = window.devicePixelRatio || 1;
    const marginLeft = MARGIN_LEFT * dpr;
    const marginRight = MARGIN_RIGHT * dpr;
    const marginTop = MARGIN_TOP * dpr;
    const marginBottom = MARGIN_BOTTOM * dpr;

    // Graph area respecting all margins
    const graphWidth = width - marginLeft - marginRight;
    const graphHeight = height - marginTop - marginBottom;

    // Match WebGL renderer settings for mirrored display
    const halfHeight = graphHeight / 2;
    const centerY = marginTop + halfHeight;  // Center line of graph
    const barWidth = graphWidth / barCount;

    // Draw peak indicators as small horizontal lines
    peakCtx.fillStyle = 'rgba(255, 255, 255, 0.95)';

    for (let i = 0; i < barCount; i++) {
      const peakValue = peakHold[i];

      if (peakValue > 0.02) {
        const x = marginLeft + i * barWidth;

        // Top half: peak indicator grows upward from center
        const yTop = centerY - peakValue * halfHeight;
        peakCtx.fillRect(x, yTop - 2, barWidth * 0.98, 2);

        // Bottom half: peak indicator grows downward from center (mirrored)
        const yBottom = centerY + peakValue * halfHeight;
        peakCtx.fillRect(x, yBottom, barWidth * 0.98, 2);
      }
    }
  }

  onMount(() => {
    // Initialize WebGL2 renderer
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      powerPreference: 'high-performance',
    });

    if (!gl) {
      console.error('WebGL2 not supported');
      return;
    }

    // Initialize 2D context for peak hold overlay
    peakCtx = peakCanvas.getContext('2d');

    renderer = new SpectrumRenderer(gl, canvas.width, canvas.height);

    // Handle resize
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        containerWidth = width;
        containerHeight = height;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        peakCanvas.width = width * dpr;
        peakCanvas.height = height * dpr;
        renderer?.resize(canvas.width, canvas.height);
      }
    });

    resizeObserver.observe(container);

    // Start render loop
    function render() {
      renderer?.render(currentSpectrum);
      drawPeakHold();
      animationId = requestAnimationFrame(render);
    }
    render();

    return () => {
      resizeObserver.disconnect();
    };
  });

  onDestroy(() => {
    unsubStandard();
    unsubMultiRes();
    unsubState();
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
    }
    renderer?.destroy();
  });
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
  class="spectrum-panel"
  bind:this={container}
  on:mousemove={handleMouseMove}
  on:mouseleave={handleMouseLeave}
>
  <canvas class="webgl-canvas" bind:this={canvas}></canvas>
  <canvas class="peak-canvas" bind:this={peakCanvas}></canvas>
  <ScaleOverlay width={containerWidth} height={containerHeight} {fftMode} />

  <!-- Frequency Cursor -->
  {#if cursorVisible && cursorFreq > 0}
    <div class="cursor-line" style="left: {cursorX}px;"></div>
    <div
      class="cursor-tooltip"
      style="left: {cursorX}px; top: {cursorY}px;"
      class:flip-left={cursorX > containerWidth - 120}
    >
      <span class="cursor-freq">{formatFreq(cursorFreq)}</span>
      <span class="cursor-db">{cursorDb > -99 ? cursorDb.toFixed(1) : '---'} dB</span>
    </div>
  {/if}

  <!-- FFT Mode Toggle Button -->
  <button
    class="fft-toggle"
    on:click={toggleMode}
    title="Toggle between Standard FFT (4096) and Multi-Resolution FFT"
    aria-label="Toggle FFT mode"
  >
    <span class="toggle-label">{fftMode === 'standard' ? 'STD' : 'MR'}</span>
    <span class="toggle-indicator" class:multi-res={fftMode === 'multiResolution'}></span>
  </button>
</div>

<style>
  .spectrum-panel {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
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

  .peak-canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .fft-toggle {
    position: absolute;
    top: 2px;
    right: 60px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    background: rgba(30, 35, 50, 0.9);
    border: 1px solid rgba(74, 158, 255, 0.3);
    border-radius: 4px;
    color: #a0a0a0;
    font-size: 10px;
    font-family: monospace;
    cursor: pointer;
    z-index: 20;
    transition: all 0.15s ease;
  }

  .fft-toggle:hover {
    background: rgba(40, 50, 70, 0.95);
    border-color: rgba(74, 158, 255, 0.6);
    color: #ffffff;
  }

  .toggle-label {
    font-weight: 600;
    letter-spacing: 0.05em;
  }

  .toggle-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #4a9eff;
    transition: background 0.15s ease;
  }

  .toggle-indicator.multi-res {
    background: #22c55e;
  }

  /* Frequency Cursor */
  .cursor-line {
    position: absolute;
    top: 20px;
    bottom: 30px;
    width: 1px;
    background: rgba(255, 255, 255, 0.4);
    pointer-events: none;
    z-index: 15;
  }

  .cursor-tooltip {
    position: absolute;
    transform: translate(8px, -50%);
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 8px;
    background: rgba(20, 25, 35, 0.95);
    border: 1px solid rgba(74, 158, 255, 0.5);
    border-radius: 4px;
    pointer-events: none;
    z-index: 25;
    white-space: nowrap;
  }

  .cursor-tooltip.flip-left {
    transform: translate(-100%, -50%) translateX(-8px);
  }

  .cursor-freq {
    font-size: 11px;
    font-family: monospace;
    font-weight: 600;
    color: var(--accent-color);
  }

  .cursor-db {
    font-size: 10px;
    font-family: monospace;
    color: var(--text-secondary);
  }
</style>
