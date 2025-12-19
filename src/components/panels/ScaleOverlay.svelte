<script lang="ts">
  import { onMount } from 'svelte';
  import type { FFTMode } from '../../core/AudioEngine';

  export let width = 0;
  export let height = 0;
  export let fftMode: FFTMode = 'standard';

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;

  // Frequency scale configuration (logarithmic)
  const FREQ_LABELS = [20, 50, 100, 200, 500, '1k', '2k', '5k', '10k', '20k'];
  const FREQ_VALUES = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  const MIN_FREQ = 20;
  const MAX_FREQ = 20000;

  // dB scale configuration for mirrored stereo display
  // Top half: 0dB at top, -60dB at center
  // Bottom half: -60dB at center, 0dB at bottom
  const DB_LABELS_TOP = [0, -12, -24, -36, -48, -60];
  const DB_LABELS_BOTTOM = [-48, -36, -24, -12, 0];

  $: if (canvas && width > 0 && height > 0 && fftMode) {
    drawScales();
  }

  function drawScales() {
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(dpr, dpr);

    // Margins for the visualization area (must match BassDetailPanel and SpectrumRenderer)
    const margin = { left: 45, right: 15, top: 20, bottom: 30 };
    const graphWidth = width - margin.left - margin.right;
    const graphHeight = height - margin.top - margin.bottom;

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Draw frequency grid lines and labels
    ctx.strokeStyle = 'rgba(42, 48, 64, 0.5)';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#606060';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (let i = 0; i < FREQ_VALUES.length; i++) {
      const freq = FREQ_VALUES[i];
      // Logarithmic position (using same mapping as spectrum renderer)
      const normalizedPos = Math.sqrt(Math.log10(freq / MIN_FREQ) / Math.log10(MAX_FREQ / MIN_FREQ));
      const x = margin.left + normalizedPos * graphWidth;

      // Grid line
      ctx.beginPath();
      ctx.moveTo(x, margin.top);
      ctx.lineTo(x, height - margin.bottom);
      ctx.stroke();

      // Label (positioned below graph area like BassDetailPanel)
      ctx.fillText(String(FREQ_LABELS[i]), x, height - margin.bottom + 5);
    }

    // Draw dB grid lines and labels for mirrored stereo display
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    const centerY = margin.top + graphHeight / 2;
    const halfHeight = graphHeight / 2;

    // Top half: 0dB at top, -60dB at center
    for (const db of DB_LABELS_TOP) {
      // Map dB to vertical position (0dB at top of graph, -60dB at center)
      const normalizedDb = (0 - db) / 60; // 0 to 1
      const y = margin.top + normalizedDb * halfHeight;

      // Grid line
      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(width - margin.right, y);
      ctx.stroke();

      // Label (skip -60 as it will be drawn as center line)
      if (db !== -60) {
        ctx.fillText(`${db}`, margin.left - 5, y);
      }
    }

    // Center line at -60dB (emphasized with glow effect)
    // Draw glow layer first
    ctx.strokeStyle = 'rgba(74, 158, 255, 0.3)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(margin.left, centerY);
    ctx.lineTo(width - margin.right, centerY);
    ctx.stroke();

    // Draw main center line
    ctx.strokeStyle = 'rgba(74, 158, 255, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(margin.left, centerY);
    ctx.lineTo(width - margin.right, centerY);
    ctx.stroke();

    ctx.fillStyle = '#606060';
    ctx.fillText('-60', margin.left - 5, centerY);
    ctx.strokeStyle = 'rgba(42, 48, 64, 0.5)';
    ctx.lineWidth = 1;

    // Bottom half: -60dB at center, 0dB at bottom (mirrored)
    for (const db of DB_LABELS_BOTTOM) {
      // Map dB to vertical position (mirrored: -60dB at center, 0dB at bottom)
      const normalizedDb = (60 + db) / 60; // 0 to 1 (from center down)
      const y = centerY + normalizedDb * halfHeight;

      // Grid line
      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(width - margin.right, y);
      ctx.stroke();

      // Label
      ctx.fillText(`${db}`, margin.left - 5, y);
    }

    // Draw title header
    ctx.fillStyle = '#a0a0a0';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const modeLabel = fftMode === 'standard' ? 'STD 4096' : 'MULTI-RES';
    ctx.fillText(`SPECTRUM (20Hz-20kHz) [${modeLabel}]`, margin.left, 3);

    // Draw axis labels
    ctx.fillStyle = '#606060';
    ctx.font = '9px sans-serif';

    // Frequency axis label
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Hz', width - margin.right, height - margin.bottom + 15);

    // Channel labels (L/R) for stereo display
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'right';

    // Left channel label (top half)
    ctx.fillStyle = 'rgba(74, 158, 255, 0.6)';
    ctx.textBaseline = 'top';
    ctx.fillText('L', width - margin.right - 5, margin.top + 5);

    // Right channel label (bottom half)
    ctx.fillStyle = 'rgba(74, 158, 255, 0.6)';
    ctx.textBaseline = 'bottom';
    ctx.fillText('R', width - margin.right - 5, height - margin.bottom - 5);
  }

  onMount(() => {
    drawScales();
  });
</script>

<canvas
  bind:this={canvas}
  class="scale-overlay"
  style="width: {width}px; height: {height}px"
></canvas>

<style>
  .scale-overlay {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    z-index: 10;
  }
</style>
