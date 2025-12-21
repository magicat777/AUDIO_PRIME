<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { audioEngine } from '../../core/AudioEngine';
  import { moduleVisibility } from '../../stores/moduleVisibility';

  let canvas: HTMLCanvasElement;
  let waterfallCanvas: HTMLCanvasElement;
  let bassGraphContainer: HTMLDivElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let waterfallCtx: CanvasRenderingContext2D | null = null;
  let animationId: number | null = null;
  let spectrum = new Float32Array(512);

  // Display mode: 'curve' for continuous line, 'bars' for discrete bars
  type DisplayMode = 'curve' | 'bars';
  let displayMode: DisplayMode = 'curve';

  function toggleDisplayMode() {
    displayMode = displayMode === 'curve' ? 'bars' : 'curve';
  }

  // Number of bars in BARS mode (1/3 octave-ish spacing for bass)
  const BAR_COUNT = 16;

  // Peak hold for BARS mode
  const peakHold = new Float32Array(BAR_COUNT);
  const peakDecayRate = 0.015; // How fast peaks decay (per frame)
  const peakHoldTime = 30; // Frames to hold peak before decay starts
  const peakHoldCounters = new Uint16Array(BAR_COUNT); // Hold counter for each bar

  // Bass frequency range for display
  const MIN_FREQ = 20;
  const MAX_FREQ = 200;

  // Frequency cursor state
  let cursorX = 0;
  let cursorY = 0;
  let cursorVisible = false;
  let cursorFreq = 0;
  let cursorDb = -100;
  let containerWidth = 0;
  let containerHeight = 0;

  // Frequency labels for bass region
  const FREQ_LABELS = [20, 30, 40, 50, 60, 80, 100, 120, 150, 200];

  // The spectrum data is now 512 bars mapped logarithmically from 20Hz-20kHz
  // Calculate which bars correspond to bass region (20-200Hz)
  const TOTAL_BARS = 512;
  const SPECTRUM_MIN_FREQ = 20;
  const SPECTRUM_MAX_FREQ = 20000;

  // Waterfall spectrogram settings
  const WATERFALL_HISTORY = 150; // Number of history lines to display

  // Fixed internal resolution for high-quality rendering (independent of display size)
  const WATERFALL_INTERNAL_WIDTH = 800;  // Internal pixel width for frequency resolution
  const WATERFALL_INTERNAL_HEIGHT = 300; // Internal pixel height for time resolution

  // Use fixed dimensions for consistent quality
  const waterfallWidth = WATERFALL_INTERNAL_WIDTH;
  const waterfallHeight = WATERFALL_INTERNAL_HEIGHT;
  let waterfallInitialized = false;
  let waterfallRowImageData: ImageData | null = null; // Reused for performance

  // Pre-computed color lookup table (256 entries, RGBA)
  const COLOR_LUT = new Uint8Array(256 * 4);
  (function buildColorLUT() {
    for (let i = 0; i < 256; i++) {
      const m = i / 255;
      let r = 0, g = 0, b = 0;

      if (m < 0.1) {
        // Very low: dark background
        const v = m * 10 * 30;
        r = v; g = v; b = v * 1.5;
      } else if (m < 0.3) {
        // Low: blue to cyan
        const t = (m - 0.1) / 0.2;
        r = 0; g = t * 200; b = 100 + t * 155;
      } else if (m < 0.5) {
        // Medium-low: cyan to green
        const t = (m - 0.3) / 0.2;
        r = 0; g = 200 + t * 55; b = 255 - t * 155;
      } else if (m < 0.7) {
        // Medium: green to yellow
        const t = (m - 0.5) / 0.2;
        r = t * 255; g = 255; b = 100 - t * 100;
      } else if (m < 0.9) {
        // High: yellow to red
        const t = (m - 0.7) / 0.2;
        r = 255; g = 255 - t * 200; b = 0;
      } else {
        // Very high: red to white
        const t = (m - 0.9) / 0.1;
        r = 255; g = 55 + t * 200; b = t * 200;
      }

      const idx = i * 4;
      COLOR_LUT[idx] = Math.floor(r);
      COLOR_LUT[idx + 1] = Math.floor(g);
      COLOR_LUT[idx + 2] = Math.floor(b);
      COLOR_LUT[idx + 3] = 255; // Alpha
    }
  })();

  // Find bar index for a given frequency (logarithmic mapping)
  function freqToBar(freq: number): number {
    const t = Math.log(freq / SPECTRUM_MIN_FREQ) / Math.log(SPECTRUM_MAX_FREQ / SPECTRUM_MIN_FREQ);
    return Math.floor(t * (TOTAL_BARS - 1));
  }

  const BASS_START_BAR = freqToBar(MIN_FREQ);  // ~0
  const BASS_END_BAR = freqToBar(MAX_FREQ);    // ~166 bars cover 20-200Hz
  const BASS_BAR_COUNT = BASS_END_BAR - BASS_START_BAR + 1;

  // PERFORMANCE: Cache gradient to avoid recreation every frame
  let cachedGradient: CanvasGradient | null = null;
  let cachedGradientHeight = 0;


  // Subscribe to spectrum data (now 0-1 normalized bar values)
  const unsubscribe = audioEngine.spectrum.subscribe((data) => {
    spectrum = data;
  });

  // Frequency cursor handlers
  const padding = { left: 45, right: 15, top: 20, bottom: 30 };

  function handleMouseMove(event: MouseEvent) {
    if (!bassGraphContainer) return;

    const rect = bassGraphContainer.getBoundingClientRect();
    cursorX = event.clientX - rect.left;
    cursorY = event.clientY - rect.top;
    containerWidth = rect.width;
    containerHeight = rect.height;
    cursorVisible = true;

    // Calculate frequency and dB at cursor position
    const graphWidth = containerWidth - padding.left - padding.right;
    const graphHeight = containerHeight - padding.top - padding.bottom;

    // Check if cursor is within graph area
    if (cursorX >= padding.left && cursorX <= containerWidth - padding.right &&
        cursorY >= padding.top && cursorY <= containerHeight - padding.bottom) {

      // Calculate normalized position (0-1) in graph area
      const normalizedX = (cursorX - padding.left) / graphWidth;

      // Logarithmic frequency mapping for bass (20Hz - 200Hz)
      const logMin = Math.log10(MIN_FREQ);
      const logMax = Math.log10(MAX_FREQ);
      const logFreq = logMin + normalizedX * (logMax - logMin);
      cursorFreq = Math.pow(10, logFreq);

      // Get the closest bar index in the bass range
      const bassBarIndex = Math.floor(normalizedX * BASS_BAR_COUNT);
      const barIndex = BASS_START_BAR + Math.max(0, Math.min(BASS_BAR_COUNT - 1, bassBarIndex));

      // Get the amplitude value (0-1 linear) and convert to dB
      const amplitude = spectrum[barIndex] || 0;
      cursorDb = amplitude > 0.001 ? -60 + amplitude * 60 : -100;
    } else {
      cursorFreq = 0;
    }
  }

  function handleMouseLeave() {
    cursorVisible = false;
  }

  // Format frequency for display
  function formatFreq(freq: number): string {
    return freq.toFixed(0) + ' Hz';
  }

  onMount(() => {
    ctx = canvas.getContext('2d', { alpha: false });
    waterfallCtx = waterfallCanvas.getContext('2d', { alpha: false });
    if (!ctx || !waterfallCtx) return;

    // Handle resize for main canvas
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx!.scale(dpr, dpr);
      }
    });

    // Initialize waterfall canvas at fixed high resolution
    // CSS will scale it to fit the display area
    waterfallCanvas.width = WATERFALL_INTERNAL_WIDTH;
    waterfallCanvas.height = WATERFALL_INTERNAL_HEIGHT;
    // No dpr scaling needed - we render at fixed resolution and let CSS scale

    // Watch for display resize to reset the waterfall (clears old content on resize)
    const waterfallResizeObserver = new ResizeObserver(() => {
      // Only reset initialization flag to redraw labels, don't change canvas size
      waterfallInitialized = false;
    });

    resizeObserver.observe(canvas);
    waterfallResizeObserver.observe(waterfallCanvas);

    function render() {
      if (!ctx) return;

      const width = canvas.width / (window.devicePixelRatio || 1);
      const height = canvas.height / (window.devicePixelRatio || 1);

      // Clear
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, width, height);

      // Drawing dimensions (must match SpectrumPanel margins)
      const padding = { left: 45, right: 15, top: 20, bottom: 30 };
      const graphWidth = width - padding.left - padding.right;
      const graphHeight = height - padding.top - padding.bottom;

      // Draw grid
      ctx.strokeStyle = '#1a1f2c';
      ctx.lineWidth = 1;

      // Vertical frequency grid lines (logarithmic)
      ctx.beginPath();
      for (const freq of FREQ_LABELS) {
        const x = padding.left + (Math.log10(freq / MIN_FREQ) / Math.log10(MAX_FREQ / MIN_FREQ)) * graphWidth;
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, height - padding.bottom);
      }
      ctx.stroke();

      // Horizontal dB grid lines
      const dbLines = [-60, -48, -36, -24, -12, 0];
      ctx.beginPath();
      for (const db of dbLines) {
        const y = padding.top + ((0 - db) / 60) * graphHeight;
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
      }
      ctx.stroke();

      // Use bars from the processed spectrum that correspond to bass frequencies
      const bassBarCount = BASS_END_BAR - BASS_START_BAR + 1;

      // PERFORMANCE: Use cached gradient, only recreate on resize
      if (!cachedGradient || cachedGradientHeight !== height) {
        cachedGradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
        cachedGradient.addColorStop(0, 'rgba(139, 92, 246, 0.8)'); // Purple at top
        cachedGradient.addColorStop(0.3, 'rgba(239, 68, 68, 0.6)'); // Red
        cachedGradient.addColorStop(1, 'rgba(139, 92, 246, 0.1)'); // Fade at bottom
        cachedGradientHeight = height;
      }

      if (displayMode === 'bars') {
        // BARS MODE: Draw discrete frequency bars
        const barGap = 3; // Gap between bars in pixels
        const totalGaps = (BAR_COUNT - 1) * barGap;
        const barWidth = (graphWidth - totalGaps) / BAR_COUNT;

        for (let i = 0; i < BAR_COUNT; i++) {
          // Map bar index to frequency range (logarithmic)
          const freqRatio = i / (BAR_COUNT - 1);
          const logMin = Math.log10(MIN_FREQ);
          const logMax = Math.log10(MAX_FREQ);
          const centerFreq = Math.pow(10, logMin + freqRatio * (logMax - logMin));

          // Find the spectrum bin for this frequency
          const binIndex = freqToBar(centerFreq);

          // Average a few bins around the center for smoother bars
          let magnitude = 0;
          const binRange = Math.max(1, Math.floor(bassBarCount / BAR_COUNT / 2));
          let count = 0;
          for (let b = -binRange; b <= binRange; b++) {
            const idx = binIndex + b;
            if (idx >= 0 && idx < spectrum.length) {
              magnitude += spectrum[idx];
              count++;
            }
          }
          magnitude = count > 0 ? magnitude / count : 0;

          // Update peak hold
          if (magnitude >= peakHold[i]) {
            peakHold[i] = magnitude;
            peakHoldCounters[i] = peakHoldTime; // Reset hold counter
          } else {
            // Decay peak after hold time
            if (peakHoldCounters[i] > 0) {
              peakHoldCounters[i]--;
            } else {
              peakHold[i] = Math.max(0, peakHold[i] - peakDecayRate);
            }
          }

          // Calculate bar position and size
          const x = padding.left + i * (barWidth + barGap);
          const barHeight = magnitude * graphHeight;
          const y = height - padding.bottom - barHeight;

          // Draw filled bar with gradient
          ctx.fillStyle = cachedGradient!;
          ctx.fillRect(x, y, barWidth, barHeight);

          // Draw bar outline
          ctx.strokeStyle = 'rgba(139, 92, 246, 0.9)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, barWidth, barHeight);

          // Draw peak hold indicator
          const peakHeight = peakHold[i] * graphHeight;
          const peakY = height - padding.bottom - peakHeight;
          if (peakHeight > barHeight + 2) { // Only show if peak is above current bar
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.fillRect(x, peakY, barWidth, 2);
          }

          // Draw frequency label below bar (only for some bars to avoid clutter)
          if (i % 3 === 0 || i === BAR_COUNT - 1) {
            ctx.fillStyle = '#606060';
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(`${Math.round(centerFreq)}`, x + barWidth / 2, height - padding.bottom + 5);
          }
        }
      } else {
        // CURVE MODE: Draw bass spectrum as filled area (original)
        ctx.beginPath();

        // Start from bottom left
        ctx.moveTo(padding.left, height - padding.bottom);

        for (let i = 0; i < bassBarCount; i++) {
          const barIndex = BASS_START_BAR + i;
          const normalizedIndex = i / (bassBarCount - 1);

          // Get magnitude directly from processed spectrum (already 0-1 normalized)
          const magnitude = barIndex < spectrum.length ? spectrum[barIndex] : 0;

          // Calculate position
          const x = padding.left + normalizedIndex * graphWidth;
          const barHeight = magnitude * graphHeight;
          const y = height - padding.bottom - barHeight;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }

        // Complete the path
        ctx.lineTo(width - padding.right, height - padding.bottom);
        ctx.lineTo(padding.left, height - padding.bottom);
        ctx.closePath();

        ctx.fillStyle = cachedGradient;
        ctx.fill();

        // Draw outline
        ctx.strokeStyle = 'rgba(139, 92, 246, 0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();

        for (let i = 0; i < bassBarCount; i++) {
          const barIndex = BASS_START_BAR + i;
          const normalizedIndex = i / (bassBarCount - 1);

          // Get magnitude directly from processed spectrum (already 0-1 normalized)
          const magnitude = barIndex < spectrum.length ? spectrum[barIndex] : 0;

          const x = padding.left + normalizedIndex * graphWidth;
          const barHeight = magnitude * graphHeight;
          const y = height - padding.bottom - barHeight;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }

      // Draw frequency labels (only in curve mode - bars mode draws its own)
      if (displayMode === 'curve') {
        ctx.fillStyle = '#606060';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        for (const freq of FREQ_LABELS) {
          const x = padding.left + (Math.log10(freq / MIN_FREQ) / Math.log10(MAX_FREQ / MIN_FREQ)) * graphWidth;
          ctx.fillText(`${freq}`, x, height - padding.bottom + 5);
        }
      }

      // Draw dB labels
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';

      for (const db of dbLines) {
        const y = padding.top + ((0 - db) / 60) * graphHeight;
        ctx.fillText(`${db}`, padding.left - 5, y);
      }

      // Draw title
      ctx.fillStyle = '#a0a0a0';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('BASS DETAIL (20-200Hz)', padding.left, 3);

      // === WATERFALL SPECTROGRAM (Fixed High-Resolution Rendering) ===
      // Renders at fixed internal resolution (800x300) for consistent quality
      // CSS scales the canvas to fit the display area
      if (waterfallCtx && waterfallWidth > 0 && waterfallHeight > 0) {
        // Minimal padding - labels are HTML overlays outside the canvas
        const wfPadding = { left: 0, right: 0, top: 0, bottom: 0 };
        const wfGraphWidth = waterfallWidth - wfPadding.left - wfPadding.right;
        const wfGraphHeight = waterfallHeight - wfPadding.top - wfPadding.bottom;
        const lineHeight = Math.max(1, Math.floor(wfGraphHeight / WATERFALL_HISTORY));

        // Initialize waterfall on first run or after resize
        if (!waterfallInitialized) {
          waterfallCtx.fillStyle = '#0a0a0f';
          waterfallCtx.fillRect(0, 0, waterfallWidth, waterfallHeight);

          // Pre-allocate ImageData for row rendering (at fixed resolution)
          waterfallRowImageData = waterfallCtx.createImageData(wfGraphWidth, lineHeight);

          // Labels are now rendered as HTML overlays for crisp text at any scale
          waterfallInitialized = true;
        }

        // OPTIMIZATION: Scroll existing content down by one line height
        // This copies the existing waterfall and shifts it down, avoiding full redraw
        const srcY = wfPadding.top;
        const srcH = wfGraphHeight - lineHeight;
        if (srcH > 0) {
          waterfallCtx.drawImage(
            waterfallCanvas,
            wfPadding.left, srcY, wfGraphWidth, srcH,  // Source rect
            wfPadding.left, srcY + lineHeight, wfGraphWidth, srcH   // Dest rect
          );
        }

        // Draw only the new top row using ImageData (fast pixel manipulation)
        if (!waterfallRowImageData) return;
        const rowWidth = waterfallRowImageData.width;
        const rowHeight = waterfallRowImageData.height;
        const pixels = waterfallRowImageData.data;

        for (let x = 0; x < rowWidth; x++) {
          // Map pixel x to frequency bin
          const binIndex = Math.floor((x / rowWidth) * BASS_BAR_COUNT);
          const barIndex = BASS_START_BAR + binIndex;
          const magnitude = barIndex < spectrum.length ? spectrum[barIndex] : 0;

          // Convert magnitude to LUT index (0-255)
          const lutIndex = Math.floor(Math.max(0, Math.min(1, magnitude)) * 255) * 4;

          // Fill all pixels in this column for the line height
          for (let y = 0; y < rowHeight; y++) {
            const pixelIndex = (y * rowWidth + x) * 4;
            pixels[pixelIndex] = COLOR_LUT[lutIndex];         // R
            pixels[pixelIndex + 1] = COLOR_LUT[lutIndex + 1]; // G
            pixels[pixelIndex + 2] = COLOR_LUT[lutIndex + 2]; // B
            pixels[pixelIndex + 3] = 255;                     // A
          }
        }

        // Put the new row at the top of the waterfall area
        waterfallCtx.putImageData(waterfallRowImageData, wfPadding.left, wfPadding.top);
      }

      animationId = requestAnimationFrame(render);
    }

    render();

    return () => {
      resizeObserver.disconnect();
      waterfallResizeObserver.disconnect();
    };
  });

  onDestroy(() => {
    unsubscribe();
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
    }
  });
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="bass-panel">
  <div
    class="bass-graph"
    class:expanded={!$moduleVisibility.waterfall}
    bind:this={bassGraphContainer}
    on:mousemove={handleMouseMove}
    on:mouseleave={handleMouseLeave}
  >
    <canvas bind:this={canvas}></canvas>

    <!-- Display Mode Toggle -->
    <button
      class="mode-toggle"
      on:click={toggleDisplayMode}
      title="Toggle between Curve and Bars display"
      aria-label="Toggle display mode"
    >
      <span class="toggle-label">{displayMode === 'curve' ? 'CURVE' : 'BARS'}</span>
      <span class="toggle-indicator" class:bars-mode={displayMode === 'bars'}></span>
    </button>

    <!-- Frequency Cursor -->
    {#if cursorVisible && cursorFreq > 0}
      <div class="cursor-line" style="left: {cursorX}px;"></div>
      <div
        class="cursor-tooltip"
        style="left: {cursorX}px; top: {cursorY}px;"
        class:flip-left={cursorX > containerWidth - 100}
      >
        <span class="cursor-freq">{formatFreq(cursorFreq)}</span>
        <span class="cursor-db">{cursorDb > -99 ? cursorDb.toFixed(1) : '---'} dB</span>
      </div>
    {/if}
  </div>
  <div class="waterfall-section" class:hidden={!$moduleVisibility.waterfall}>
    <div class="waterfall-header">
      <span class="waterfall-title">WATERFALL</span>
      <span class="waterfall-legend">
        <span class="legend-low"></span>
        <span class="legend-mid"></span>
        <span class="legend-high"></span>
      </span>
    </div>
    <div class="waterfall-content">
      <!-- Frequency scale (top) -->
      <div class="wf-freq-scale">
        <span style="left: 0%">20</span>
        <span style="left: 30%">40</span>
        <span style="left: 48%">60</span>
        <span style="left: 70%">100</span>
        <span style="left: 88%">150</span>
        <span style="left: 100%">200</span>
      </div>
      <!-- Time scale (left) -->
      <div class="wf-time-scale">
        <span class="wf-time-now">now</span>
        <span class="wf-time-past">-{Math.round(WATERFALL_HISTORY / 60)}s</span>
      </div>
      <!-- Canvas -->
      <div class="wf-canvas-container">
        <canvas bind:this={waterfallCanvas}></canvas>
      </div>
    </div>
  </div>
</div>

<style>
  .bass-panel {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg-panel);
    border-radius: var(--border-radius);
    border: 1px solid var(--border-color);
    overflow: hidden;
  }

  .bass-graph {
    flex: 1;
    min-height: 120px;
  }

  .bass-graph.expanded {
    flex: 2;
  }

  .bass-graph canvas {
    width: 100%;
    height: 100%;
  }

  .waterfall-section {
    flex: 1;
    min-height: 100px;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border-color);
  }

  .waterfall-section.hidden {
    display: none;
  }

  .waterfall-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.25rem 0.5rem;
    background: rgba(0, 0, 0, 0.2);
  }

  .waterfall-title {
    font-size: 0.65rem;
    font-weight: 500;
    color: var(--text-muted);
    letter-spacing: 0.1em;
  }

  .waterfall-legend {
    display: flex;
    gap: 2px;
    height: 8px;
  }

  .legend-low, .legend-mid, .legend-high {
    width: 20px;
    height: 100%;
    border-radius: 1px;
  }

  .legend-low {
    background: linear-gradient(90deg, #000020, #00c8ff);
  }

  .legend-mid {
    background: linear-gradient(90deg, #00ff64, #ffff00);
  }

  .legend-high {
    background: linear-gradient(90deg, #ff8800, #ffffff);
  }

  /* Waterfall content layout with HTML labels */
  .waterfall-content {
    flex: 1;
    display: grid;
    grid-template-columns: 30px 1fr;
    grid-template-rows: 16px 1fr;
    gap: 2px;
    min-height: 0;
  }

  .wf-freq-scale {
    grid-column: 2;
    grid-row: 1;
    position: relative;
    font-size: 10px;
    font-family: var(--font-mono);
    color: var(--text-muted);
  }

  .wf-freq-scale span {
    position: absolute;
    transform: translateX(-50%);
    white-space: nowrap;
  }

  .wf-time-scale {
    grid-column: 1;
    grid-row: 2;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: flex-end;
    padding-right: 4px;
    font-size: 9px;
    font-family: var(--font-mono);
    color: var(--text-muted);
  }

  .wf-time-now {
    padding-top: 2px;
  }

  .wf-time-past {
    padding-bottom: 2px;
  }

  .wf-canvas-container {
    grid-column: 2;
    grid-row: 2;
    min-height: 0;
    overflow: hidden;
  }

  .wf-canvas-container canvas {
    width: 100%;
    height: 100%;
  }

  /* Frequency Cursor */
  .bass-graph {
    position: relative;
  }

  .cursor-line {
    position: absolute;
    top: 20px;
    bottom: 30px;
    width: 1px;
    background: rgba(139, 92, 246, 0.6);
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
    border: 1px solid rgba(139, 92, 246, 0.5);
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
    color: rgb(139, 92, 246);
  }

  .cursor-db {
    font-size: 10px;
    font-family: monospace;
    color: var(--text-secondary);
  }

  /* Display Mode Toggle */
  .mode-toggle {
    position: absolute;
    top: 3px;
    right: 15px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    background: rgba(30, 35, 45, 0.9);
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 4px;
    color: #a0a0a0;
    font-size: 10px;
    font-family: monospace;
    cursor: pointer;
    z-index: 20;
    transition: all 0.15s ease;
  }

  .mode-toggle:hover {
    background: rgba(40, 50, 70, 0.95);
    border-color: rgba(139, 92, 246, 0.6);
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
    background: #8b5cf6;
    transition: background 0.15s ease;
  }

  .toggle-indicator.bars-mode {
    background: #22c55e;
  }
</style>
