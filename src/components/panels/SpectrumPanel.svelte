<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { audioEngine } from '../../core/AudioEngine';
  import type { FFTMode, FFTSize } from '../../core/AudioEngine';
  import { FFT_SIZES } from '../../core/AudioEngine';
  import { SpectrumRenderer } from '../../rendering/renderers/SpectrumRenderer';
  import { renderCoordinator } from '../../core/RenderCoordinator';
  import { moduleVisibility } from '../../stores/moduleVisibility';
  import ScaleOverlay from './ScaleOverlay.svelte';

  const RENDER_ID = 'spectrum-panel';

  let canvas: HTMLCanvasElement;
  let peakCanvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  let renderer: SpectrumRenderer | null = null;
  let peakCtx: CanvasRenderingContext2D | null = null;
  let spectrumStandard = new Float32Array(512);
  let spectrumMultiRes = new Float32Array(512);
  let spectrumLeft = new Float32Array(512);   // Left channel spectrum (standard)
  let spectrumRight = new Float32Array(512);  // Right channel spectrum (standard)
  let spectrumMultiResLeft = new Float32Array(512);   // Left channel spectrum (multi-res)
  let spectrumMultiResRight = new Float32Array(512);  // Right channel spectrum (multi-res)
  let fftMode: FFTMode = 'standard';
  let fftSize: FFTSize = 4096;
  let containerWidth = 0;
  let containerHeight = 0;

  // Display mode: 'bars' (discrete), 'smoo' (smooth WebGL), 'tech' (technical)
  type DisplayMode = 'bars' | 'smoo' | 'tech';
  let displayMode: DisplayMode = 'bars';

  function toggleDisplayMode() {
    if (displayMode === 'bars') {
      displayMode = 'smoo';
    } else if (displayMode === 'smoo') {
      displayMode = 'tech';
    } else {
      displayMode = 'bars';
    }
  }

  // Get display mode label for toggle button
  $: displayModeLabel = displayMode === 'bars' ? 'BARS' : displayMode === 'smoo' ? 'SMOO' : 'TECH';

  // TECH mode constants
  const TECH_FREQ_LABELS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  const TECH_DB_LABELS = [0, -10, -20, -30, -40, -50, -60, -70];
  const TECH_MIN_DB = -80;
  const TECH_MAX_DB = 0;
  const TECH_MIN_FREQ = 20;
  const TECH_MAX_FREQ = 20000;

  // Pre-calculate log positions for spectrum bars (512 bars mapped to log frequency)
  const logPositions = new Float32Array(512);
  const logRange = Math.log10(TECH_MAX_FREQ / TECH_MIN_FREQ);
  for (let i = 0; i < 512; i++) {
    // Each bar i represents a log-spaced frequency
    const t = i / 511;
    logPositions[i] = t; // Already log-distributed in spectrum data
  }

  // Frequency cursor state
  let cursorX = 0;
  let cursorY = 0;
  let cursorVisible = false;
  let cursorFreq = 0;
  let cursorDb = -100;

  // Subscribe to both spectrum sources (mono for compatibility)
  const unsubStandard = audioEngine.spectrum.subscribe((data) => {
    spectrumStandard = data;
  });

  const unsubMultiRes = audioEngine.spectrumMultiRes.subscribe((data) => {
    spectrumMultiRes = data;
  });

  // Subscribe to L/R stereo spectrum sources (standard FFT)
  const unsubLeft = audioEngine.spectrumLeft.subscribe((data) => {
    spectrumLeft = data;
  });

  const unsubRight = audioEngine.spectrumRight.subscribe((data) => {
    spectrumRight = data;
  });

  // Subscribe to L/R stereo spectrum sources (multi-res FFT)
  const unsubMultiResLeft = audioEngine.spectrumMultiResLeft.subscribe((data) => {
    spectrumMultiResLeft = data;
  });

  const unsubMultiResRight = audioEngine.spectrumMultiResRight.subscribe((data) => {
    spectrumMultiResRight = data;
  });

  // Subscribe to state for FFT mode and size
  const unsubState = audioEngine.state.subscribe((state) => {
    fftMode = state.fftMode;
    fftSize = state.fftSize;
  });

  // Get current spectrum based on mode (mono for cursor display)
  $: currentSpectrum = fftMode === 'standard' ? spectrumStandard : spectrumMultiRes;

  // Get current L/R spectrums based on FFT mode
  $: currentSpectrumLeft = fftMode === 'standard' ? spectrumLeft : spectrumMultiResLeft;
  $: currentSpectrumRight = fftMode === 'standard' ? spectrumRight : spectrumMultiResRight;

  // Sync visibility with RenderCoordinator
  $: renderCoordinator.setVisibility(RENDER_ID, $moduleVisibility.spectrum);

  // Toggle FFT mode
  function toggleMode() {
    audioEngine.toggleFFTMode();
  }

  // Cycle through FFT sizes (only in standard mode)
  function cycleFFTSize() {
    if (fftMode === 'standard') {
      audioEngine.cycleFFTSize();
    }
  }

  // Format FFT size for display
  function formatFFTSize(size: FFTSize): string {
    if (size >= 1024) {
      return `${size / 1024}K`;
    }
    return String(size);
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
      // Range: 0.0 = -80dB, 1.0 = -10dB (matches SpectrumAnalyzer)
      const amplitude = currentSpectrum[clampedIndex] || 0;
      cursorDb = amplitude > 0.001 ? -80 + amplitude * 70 : -100;
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

  // Draw peak hold indicators on 2D overlay (L/R stereo display)
  function drawPeakHold() {
    if (!peakCtx) return;

    // Get peak holds from L/R analyzers
    const peakHoldLeft = audioEngine.getSpectrumAnalyzerLeft().getPeakHolds();
    const peakHoldRight = audioEngine.getSpectrumAnalyzerRight().getPeakHolds();
    const barCount = peakHoldLeft.length;
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

    // Match WebGL renderer settings for stereo display
    const halfHeight = graphHeight / 2;
    const centerY = marginTop + halfHeight;  // Center line of graph
    const barWidth = graphWidth / barCount;

    // Draw peak indicators as small horizontal lines (DPR-scaled)
    const peakHeight = 2 * dpr;
    peakCtx.fillStyle = 'rgba(255, 255, 255, 0.95)';

    for (let i = 0; i < barCount; i++) {
      const x = marginLeft + i * barWidth;

      // Top half: LEFT channel peak indicator
      const peakValueLeft = peakHoldLeft[i];
      if (peakValueLeft > 0.02) {
        const yTop = centerY - peakValueLeft * halfHeight;
        peakCtx.fillRect(x, yTop - peakHeight, barWidth * 0.98, peakHeight);
      }

      // Bottom half: RIGHT channel peak indicator
      const peakValueRight = peakHoldRight[i];
      if (peakValueRight > 0.02) {
        const yBottom = centerY + peakValueRight * halfHeight;
        peakCtx.fillRect(x, yBottom, barWidth * 0.98, peakHeight);
      }
    }
  }

  // BARS mode: Discrete rectangular bars with L/R stereo (Canvas2D)
  function drawBarsMode() {
    if (!peakCtx) return;

    const width = peakCanvas.width;
    const height = peakCanvas.height;
    const dpr = window.devicePixelRatio || 1;

    // Margins scaled for DPR
    const marginLeft = MARGIN_LEFT * dpr;
    const marginRight = MARGIN_RIGHT * dpr;
    const marginTop = MARGIN_TOP * dpr;
    const marginBottom = MARGIN_BOTTOM * dpr;

    const graphLeft = marginLeft;
    const graphTop = marginTop;
    const graphWidth = width - marginLeft - marginRight;
    const graphHeight = height - marginTop - marginBottom;
    const graphBottom = graphTop + graphHeight;

    // Stereo: split into top (L) and bottom (R) halves
    const halfHeight = graphHeight / 2;
    const centerY = graphTop + halfHeight;

    // Clear canvas
    peakCtx.clearRect(0, 0, width, height);

    // Fill background
    peakCtx.fillStyle = '#0a0c10';
    peakCtx.fillRect(0, 0, width, height);

    // Draw grid lines (behind bars) - matching ScaleOverlay exactly
    const graphRight = graphLeft + graphWidth;
    peakCtx.strokeStyle = 'rgba(42, 48, 64, 0.5)';
    peakCtx.lineWidth = 1 * dpr;

    // dB scale: -10dB at edges, -80dB at center (70dB range)
    const DB_LABELS_TOP = [-10, -24, -36, -48, -60, -80];
    const DB_LABELS_BOTTOM = [-60, -48, -36, -24, -10];

    // Horizontal grid lines (dB) - top half: -10dB at top, -80dB at center
    for (const db of DB_LABELS_TOP) {
      const normalizedDb = (-10 - db) / 70; // 0 at -10dB (top), 1 at -80dB (center)
      const y = graphTop + normalizedDb * halfHeight;
      peakCtx.beginPath();
      peakCtx.moveTo(graphLeft, y);
      peakCtx.lineTo(graphRight, y);
      peakCtx.stroke();
    }

    // Horizontal grid lines (dB) - bottom half: -80dB at center, -10dB at bottom
    for (const db of DB_LABELS_BOTTOM) {
      const normalizedDb = (80 + db) / 70; // 0 at -80dB (center), 1 at -10dB (bottom)
      const y = centerY + normalizedDb * halfHeight;
      peakCtx.beginPath();
      peakCtx.moveTo(graphLeft, y);
      peakCtx.lineTo(graphRight, y);
      peakCtx.stroke();
    }

    // Vertical grid lines (frequency) - logarithmic
    const gridFreqValues = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
    for (const freq of gridFreqValues) {
      const x = graphLeft + (Math.log10(freq / 20) / logRange) * graphWidth;
      peakCtx.beginPath();
      peakCtx.moveTo(x, graphTop);
      peakCtx.lineTo(x, graphBottom);
      peakCtx.stroke();
    }

    // Draw center line with glow effect (matching ScaleOverlay)
    // Glow layer
    peakCtx.strokeStyle = 'rgba(74, 158, 255, 0.3)';
    peakCtx.lineWidth = 4 * dpr;
    peakCtx.beginPath();
    peakCtx.moveTo(graphLeft, centerY);
    peakCtx.lineTo(graphRight, centerY);
    peakCtx.stroke();
    // Main line
    peakCtx.strokeStyle = 'rgba(74, 158, 255, 0.7)';
    peakCtx.lineWidth = 1.5 * dpr;
    peakCtx.beginPath();
    peakCtx.moveTo(graphLeft, centerY);
    peakCtx.lineTo(graphRight, centerY);
    peakCtx.stroke();

    // Bar configuration - use fewer bars for discrete look
    const numBars = 128;  // Reduced from 512 for visible discrete bars
    const barGap = 2 * dpr;
    const barWidth = (graphWidth - (numBars - 1) * barGap) / numBars;

    // Downsample spectrum to numBars
    const step = currentSpectrumLeft.length / numBars;

    // Colors matching the reference screenshot
    const leftColor = 'rgba(220, 80, 180, 0.9)';   // Magenta/pink for Left
    const rightColor = 'rgba(80, 180, 220, 0.9)';  // Cyan for Right

    // Draw LEFT channel bars (top half, growing upward from center)
    peakCtx.fillStyle = leftColor;
    for (let i = 0; i < numBars; i++) {
      // Average the spectrum values for this bar
      const startIdx = Math.floor(i * step);
      const endIdx = Math.floor((i + 1) * step);
      let sum = 0;
      for (let j = startIdx; j < endIdx && j < currentSpectrumLeft.length; j++) {
        sum += currentSpectrumLeft[j];
      }
      const amplitude = sum / (endIdx - startIdx);

      const x = graphLeft + i * (barWidth + barGap);
      const barHeight = amplitude * halfHeight;

      if (barHeight > 1) {
        peakCtx.fillRect(x, centerY - barHeight, barWidth, barHeight);
      }
    }

    // Draw RIGHT channel bars (bottom half, growing downward from center)
    peakCtx.fillStyle = rightColor;
    for (let i = 0; i < numBars; i++) {
      const startIdx = Math.floor(i * step);
      const endIdx = Math.floor((i + 1) * step);
      let sum = 0;
      for (let j = startIdx; j < endIdx && j < currentSpectrumRight.length; j++) {
        sum += currentSpectrumRight[j];
      }
      const amplitude = sum / (endIdx - startIdx);

      const x = graphLeft + i * (barWidth + barGap);
      const barHeight = amplitude * halfHeight;

      if (barHeight > 1) {
        peakCtx.fillRect(x, centerY, barWidth, barHeight);
      }
    }

    // Draw L/R labels on right side (matching ScaleOverlay)
    peakCtx.font = `bold ${12 * dpr}px sans-serif`;
    peakCtx.textAlign = 'right';
    peakCtx.fillStyle = 'rgba(74, 158, 255, 0.6)';

    // L label at top-right
    peakCtx.textBaseline = 'top';
    peakCtx.fillText('L', graphRight - 5 * dpr, graphTop + 5 * dpr);

    // R label at bottom-right
    peakCtx.textBaseline = 'bottom';
    peakCtx.fillText('R', graphRight - 5 * dpr, graphBottom - 5 * dpr);

    // Draw frequency scale at bottom
    peakCtx.fillStyle = '#606060';
    peakCtx.font = `${10 * dpr}px monospace`;
    peakCtx.textAlign = 'center';
    peakCtx.textBaseline = 'top';
    const freqLabels = [20, 50, 100, 200, 500, '1k', '2k', '5k', '10k', '20k'];
    const freqValues = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    for (let i = 0; i < freqLabels.length; i++) {
      const x = graphLeft + (Math.log10(freqValues[i] / 20) / logRange) * graphWidth;
      peakCtx.fillText(String(freqLabels[i]), x, graphBottom + 5 * dpr);
    }

    // Draw dB scale on left side (matching ScaleOverlay exactly)
    peakCtx.fillStyle = '#606060';
    peakCtx.font = `${10 * dpr}px monospace`;
    peakCtx.textAlign = 'right';
    peakCtx.textBaseline = 'middle';

    // Top half dB labels (L channel): -10dB at top, -80dB at center
    for (const db of DB_LABELS_TOP) {
      const normalizedDb = (-10 - db) / 70;
      const y = graphTop + normalizedDb * halfHeight;
      // Skip -80 label (drawn separately at center)
      if (db !== -80) {
        peakCtx.fillText(`${db}`, graphLeft - 5 * dpr, y);
      }
    }

    // Center label at -80dB
    peakCtx.fillText('-80', graphLeft - 5 * dpr, centerY);

    // Bottom half dB labels (R channel): -80dB at center, -10dB at bottom
    for (const db of DB_LABELS_BOTTOM) {
      const normalizedDb = (80 + db) / 70;
      const y = centerY + normalizedDb * halfHeight;
      peakCtx.fillText(`${db}`, graphLeft - 5 * dpr, y);
    }
  }

  // TECH mode: Draw professional spectrum analyzer display with L/R stereo
  function drawTechMode() {
    if (!peakCtx) return;

    const width = peakCanvas.width;
    const height = peakCanvas.height;
    const dpr = window.devicePixelRatio || 1;

    // Margins scaled for DPR
    const marginLeft = MARGIN_LEFT * dpr;
    const marginRight = MARGIN_RIGHT * dpr;
    const marginTop = MARGIN_TOP * dpr;
    const marginBottom = MARGIN_BOTTOM * dpr;

    const graphLeft = marginLeft;
    const graphTop = marginTop;
    const graphWidth = width - marginLeft - marginRight;
    const graphHeight = height - marginTop - marginBottom;
    const graphBottom = graphTop + graphHeight;
    const graphRight = graphLeft + graphWidth;

    // Stereo: split into top (L) and bottom (R) halves
    const halfHeight = graphHeight / 2;
    const centerY = graphTop + halfHeight;

    // Clear the entire canvas
    peakCtx.clearRect(0, 0, width, height);

    // Fill background
    peakCtx.fillStyle = '#0a0c10';
    peakCtx.fillRect(0, 0, width, height);

    // dB scale: -10dB at edges, -80dB at center (70dB range) - matching ScaleOverlay
    const DB_LABELS_TOP = [-10, -24, -36, -48, -60, -80];
    const DB_LABELS_BOTTOM = [-60, -48, -36, -24, -10];

    // Draw grid lines (matching ScaleOverlay)
    peakCtx.strokeStyle = 'rgba(42, 48, 64, 0.5)';
    peakCtx.lineWidth = 1 * dpr;

    // Horizontal grid lines (dB) - top half: -10dB at top, -80dB at center
    for (const db of DB_LABELS_TOP) {
      const normalizedDb = (-10 - db) / 70;
      const y = graphTop + normalizedDb * halfHeight;
      peakCtx.beginPath();
      peakCtx.moveTo(graphLeft, y);
      peakCtx.lineTo(graphRight, y);
      peakCtx.stroke();
    }

    // Horizontal grid lines (dB) - bottom half: -80dB at center, -10dB at bottom
    for (const db of DB_LABELS_BOTTOM) {
      const normalizedDb = (80 + db) / 70;
      const y = centerY + normalizedDb * halfHeight;
      peakCtx.beginPath();
      peakCtx.moveTo(graphLeft, y);
      peakCtx.lineTo(graphRight, y);
      peakCtx.stroke();
    }

    // Center line with glow effect (matching ScaleOverlay)
    // Glow layer
    peakCtx.strokeStyle = 'rgba(74, 158, 255, 0.3)';
    peakCtx.lineWidth = 4 * dpr;
    peakCtx.beginPath();
    peakCtx.moveTo(graphLeft, centerY);
    peakCtx.lineTo(graphRight, centerY);
    peakCtx.stroke();
    // Main line
    peakCtx.strokeStyle = 'rgba(74, 158, 255, 0.7)';
    peakCtx.lineWidth = 1.5 * dpr;
    peakCtx.beginPath();
    peakCtx.moveTo(graphLeft, centerY);
    peakCtx.lineTo(graphRight, centerY);
    peakCtx.stroke();

    // Reset stroke style for other grid lines
    peakCtx.strokeStyle = 'rgba(42, 48, 64, 0.5)';
    peakCtx.lineWidth = 1 * dpr;

    // Vertical grid lines (frequency) - logarithmic
    for (const freq of TECH_FREQ_LABELS) {
      const x = graphLeft + (Math.log10(freq / TECH_MIN_FREQ) / logRange) * graphWidth;
      peakCtx.beginPath();
      peakCtx.moveTo(x, graphTop);
      peakCtx.lineTo(x, graphBottom);
      peakCtx.stroke();
    }

    // Draw L/R labels on right side (matching ScaleOverlay)
    peakCtx.font = `bold ${12 * dpr}px sans-serif`;
    peakCtx.textAlign = 'right';
    peakCtx.fillStyle = 'rgba(74, 158, 255, 0.6)';

    // L label at top-right
    peakCtx.textBaseline = 'top';
    peakCtx.fillText('L', graphRight - 5 * dpr, graphTop + 5 * dpr);

    // R label at bottom-right
    peakCtx.textBaseline = 'bottom';
    peakCtx.fillText('R', graphRight - 5 * dpr, graphBottom - 5 * dpr);

    // Draw frequency labels (bottom)
    peakCtx.fillStyle = '#606060';
    peakCtx.font = `${10 * dpr}px monospace`;
    peakCtx.textAlign = 'center';
    peakCtx.textBaseline = 'top';
    for (const freq of TECH_FREQ_LABELS) {
      const x = graphLeft + (Math.log10(freq / TECH_MIN_FREQ) / logRange) * graphWidth;
      const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
      peakCtx.fillText(label, x, graphBottom + 5 * dpr);
    }

    // Draw dB scale on left side (matching ScaleOverlay exactly)
    peakCtx.fillStyle = '#606060';
    peakCtx.font = `${10 * dpr}px monospace`;
    peakCtx.textAlign = 'right';
    peakCtx.textBaseline = 'middle';

    // Top half dB labels (L channel): -10dB at top, -80dB at center
    for (const db of DB_LABELS_TOP) {
      const normalizedDb = (-10 - db) / 70;
      const y = graphTop + normalizedDb * halfHeight;
      // Skip -80 label (drawn separately at center)
      if (db !== -80) {
        peakCtx.fillText(`${db}`, graphLeft - 5 * dpr, y);
      }
    }

    // Center label at -80dB
    peakCtx.fillText('-80', graphLeft - 5 * dpr, centerY);

    // Bottom half dB labels (R channel): -80dB at center, -10dB at bottom
    for (const db of DB_LABELS_BOTTOM) {
      const normalizedDb = (80 + db) / 70;
      const y = centerY + normalizedDb * halfHeight;
      peakCtx.fillText(`${db}`, graphLeft - 5 * dpr, y);
    }

    // Get peak holds for L/R
    const peakHoldLeft = audioEngine.getSpectrumAnalyzerLeft().getPeakHolds();
    const peakHoldRight = audioEngine.getSpectrumAnalyzerRight().getPeakHolds();

    // Helper function to convert amplitude to Y position
    // Amplitude 0-1 maps to -80dB to -10dB (matching ScaleOverlay)
    function amplitudeToY(amplitude: number, isTop: boolean): number {
      // amplitude 0 = -80dB (center), amplitude 1 = -10dB (edge)
      // Directly map amplitude to position (no dB conversion needed since data is already linear 0-1)
      if (isTop) {
        // Top half: amplitude 0 at centerY, amplitude 1 at graphTop
        return centerY - amplitude * halfHeight;
      } else {
        // Bottom half: amplitude 0 at centerY, amplitude 1 at graphBottom
        return centerY + amplitude * halfHeight;
      }
    }

    // --- LEFT CHANNEL (top half) ---
    // Create gradient for left spectrum fill (green tones)
    const gradientLeft = peakCtx.createLinearGradient(0, centerY, 0, graphTop);
    gradientLeft.addColorStop(0, 'rgba(34, 197, 94, 0.6)');    // Green at center
    gradientLeft.addColorStop(0.5, 'rgba(74, 222, 128, 0.7)'); // Light green
    gradientLeft.addColorStop(1, 'rgba(250, 204, 21, 0.8)');   // Yellow at top (loud)

    // Draw filled left spectrum area
    peakCtx.beginPath();
    peakCtx.moveTo(graphLeft, centerY);
    for (let i = 0; i < currentSpectrumLeft.length; i++) {
      const x = graphLeft + (i / (currentSpectrumLeft.length - 1)) * graphWidth;
      const y = amplitudeToY(currentSpectrumLeft[i], true);
      peakCtx.lineTo(x, y);
    }
    peakCtx.lineTo(graphRight, centerY);
    peakCtx.closePath();
    peakCtx.fillStyle = gradientLeft;
    peakCtx.fill();

    // Draw left channel line trace
    peakCtx.beginPath();
    peakCtx.strokeStyle = 'rgba(150, 255, 150, 0.9)';
    peakCtx.lineWidth = 1.5 * dpr;
    for (let i = 0; i < currentSpectrumLeft.length; i++) {
      const x = graphLeft + (i / (currentSpectrumLeft.length - 1)) * graphWidth;
      const y = amplitudeToY(currentSpectrumLeft[i], true);
      if (i === 0) peakCtx.moveTo(x, y);
      else peakCtx.lineTo(x, y);
    }
    peakCtx.stroke();

    // Draw left peak hold line (bright white-green for visibility)
    if (peakHoldLeft.length > 0) {
      peakCtx.beginPath();
      peakCtx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      peakCtx.lineWidth = 1.5 * dpr;
      for (let i = 0; i < peakHoldLeft.length; i++) {
        const x = graphLeft + (i / (peakHoldLeft.length - 1)) * graphWidth;
        const y = amplitudeToY(peakHoldLeft[i], true);
        if (i === 0) peakCtx.moveTo(x, y);
        else peakCtx.lineTo(x, y);
      }
      peakCtx.stroke();
    }

    // --- RIGHT CHANNEL (bottom half) ---
    // Create gradient for right spectrum fill (cyan/blue tones)
    const gradientRight = peakCtx.createLinearGradient(0, centerY, 0, graphBottom);
    gradientRight.addColorStop(0, 'rgba(59, 130, 246, 0.6)');   // Blue at center
    gradientRight.addColorStop(0.5, 'rgba(100, 180, 255, 0.7)'); // Light blue
    gradientRight.addColorStop(1, 'rgba(251, 146, 60, 0.8)');    // Orange at bottom (loud)

    // Draw filled right spectrum area
    peakCtx.beginPath();
    peakCtx.moveTo(graphLeft, centerY);
    for (let i = 0; i < currentSpectrumRight.length; i++) {
      const x = graphLeft + (i / (currentSpectrumRight.length - 1)) * graphWidth;
      const y = amplitudeToY(currentSpectrumRight[i], false);
      peakCtx.lineTo(x, y);
    }
    peakCtx.lineTo(graphRight, centerY);
    peakCtx.closePath();
    peakCtx.fillStyle = gradientRight;
    peakCtx.fill();

    // Draw right channel line trace
    peakCtx.beginPath();
    peakCtx.strokeStyle = 'rgba(150, 200, 255, 0.9)';
    peakCtx.lineWidth = 1.5 * dpr;
    for (let i = 0; i < currentSpectrumRight.length; i++) {
      const x = graphLeft + (i / (currentSpectrumRight.length - 1)) * graphWidth;
      const y = amplitudeToY(currentSpectrumRight[i], false);
      if (i === 0) peakCtx.moveTo(x, y);
      else peakCtx.lineTo(x, y);
    }
    peakCtx.stroke();

    // Draw right peak hold line (bright white for visibility)
    if (peakHoldRight.length > 0) {
      peakCtx.beginPath();
      peakCtx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      peakCtx.lineWidth = 1.5 * dpr;
      for (let i = 0; i < peakHoldRight.length; i++) {
        const x = graphLeft + (i / (peakHoldRight.length - 1)) * graphWidth;
        const y = amplitudeToY(peakHoldRight[i], false);
        if (i === 0) peakCtx.moveTo(x, y);
        else peakCtx.lineTo(x, y);
      }
      peakCtx.stroke();
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

    // Register with centralized render coordinator (high priority for main spectrum)
    renderCoordinator.register(RENDER_ID, () => {
      if (displayMode === 'smoo') {
        // SMOO mode: Smooth WebGL rendering
        renderer?.render(currentSpectrumLeft, currentSpectrumRight);
        drawPeakHold();
      } else if (displayMode === 'bars') {
        // BARS mode: Discrete rectangular bars
        drawBarsMode();
      } else {
        // TECH mode: Professional technical display
        drawTechMode();
      }
    }, 'high');

    return () => {
      resizeObserver.disconnect();
    };
  });

  onDestroy(() => {
    unsubStandard();
    unsubMultiRes();
    unsubLeft();
    unsubRight();
    unsubMultiResLeft();
    unsubMultiResRight();
    unsubState();
    renderCoordinator.unregister(RENDER_ID);
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
  <canvas class="webgl-canvas" class:hidden={displayMode !== 'smoo'} bind:this={canvas}></canvas>
  <canvas class="peak-canvas" bind:this={peakCanvas}></canvas>
  {#if displayMode === 'smoo'}
    <ScaleOverlay width={containerWidth} height={containerHeight} {fftMode} />
  {/if}

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

  <!-- Display Mode Toggle Button -->
  <button
    class="display-toggle"
    on:click={toggleDisplayMode}
    title="Toggle between BARS (discrete), SMOO (smooth), and TECH (technical) modes"
    aria-label="Toggle display mode"
  >
    <span class="toggle-label">{displayModeLabel}</span>
    <span class="toggle-indicator" class:smoo-mode={displayMode === 'smoo'} class:tech-mode={displayMode === 'tech'}></span>
  </button>

  <!-- FFT Mode Toggle Button -->
  <button
    class="fft-toggle"
    on:click={toggleMode}
    title="Toggle between Standard FFT and Multi-Resolution FFT"
    aria-label="Toggle FFT mode"
  >
    <span class="toggle-label">{fftMode === 'standard' ? 'STD' : 'MR'}</span>
    <span class="toggle-indicator" class:multi-res={fftMode === 'multiResolution'}></span>
  </button>

  <!-- FFT Size Toggle Button (only active in standard mode) -->
  <button
    class="fft-size-toggle"
    class:disabled={fftMode !== 'standard'}
    on:click={cycleFFTSize}
    title={fftMode === 'standard'
      ? `FFT Size: ${fftSize} (click to cycle: 512 → 1K → 2K → 4K)`
      : 'FFT size selection only available in Standard mode'}
    aria-label="Cycle FFT size"
  >
    <span class="toggle-label">{formatFFTSize(fftSize)}</span>
    <span class="size-indicator" class:size-512={fftSize === 512} class:size-1024={fftSize === 1024} class:size-2048={fftSize === 2048} class:size-4096={fftSize === 4096}></span>
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

  .webgl-canvas.hidden {
    visibility: hidden;
  }

  .display-toggle {
    position: absolute;
    top: 2px;
    right: 115px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    background: rgba(30, 35, 50, 0.9);
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 4px;
    color: #a0a0a0;
    font-size: 10px;
    font-family: monospace;
    cursor: pointer;
    z-index: 20;
    transition: all 0.15s ease;
  }

  .display-toggle:hover {
    background: rgba(40, 50, 70, 0.95);
    border-color: rgba(139, 92, 246, 0.6);
    color: #ffffff;
  }

  .toggle-indicator.smoo-mode {
    background: #22c55e;
  }

  .toggle-indicator.tech-mode {
    background: #8b5cf6;
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

  .fft-size-toggle {
    position: absolute;
    top: 2px;
    right: 5px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    background: rgba(30, 35, 50, 0.9);
    border: 1px solid rgba(250, 204, 21, 0.3);
    border-radius: 4px;
    color: #a0a0a0;
    font-size: 10px;
    font-family: monospace;
    cursor: pointer;
    z-index: 20;
    transition: all 0.15s ease;
  }

  .fft-size-toggle:hover:not(.disabled) {
    background: rgba(40, 50, 70, 0.95);
    border-color: rgba(250, 204, 21, 0.6);
    color: #ffffff;
  }

  .fft-size-toggle.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .size-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #facc15;
    transition: background 0.15s ease;
  }

  .size-indicator.size-512 {
    background: #ef4444;
  }

  .size-indicator.size-1024 {
    background: #f97316;
  }

  .size-indicator.size-2048 {
    background: #22c55e;
  }

  .size-indicator.size-4096 {
    background: #3b82f6;
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
