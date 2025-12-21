<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { audioEngine } from '../../core/AudioEngine';
  import { renderCoordinator } from '../../core/RenderCoordinator';
  import { moduleVisibility } from '../../stores/moduleVisibility';

  const RENDER_ID = 'goniometer-panel';

  let canvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  let ctx: CanvasRenderingContext2D | null = null;

  // Display mode: 'gonio' for M/S Lissajous, 'vector' for raw L/R XY, 'polar' for polar diagram
  type DisplayMode = 'gonio' | 'vector' | 'polar';
  let displayMode: DisplayMode = 'gonio';

  function toggleDisplayMode() {
    if (displayMode === 'gonio') {
      displayMode = 'vector';
    } else if (displayMode === 'vector') {
      displayMode = 'polar';
    } else {
      displayMode = 'gonio';
    }
    // Clear persistence buffer on mode change for clean transition
    if (persistenceBuffer) {
      persistenceBuffer.data.fill(0);
    }
  }

  // Reactive labels (Svelte needs reactive statements, not functions, for template updates)
  $: modeLabel = displayMode === 'gonio' ? 'GONIO' : displayMode === 'vector' ? 'VECT' : 'POLAR';
  $: panelTitle = displayMode === 'gonio' ? 'GONIOMETER' : displayMode === 'vector' ? 'VECTORSCOPE' : 'POLAR SCOPE';

  // Sync visibility with RenderCoordinator
  $: renderCoordinator.setVisibility(RENDER_ID, $moduleVisibility.goniometer);

  // Persistence buffer for phosphor-like effect
  let persistenceBuffer: ImageData | null = null;

  // Canvas dimensions (responsive)
  let canvasSize = 180;

  // PERFORMANCE: Pre-computed decay lookup table (0.94 multiplier)
  // This avoids multiplication and Math.floor in the hot loop
  const DECAY_LUT = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    DECAY_LUT[i] = (i * 0.94) | 0;  // Bitwise OR for fast floor
  }

  // ResizeObserver for responsive canvas
  let resizeObserver: ResizeObserver | null = null;

  function handleResize(width: number, height: number) {
    // Goniometer should be square, use smaller dimension
    const size = Math.floor(Math.min(width, height));
    if (size === canvasSize || size < 50) return;

    canvasSize = size;
    canvas.width = size;
    canvas.height = size;

    // Recreate persistence buffer at new size
    if (ctx) {
      persistenceBuffer = ctx.createImageData(size, size);
    }
  }

  onMount(() => {
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // Initialize persistence buffer
    persistenceBuffer = ctx.createImageData(canvasSize, canvasSize);

    // Setup ResizeObserver
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        handleResize(width, height);
      }
    });
    resizeObserver.observe(container);

    // Register with centralized render coordinator
    renderCoordinator.register(RENDER_ID, render, 'normal');
  });

  onDestroy(() => {
    renderCoordinator.unregister(RENDER_ID);
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
  });

  function render() {
    if (!ctx || !persistenceBuffer) {
      return;
    }

    const width = canvas.width;
    const height = canvas.height;

    // Handle buffer size mismatch after resize
    if (persistenceBuffer.width !== width || persistenceBuffer.height !== height) {
      persistenceBuffer = ctx.createImageData(width, height);
    }

    const centerX = width / 2;
    const centerY = height / 2;
    const scale = Math.min(width, height) / 2 - 12;

    // Decay the persistence buffer (phosphor effect)
    // PERFORMANCE: Use lookup table instead of multiplication + Math.floor
    const data = persistenceBuffer.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = DECAY_LUT[data[i]];         // R
      data[i + 1] = DECAY_LUT[data[i + 1]]; // G
      data[i + 2] = DECAY_LUT[data[i + 2]]; // B
      // Skip alpha (i + 3), it stays at 255
    }

    // Get stereo samples
    const samples = get(audioEngine.stereoSamples);

    // Draw new samples to persistence buffer
    for (let i = 0; i < samples.length - 1; i += 2) {
      const l = samples[i];
      const r = samples[i + 1];

      let px: number, py: number;
      let sideAmount: number;

      if (displayMode === 'gonio') {
        // GONIOMETER: Convert L/R to M/S (Lissajous transformation)
        // X = (R - L) / sqrt(2) = side signal
        // Y = (L + R) / sqrt(2) = mid signal
        const x = (r - l) * 0.707;
        const y = (l + r) * 0.707;
        px = Math.floor(centerX + x * scale);
        py = Math.floor(centerY - y * scale);
        sideAmount = Math.abs(x);
      } else if (displayMode === 'vector') {
        // VECTORSCOPE: Raw L/R as X/Y
        // X = R (right channel)
        // Y = L (left channel)
        px = Math.floor(centerX + r * scale);
        py = Math.floor(centerY - l * scale);
        sideAmount = Math.abs(r - l) * 0.5;
      } else {
        // POLAR: Angle = pan position, Radius = amplitude
        // Pan angle: -90° (left) to +90° (right), 0° = center/mono
        // Amplitude: sqrt(L² + R²)
        const amplitude = Math.sqrt(l * l + r * r);

        // Calculate pan angle from L/R balance
        // atan2(R-L, L+R) gives angle where mono=0, left=-45°, right=+45°
        // We scale to -90° to +90° range
        const mid = l + r;
        const side = r - l;
        let panAngle = 0;
        if (Math.abs(mid) > 0.001 || Math.abs(side) > 0.001) {
          panAngle = Math.atan2(side, Math.abs(mid)) * (180 / Math.PI);
        }

        // Convert to radians for drawing (0° = top, going clockwise)
        // panAngle: -90 (left) to +90 (right)
        // Canvas angle: -90° offset so 0° pan = top
        const angleRad = (panAngle - 90) * (Math.PI / 180);

        // Map amplitude to radius (with some scaling)
        // Use larger scale for polar since it's at bottom
        const polarScale = Math.min(width, height) - 20;
        const radius = amplitude * polarScale * 0.45;

        // Polar origin is at bottom center
        const polarCenterY = height - 10;
        px = Math.floor(centerX + Math.cos(angleRad) * radius);
        py = Math.floor(polarCenterY + Math.sin(angleRad) * radius);
        sideAmount = Math.abs(panAngle) / 90;
      }

      // Bounds check
      if (px >= 0 && px < width && py >= 0 && py < height) {
        const idx = (py * width + px) * 4;

        // Color based on position
        const intensity = Math.min(255, 100 + Math.abs(l + r) * 500);

        // Bright green for mono (center), shift to cyan/orange for stereo
        data[idx] = Math.min(255, data[idx] + 50 + sideAmount * 150);     // R
        data[idx + 1] = Math.min(255, data[idx + 1] + intensity);         // G
        data[idx + 2] = Math.min(255, data[idx + 2] + 30 + sideAmount * 50); // B
        data[idx + 3] = 255; // A
      }
    }

    // Draw persistence buffer
    ctx.putImageData(persistenceBuffer, 0, 0);

    // Draw grid overlay
    const fontSize = Math.max(8, Math.floor(canvasSize / 22));
    ctx.font = `${fontSize}px monospace`;

    if (displayMode === 'polar') {
      // POLAR MODE: Semi-circular grid originating from bottom
      const polarCenterY = height - 10;
      const polarScale = Math.min(width, height) - 20;
      const polarRadius = polarScale * 0.45;

      // Draw concentric arcs (amplitude levels)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 1;
      for (let r = 0.25; r <= 1; r += 0.25) {
        ctx.beginPath();
        ctx.arc(centerX, polarCenterY, polarRadius * r, -Math.PI, 0); // Top half only
        ctx.stroke();
      }

      // Draw radial lines at key angles
      const angles = [-90, -60, -45, -30, 0, 30, 45, 60, 90]; // degrees from center
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      for (const deg of angles) {
        const angleRad = (deg - 90) * (Math.PI / 180);
        ctx.beginPath();
        ctx.moveTo(centerX, polarCenterY);
        ctx.lineTo(
          centerX + Math.cos(angleRad) * polarRadius,
          polarCenterY + Math.sin(angleRad) * polarRadius
        );
        ctx.stroke();
      }

      // Center line (mono) more prominent
      ctx.strokeStyle = 'rgba(100, 255, 100, 0.15)';
      ctx.beginPath();
      ctx.moveTo(centerX, polarCenterY);
      ctx.lineTo(centerX, polarCenterY - polarRadius);
      ctx.stroke();

      // Labels
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('C', centerX, polarCenterY - polarRadius - 2);

      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText('L', centerX - polarRadius - 2, polarCenterY + 2);

      ctx.textAlign = 'left';
      ctx.fillText('R', centerX + polarRadius + 2, polarCenterY + 2);

      // Angle markers
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      const smallFont = Math.max(6, Math.floor(canvasSize / 28));
      ctx.font = `${smallFont}px monospace`;

      // -45° and +45° markers
      const marker45Rad = 45 * (Math.PI / 180);
      ctx.textAlign = 'right';
      ctx.fillText('45°', centerX - Math.cos(marker45Rad) * polarRadius * 0.7 - 2, polarCenterY - Math.sin(marker45Rad) * polarRadius * 0.7);
      ctx.textAlign = 'left';
      ctx.fillText('45°', centerX + Math.cos(marker45Rad) * polarRadius * 0.7 + 2, polarCenterY - Math.sin(marker45Rad) * polarRadius * 0.7);

    } else {
      // GONIO and VECTOR modes
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;

      // Main axes
      ctx.beginPath();
      ctx.moveTo(centerX, 4);
      ctx.lineTo(centerX, height - 4);
      ctx.moveTo(4, centerY);
      ctx.lineTo(width - 4, centerY);
      ctx.stroke();

      // Diagonal lines (45 degrees)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.beginPath();
      ctx.moveTo(4, height - 4);
      ctx.lineTo(width - 4, 4);
      ctx.moveTo(4, 4);
      ctx.lineTo(width - 4, height - 4);
      ctx.stroke();

      // Reference circles
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.beginPath();
      ctx.arc(centerX, centerY, scale * 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(centerX, centerY, scale, 0, Math.PI * 2);
      ctx.stroke();

      // Draw axis labels
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';

      if (displayMode === 'gonio') {
        // Goniometer: M/S labels
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('+M', centerX, 2);
        ctx.textBaseline = 'bottom';
        ctx.fillText('-M', centerX, height - 2);

        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('L', 2, centerY);
        ctx.textAlign = 'right';
        ctx.fillText('R', width - 2, centerY);
      } else {
        // Vectorscope: L/R labels on axes
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('+L', centerX, 2);
        ctx.textBaseline = 'bottom';
        ctx.fillText('-L', centerX, height - 2);

        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('-R', 2, centerY);
        ctx.textAlign = 'right';
        ctx.fillText('+R', width - 2, centerY);

        // Mark mono line (45° diagonal) more prominently in vectorscope
        ctx.strokeStyle = 'rgba(100, 255, 100, 0.1)';
        ctx.beginPath();
        ctx.moveTo(4, height - 4);
        ctx.lineTo(width - 4, 4);
        ctx.stroke();
      }
    }
  }
