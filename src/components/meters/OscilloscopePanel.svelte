<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { audioEngine } from '../../core/AudioEngine';

  let canvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let animationId: number | null = null;

  // Canvas dimensions (responsive)
  let canvasWidth = 400;
  let canvasHeight = 180;

  // Trigger settings
  let triggerLevel = 0;
  let timeScale = 1; // 1 = normal, 0.5 = zoom in, 2 = zoom out

  // Auto-scaling for visibility
  let autoGain = 1;
  const AUTO_GAIN_ATTACK = 0.1;  // How fast to increase gain
  const AUTO_GAIN_RELEASE = 0.02; // How fast to decrease gain
  const MIN_GAIN = 1;
  const MAX_GAIN = 50;  // Max amplification for quiet signals
  const TARGET_AMPLITUDE = 0.7; // Target peak amplitude on screen

  // Pre-allocated buffer for mono conversion (PERFORMANCE: avoid allocation per frame)
  let monoWaveformBuffer: Float32Array | null = null;

  // ResizeObserver for responsive canvas
  let resizeObserver: ResizeObserver | null = null;

  function handleResize(width: number, height: number) {
    const newWidth = Math.floor(width);
    const newHeight = Math.floor(height);
    if (newWidth === canvasWidth && newHeight === canvasHeight) return;
    if (newWidth < 50 || newHeight < 50) return;

    canvasWidth = newWidth;
    canvasHeight = newHeight;
    canvas.width = newWidth;
    canvas.height = newHeight;
  }

  onMount(() => {
    ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Setup ResizeObserver
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        handleResize(width, height);
      }
    });
    resizeObserver.observe(container);

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

  function findTriggerPoint(samples: Float32Array, gain: number): number {
    // Find zero-crossing with positive slope for stable display
    const threshold = triggerLevel / gain; // Adjust trigger for gain
    for (let i = 1; i < samples.length / 4; i++) {
      if (samples[i - 1] <= threshold && samples[i] > threshold) {
        return i;
      }
    }
    return 0; // No trigger found, start at beginning
  }

  function render() {
    if (!ctx) {
      animationId = requestAnimationFrame(render);
      return;
    }

    // Use stereo samples for better visualization (interleaved L/R)
    const stereoSamples = get(audioEngine.stereoSamples);
    const monoLength = stereoSamples.length / 2;

    // PERFORMANCE: Reuse pre-allocated buffer instead of creating new array each frame
    if (!monoWaveformBuffer || monoWaveformBuffer.length !== monoLength) {
      monoWaveformBuffer = new Float32Array(monoLength);
    }
    const waveform = monoWaveformBuffer;

    // Convert to mono for display
    for (let i = 0; i < monoLength; i++) {
      waveform[i] = (stereoSamples[i * 2] + stereoSamples[i * 2 + 1]) * 0.5;
    }

    const width = canvas.width;
    const height = canvas.height;
    const centerY = height / 2;

    // Calculate peak amplitude for auto-scaling
    let peakAmplitude = 0;
    for (let i = 0; i < waveform.length; i++) {
      peakAmplitude = Math.max(peakAmplitude, Math.abs(waveform[i]));
    }

    // Auto-gain adjustment
    if (peakAmplitude > 0.001) {
      const targetGain = TARGET_AMPLITUDE / peakAmplitude;
      const clampedTarget = Math.max(MIN_GAIN, Math.min(MAX_GAIN, targetGain));

      if (clampedTarget > autoGain) {
        // Increase gain slowly
        autoGain += (clampedTarget - autoGain) * AUTO_GAIN_ATTACK;
      } else {
        // Decrease gain faster to prevent clipping
        autoGain += (clampedTarget - autoGain) * AUTO_GAIN_RELEASE;
      }
    }

    // Clear with dark background
    ctx.fillStyle = 'rgb(8, 10, 15)';
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;

    // Vertical divisions (time)
    const timeDiv = width / 8;
    for (let x = timeDiv; x < width; x += timeDiv) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Horizontal divisions (amplitude)
    const ampDiv = height / 4;
    for (let y = ampDiv; y < height; y += ampDiv) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Center line (zero crossing)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    // Draw trigger level indicator
    ctx.strokeStyle = 'rgba(255, 200, 50, 0.3)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    const triggerY = centerY - triggerLevel * (height / 2) * 0.9;
    ctx.moveTo(0, triggerY);
    ctx.lineTo(width, triggerY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Find trigger point for stable display
    const triggerPoint = findTriggerPoint(waveform, autoGain);

    // Calculate how many samples to display
    const samplesToDisplay = Math.min(waveform.length - triggerPoint, Math.floor(width / timeScale));

    // Draw waveform with auto-gain
    if (waveform.length > 0 && samplesToDisplay > 0) {
      // Glow effect
      ctx.shadowColor = 'rgba(74, 220, 150, 0.5)';
      ctx.shadowBlur = 8;

      ctx.strokeStyle = 'rgb(74, 220, 150)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      for (let i = 0; i < samplesToDisplay; i++) {
        const sampleIndex = triggerPoint + i;
        if (sampleIndex >= waveform.length) break;

        const x = (i / samplesToDisplay) * width;
        // Apply auto-gain and clamp to prevent overdraw
        const amplifiedSample = Math.max(-1, Math.min(1, waveform[sampleIndex] * autoGain));
        const y = centerY - amplifiedSample * (height / 2) * 0.9;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      // Reset shadow
      ctx.shadowBlur = 0;
    }

    // Draw scale labels (scale font with canvas size)
    const fontSize = Math.max(8, Math.floor(Math.min(canvasWidth, canvasHeight) / 22));
    ctx.font = `${fontSize}px monospace`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('+1', 2, 4);
    ctx.textBaseline = 'bottom';
    ctx.fillText('-1', 2, height - 2);

    // Time scale and gain indicator
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    const msPerDiv = (1000 / 48000) * (waveform.length / 8) * timeScale;
    ctx.fillText(`${msPerDiv.toFixed(2)}ms/div`, width - 2, height - 2);

    // Show gain indicator when amplifying
    if (autoGain > 1.5) {
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(74, 220, 150, 0.5)';
      ctx.fillText(`x${autoGain.toFixed(1)}`, width - 2, 2);
    }

    animationId = requestAnimationFrame(render);
  }
</script>

<div class="oscilloscope-panel" bind:this={container}>
  <div class="panel-header">
    <span class="title">OSCILLOSCOPE</span>
    <span class="subtitle">Waveform</span>
  </div>
  <div class="canvas-container">
    <canvas bind:this={canvas} width={canvasWidth} height={canvasHeight}></canvas>
  </div>
</div>

<style>
  .oscilloscope-panel {
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
    width: 100%;
    height: 100%;
    border-radius: 4px;
  }
</style>
