<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { audioEngine } from '../../core/AudioEngine';

  let canvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let animationId: number | null = null;

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

    // Start render loop
    animationId = requestAnimationFrame(render);
  });

  onDestroy(() => {
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
  });

  function render() {
    if (!ctx || !persistenceBuffer) {
      animationId = requestAnimationFrame(render);
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

      // Convert L/R to X/Y (Lissajous transformation)
      // X = (R - L) / sqrt(2) = side signal
      // Y = (L + R) / sqrt(2) = mid signal
      const x = (r - l) * 0.707;
      const y = (l + r) * 0.707;

      // Map to canvas coordinates
      const px = Math.floor(centerX + x * scale);
      const py = Math.floor(centerY - y * scale); // Invert Y for screen

      // Bounds check
      if (px >= 0 && px < width && py >= 0 && py < height) {
        const idx = (py * width + px) * 4;

        // Color based on position (green for mono, towards red/blue for stereo)
        const intensity = Math.min(255, 100 + Math.abs(l + r) * 500);
        const sideAmount = Math.abs(x);

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
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;

    // Main axes (M/S axes - vertical for mono, horizontal for side)
    ctx.beginPath();
    ctx.moveTo(centerX, 4);
    ctx.lineTo(centerX, height - 4);
    ctx.moveTo(4, centerY);
    ctx.lineTo(width - 4, centerY);
    ctx.stroke();

    // Diagonal lines (L and R axes - 45 degrees)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.beginPath();
    ctx.moveTo(4, height - 4);
    ctx.lineTo(width - 4, 4);    // L axis
    ctx.moveTo(4, 4);
    ctx.lineTo(width - 4, height - 4); // R axis
    ctx.stroke();

    // Reference circles
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, scale * 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(centerX, centerY, scale, 0, Math.PI * 2);
    ctx.stroke();

    // Draw axis labels (scale font with canvas size)
    const fontSize = Math.max(8, Math.floor(canvasSize / 22));
    ctx.font = `${fontSize}px monospace`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
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

    animationId = requestAnimationFrame(render);
  }
</script>

<div class="goniometer-panel" bind:this={container}>
  <div class="panel-header">
    <span class="title">GONIOMETER</span>
    <span class="subtitle">Stereo Field</span>
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

  .subtitle {
    font-size: 0.55rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
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