</script>

<div class="goniometer-panel" bind:this={container}>
  <div class="panel-header">
    <span class="title">{panelTitle}</span>
    <button
      class="mode-toggle"
      on:click={toggleDisplayMode}
      title="Toggle between Goniometer, Vectorscope, and Polar display"
      aria-label="Toggle display mode"
    >
      <span class="toggle-label">{modeLabel}</span>
      <span class="toggle-indicator" class:vector-mode={displayMode === 'vector'} class:polar-mode={displayMode === 'polar'}></span>
    </button>
  </div>
  <div class="canvas-container">
    <canvas bind:this={canvas} width={canvasSize} height={canvasSize}></canvas>
  </div>
</div>

<style>
  .goniometer-panel {
    display: flex;
    flex-direction: column;
    padding: 0.5rem;
    background: var(--bg-panel);
    border-radius: var(--border-radius);
    border: 1px solid var(--border-color);
    gap: 0.25rem;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding-bottom: 0.25rem;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .title {
    font-size: 0.65rem;
    font-weight: 500;
    color: var(--text-secondary);
    letter-spacing: 0.1em;
  }

  .mode-toggle {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 2px 6px;
    background: rgba(30, 35, 45, 0.9);
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 3px;
    color: #a0a0a0;
    font-size: 9px;
    font-family: monospace;
    cursor: pointer;
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
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #8b5cf6;
    transition: background 0.15s ease;
  }

  .toggle-indicator.vector-mode {
    background: #22c55e;
  }

  .toggle-indicator.polar-mode {
    background: #f59e0b;
  }

  .canvas-container {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 0;
    overflow: hidden;
  }

  canvas {
    background: rgb(8, 8, 12);
    border-radius: 4px;
    max-width: 100%;
    max-height: 100%;
  }
</style>
