<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { audioEngine } from '../../core/AudioEngine';
  import type { BeatInfo } from '../../analysis/BeatDetector';
  import type { VoiceInfo } from '../../analysis/VoiceDetector';
  import type { StereoAnalysisData } from '../../core/AudioEngine';

  let spectrum: Float32Array = new Float32Array(2048);
  let levels = { left: -100, right: -100, peak: -100 };
  let loudness = { momentary: -Infinity, shortTerm: -Infinity, integrated: -Infinity, range: 0, truePeak: -Infinity };

  // Stereo analysis data
  let stereoData: StereoAnalysisData = {
    correlation: 0,
    stereoWidth: 0,
    midLevel: -Infinity,
    sideLevel: -Infinity,
  };

  // Voice detection data
  let voiceData: VoiceInfo = {
    detected: false,
    confidence: 0,
    probability: 0,
    pitch: 0,
    formants: [],
    classification: 'instrumental',
    voiceRatio: 0,
    centroid: 0,
    vibratoRate: 0,
    vibratoDepth: 0,
    pitchStability: 0,
    hasVibrato: false,
  };

  // Audio source metadata
  let audioSourceInfo = {
    sampleRate: 0,
    bitDepth: 0,
    channels: 0,
    format: 'Unknown',
    applicationName: 'None',
    latencyMs: 0,
    available: false,
  };

  let audioInfoInterval: ReturnType<typeof setInterval> | null = null;

  // Beat detection metrics
  let beatInfo: BeatInfo = {
    bpm: 0,
    confidence: 0,
    beat: false,
    beatPhase: 0,
    beatStrength: 0,
    downbeat: false,
    beatCount: 0,
  };

  // Additional beat debug info from detector
  const kickEnergy = 0;
  const onsetStrength = 0;
  const tempoHistoryLen = 0;

  // Animation frame for beat info updates (Svelte 5 reactivity fix)
  let beatAnimationId: number | null = null;
  let beatFrameCount = 0;

  // Reactive display values
  $: displayBPM = beatInfo.bpm + beatFrameCount * 0;
  $: displayConfidence = beatInfo.confidence + beatFrameCount * 0;
  $: displayBeatPhase = beatInfo.beatPhase + beatFrameCount * 0;
  $: displayBeatStrength = beatInfo.beatStrength + beatFrameCount * 0;
  $: displayBeatCount = beatInfo.beatCount + beatFrameCount * 0;
  $: displayKickEnergy = kickEnergy + beatFrameCount * 0;
  $: displayOnsetStrength = onsetStrength + beatFrameCount * 0;

  // Additional debug info
  let debugInfo = {
    kickEnergy: 0,
    snareEnergy: 0,
    hihatEnergy: 0,
    tempoHistoryLen: 0,
    onsetHistoryMax: 0,
    frameTimeMs: 0,
  };

  $: displayKickEnergyVal = debugInfo.kickEnergy + beatFrameCount * 0;
  $: displaySnareEnergy = debugInfo.snareEnergy + beatFrameCount * 0;
  $: displayHihatEnergy = debugInfo.hihatEnergy + beatFrameCount * 0;
  $: displayTempoHistoryLen = debugInfo.tempoHistoryLen + beatFrameCount * 0;
  $: displayOnsetMax = debugInfo.onsetHistoryMax + beatFrameCount * 0;
  $: displayFrameTime = debugInfo.frameTimeMs + beatFrameCount * 0;

  function updateBeatDebugInfo() {
    beatInfo = get(audioEngine.beatInfo);

    // Get additional debug info from beat detector
    const detector = audioEngine.getBeatDetector();
    debugInfo = detector.getDebugInfo();

    beatFrameCount++;
    beatAnimationId = requestAnimationFrame(updateBeatDebugInfo);
  }

  // Frequency band analysis with peak hold
  interface BandInfo {
    name: string;
    range: string;
    peak: number;
    avg: number;
    peakHold: number;      // Peak hold value
    peakHoldTime: number;  // Time when peak was set
  }

  let bands: BandInfo[] = [];
  let dominantFreq = 0;
  let signalPresent = false;
  let latencyMs = 0;
  let lastUpdateTime = 0;

  // Peak hold settings
  const PEAK_HOLD_TIME_MS = 1500;  // Hold peak for 1.5 seconds
  const PEAK_DECAY_RATE = 0.15;    // Decay rate per frame after hold

  // Spectrum is now 512 bars mapped logarithmically from 20Hz-20kHz
  // Values are 0-1 normalized
  const TOTAL_BARS = 512;
  const SPECTRUM_MIN_FREQ = 20;
  const SPECTRUM_MAX_FREQ = 20000;

  // Band definitions (Hz) with corresponding bar ranges
  const BAND_RANGES = [
    { name: 'Sub-Bass', min: 20, max: 60 },
    { name: 'Bass', min: 60, max: 250 },
    { name: 'Low-Mid', min: 250, max: 500 },
    { name: 'Mid', min: 500, max: 2000 },
    { name: 'Upper-Mid', min: 2000, max: 4000 },
    { name: 'Presence', min: 4000, max: 6000 },
    { name: 'Brilliance', min: 6000, max: 20000 },
  ];

  // Initialize peak hold state
  const peakHolds: number[] = BAND_RANGES.map(() => 0);
  const peakHoldTimes: number[] = BAND_RANGES.map(() => 0);

  // Convert frequency to bar index (logarithmic mapping)
  function freqToBar(freq: number): number {
    const t = Math.log(freq / SPECTRUM_MIN_FREQ) / Math.log(SPECTRUM_MAX_FREQ / SPECTRUM_MIN_FREQ);
    return Math.floor(t * (TOTAL_BARS - 1));
  }

  // Convert bar index back to frequency
  function barToFreq(bar: number): number {
    const t = bar / (TOTAL_BARS - 1);
    return SPECTRUM_MIN_FREQ * Math.pow(SPECTRUM_MAX_FREQ / SPECTRUM_MIN_FREQ, t);
  }

  function analyzeBands(spec: Float32Array, now: number): BandInfo[] {
    return BAND_RANGES.map((band, idx) => {
      const startBar = freqToBar(band.min);
      const endBar = Math.min(freqToBar(band.max), spec.length - 1);

      let peak = 0;
      let sum = 0;
      let count = 0;

      for (let i = startBar; i <= endBar; i++) {
        const val = spec[i] || 0;
        peak = Math.max(peak, val);
        sum += val;
        count++;
      }

      // Convert 0-1 normalized to percentage for display
      const avgPercent = count > 0 ? (sum / count) * 100 : 0;

      // Update peak hold with decay
      if (avgPercent > peakHolds[idx]) {
        // New peak - update immediately
        peakHolds[idx] = avgPercent;
        peakHoldTimes[idx] = now;
      } else if (now - peakHoldTimes[idx] > PEAK_HOLD_TIME_MS) {
        // Hold time expired - decay
        peakHolds[idx] = Math.max(avgPercent, peakHolds[idx] - PEAK_DECAY_RATE * peakHolds[idx]);
      }

      return {
        name: band.name,
        range: `${band.min}-${band.max}Hz`,
        peak: peak * 100,
        avg: avgPercent,
        peakHold: peakHolds[idx],
        peakHoldTime: peakHoldTimes[idx],
      };
    });
  }

  function findDominantFreq(spec: Float32Array): number {
    let maxVal = 0;
    let maxBar = 0;

    for (let i = 1; i < spec.length; i++) {
      if (spec[i] > maxVal) {
        maxVal = spec[i];
        maxBar = i;
      }
    }

    return barToFreq(maxBar);
  }

  // Subscribe to stores
  const unsubSpectrum = audioEngine.spectrum.subscribe((data) => {
    spectrum = data;
    const now = performance.now();
    latencyMs = now - lastUpdateTime;
    lastUpdateTime = now;

    bands = analyzeBands(data, now);
    dominantFreq = findDominantFreq(data);
    // Signal present if any bar value exceeds 0.05 (5%)
    signalPresent = data.some(v => v > 0.05);
  });

  const unsubLevels = audioEngine.levels.subscribe((data) => {
    levels = data;
  });

  const unsubLoudness = audioEngine.loudness.subscribe((data) => {
    loudness = data;
  });

  const unsubStereo = audioEngine.stereoAnalysis.subscribe((data) => {
    stereoData = data;
  });

  const unsubVoice = audioEngine.voiceInfo.subscribe((data) => {
    voiceData = data;
  });

  // Fetch audio source info from Electron
  async function fetchAudioSourceInfo() {
    if (window.electronAPI?.system?.getAudioInfo) {
      try {
        audioSourceInfo = await window.electronAPI.system.getAudioInfo();
      } catch {
        // Electron API not available
      }
    }
  }

  onMount(() => {
    // Start beat debug update loop
    beatAnimationId = requestAnimationFrame(updateBeatDebugInfo);

    // Fetch audio source info immediately and then every second
    fetchAudioSourceInfo();
    audioInfoInterval = setInterval(fetchAudioSourceInfo, 1000);
  });

  onDestroy(() => {
    unsubSpectrum();
    unsubLevels();
    unsubLoudness();
    unsubStereo();
    unsubVoice();
    if (beatAnimationId !== null) {
      cancelAnimationFrame(beatAnimationId);
    }
    if (audioInfoInterval !== null) {
      clearInterval(audioInfoInterval);
    }
  });
</script>

<div class="debug-panel">
  <div class="debug-header">DEBUG OUTPUT</div>

  <div class="debug-section">
    <div class="section-title">Signal Status</div>
    <div class="stat-row">
      <span class="label">Signal:</span>
      <span class="value" class:active={signalPresent}>{signalPresent ? 'ACTIVE' : 'NONE'}</span>
    </div>
    <div class="stat-row">
      <span class="label">Update Rate:</span>
      <span class="value">{latencyMs.toFixed(1)}ms</span>
    </div>
    <div class="stat-row">
      <span class="label">Dominant Freq:</span>
      <span class="value">{dominantFreq.toFixed(0)} Hz</span>
    </div>
  </div>

  <div class="debug-section">
    <div class="section-title">Levels (dB)</div>
    <div class="stat-row">
      <span class="label">Left:</span>
      <span class="value">{levels.left.toFixed(1)}</span>
    </div>
    <div class="stat-row">
      <span class="label">Right:</span>
      <span class="value">{levels.right.toFixed(1)}</span>
    </div>
    <div class="stat-row">
      <span class="label">Peak:</span>
      <span class="value">{levels.peak.toFixed(1)}</span>
    </div>
  </div>

  <div class="debug-section">
    <div class="section-title">LUFS</div>
    <div class="stat-row">
      <span class="label">Momentary:</span>
      <span class="value">{isFinite(loudness.momentary) ? loudness.momentary.toFixed(1) : '-∞'}</span>
    </div>
    <div class="stat-row">
      <span class="label">Short-term:</span>
      <span class="value">{isFinite(loudness.shortTerm) ? loudness.shortTerm.toFixed(1) : '-∞'}</span>
    </div>
    <div class="stat-row">
      <span class="label">True Peak:</span>
      <span class="value">{isFinite(loudness.truePeak) ? loudness.truePeak.toFixed(1) : '-∞'}</span>
    </div>
  </div>

  <div class="debug-section">
    <div class="section-title">Beat Detection</div>
    <div class="stat-row">
      <span class="label">BPM:</span>
      <span class="value bpm">{displayBPM > 0 ? displayBPM : '---'}</span>
    </div>
    <div class="stat-row">
      <span class="label">Confidence:</span>
      <span class="value">{(displayConfidence * 100).toFixed(0)}%</span>
    </div>
    <div class="stat-row">
      <span class="label">Beat Count:</span>
      <span class="value">{displayBeatCount}</span>
    </div>
    <div class="stat-row">
      <span class="label">Phase:</span>
      <span class="value">{displayBeatPhase.toFixed(2)}</span>
    </div>
    <div class="stat-row">
      <span class="label">Strength:</span>
      <span class="value">{displayBeatStrength.toFixed(3)}</span>
    </div>
    <div class="stat-row">
      <span class="label">Kick Energy:</span>
      <span class="value kick">{displayKickEnergyVal.toFixed(3)}</span>
    </div>
    <div class="stat-row">
      <span class="label">Snare Energy:</span>
      <span class="value">{displaySnareEnergy.toFixed(3)}</span>
    </div>
    <div class="stat-row">
      <span class="label">HiHat Energy:</span>
      <span class="value">{displayHihatEnergy.toFixed(3)}</span>
    </div>
    <div class="stat-row">
      <span class="label">Onset Max:</span>
      <span class="value">{displayOnsetMax.toFixed(3)}</span>
    </div>
    <div class="stat-row">
      <span class="label">Tempo History:</span>
      <span class="value">{displayTempoHistoryLen}</span>
    </div>
    <div class="stat-row">
      <span class="label">Frame Time:</span>
      <span class="value">{displayFrameTime.toFixed(1)}ms</span>
    </div>
  </div>

  <div class="debug-section bands">
    <div class="section-title">Frequency Bands</div>
    {#each bands as band}
      <div class="band-row">
        <span class="band-name">{band.name}</span>
        <div class="band-meter">
          <div class="band-fill" style="width: {Math.max(0, band.avg)}%"></div>
          <div class="band-peak-hold" style="left: {Math.min(100, band.peakHold)}%"></div>
        </div>
        <span class="band-value">{band.peakHold.toFixed(0)}</span>
      </div>
    {/each}
  </div>

  <div class="debug-section">
    <div class="section-title">Stereo Analysis</div>
    <div class="stat-row">
      <span class="label">Correlation:</span>
      <span class="value" class:mono={stereoData.correlation > 0.9} class:wide={stereoData.correlation < 0.3}>
        {stereoData.correlation.toFixed(3)}
      </span>
    </div>
    <div class="stat-row">
      <span class="label">Width:</span>
      <span class="value">{(stereoData.stereoWidth * 100).toFixed(0)}%</span>
    </div>
    <div class="stat-row">
      <span class="label">Mid Level:</span>
      <span class="value">{isFinite(stereoData.midLevel) ? stereoData.midLevel.toFixed(1) : '-∞'} dB</span>
    </div>
    <div class="stat-row">
      <span class="label">Side Level:</span>
      <span class="value">{isFinite(stereoData.sideLevel) ? stereoData.sideLevel.toFixed(1) : '-∞'} dB</span>
    </div>
  </div>

  <div class="debug-section">
    <div class="section-title">Voice Detection</div>
    <div class="stat-row">
      <span class="label">Detected:</span>
      <span class="value" class:voice-detected={voiceData.detected}>
        {voiceData.detected ? 'YES' : 'NO'}
      </span>
    </div>
    <div class="stat-row">
      <span class="label">Classification:</span>
      <span class="value classification">{voiceData.classification.toUpperCase()}</span>
    </div>
    <div class="stat-row">
      <span class="label">Confidence:</span>
      <span class="value">{voiceData.confidence.toFixed(0)}%</span>
    </div>
    <div class="stat-row">
      <span class="label">Pitch:</span>
      <span class="value">{voiceData.pitch > 0 ? voiceData.pitch.toFixed(1) + ' Hz' : '---'}</span>
    </div>
    <div class="stat-row">
      <span class="label">Voice Ratio:</span>
      <span class="value">{(voiceData.voiceRatio * 100).toFixed(0)}%</span>
    </div>
    <div class="stat-row">
      <span class="label">Centroid:</span>
      <span class="value">{voiceData.centroid.toFixed(0)} Hz</span>
    </div>
    <div class="stat-row">
      <span class="label">Formants:</span>
      <span class="value formants">
        {voiceData.formants.length > 0 ? voiceData.formants.slice(0, 4).map(f => f.toFixed(0)).join(', ') : '---'}
      </span>
    </div>
    <div class="stat-row">
      <span class="label">Vibrato:</span>
      <span class="value" class:has-vibrato={voiceData.hasVibrato}>
        {voiceData.hasVibrato ? `${voiceData.vibratoRate.toFixed(1)} Hz` : 'NONE'}
      </span>
    </div>
    <div class="stat-row">
      <span class="label">Vibrato Depth:</span>
      <span class="value">{voiceData.vibratoDepth.toFixed(0)} cents</span>
    </div>
    <div class="stat-row">
      <span class="label">Pitch Stability:</span>
      <span class="value">{(voiceData.pitchStability * 100).toFixed(0)}%</span>
    </div>
  </div>

  <div class="debug-section">
    <div class="section-title">Audio Source</div>
    <div class="stat-row">
      <span class="label">Application:</span>
      <span class="value app-name">{audioSourceInfo.applicationName}</span>
    </div>
    <div class="stat-row">
      <span class="label">Sample Rate:</span>
      <span class="value">{audioSourceInfo.sampleRate > 0 ? `${audioSourceInfo.sampleRate} Hz` : '---'}</span>
    </div>
    <div class="stat-row">
      <span class="label">Bit Depth:</span>
      <span class="value">{audioSourceInfo.bitDepth > 0 ? `${audioSourceInfo.bitDepth}-bit` : '---'}</span>
    </div>
    <div class="stat-row">
      <span class="label">Channels:</span>
      <span class="value">{audioSourceInfo.channels > 0 ? (audioSourceInfo.channels === 2 ? 'Stereo' : audioSourceInfo.channels === 1 ? 'Mono' : `${audioSourceInfo.channels}ch`) : '---'}</span>
    </div>
    <div class="stat-row">
      <span class="label">Format:</span>
      <span class="value">{audioSourceInfo.format}</span>
    </div>
    <div class="stat-row">
      <span class="label">Stream Latency:</span>
      <span class="value">{audioSourceInfo.latencyMs > 0 ? `${audioSourceInfo.latencyMs.toFixed(1)} ms` : '---'}</span>
    </div>
  </div>
</div>

<style>
  .debug-panel {
    background: var(--bg-panel, rgba(0, 0, 0, 0.85));
    border: 1px solid var(--border-color, #333);
    border-radius: var(--border-radius, 4px);
    padding: 8px;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 10px;
    color: #0f0;
    width: 100%;
    height: 100%;
    min-width: 160px;
    box-sizing: border-box;
    overflow-y: auto;
  }

  .debug-header {
    font-weight: bold;
    color: #ff0;
    margin-bottom: 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid #333;
  }

  .debug-section {
    margin-bottom: 8px;
  }

  .section-title {
    color: #0af;
    font-weight: bold;
    margin-bottom: 4px;
  }

  .stat-row {
    display: flex;
    justify-content: space-between;
    padding: 1px 0;
  }

  .label {
    color: #888;
  }

  .value {
    color: #0f0;
  }

  .value.active {
    color: #0f0;
    font-weight: bold;
  }

  .value.bpm {
    color: #f0f;
    font-weight: bold;
    font-size: 11px;
  }

  .value.kick {
    color: #fa0;
  }

  .value.mono {
    color: #888;
  }

  .value.wide {
    color: #0ff;
  }

  .value.voice-detected {
    color: #0f0;
    font-weight: bold;
  }

  .value.classification {
    color: #f0f;
  }

  .value.formants {
    font-size: 9px;
  }

  .value.has-vibrato {
    color: #fa0;
  }

  .value.app-name {
    color: #0ff;
    text-transform: capitalize;
  }

  .bands .band-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 2px;
  }

  .band-name {
    width: 70px;
    color: #888;
    font-size: 9px;
  }

  .band-meter {
    flex: 1;
    height: 6px;
    position: relative;
    background: #222;
    border-radius: 2px;
    overflow: visible;
  }

  .band-fill {
    height: 100%;
    max-width: 100%;
    background: linear-gradient(90deg, #0a0, #ff0, #f00);
    transition: width 50ms ease-out;
    border-radius: 2px;
  }

  .band-peak-hold {
    position: absolute;
    top: 0;
    width: 2px;
    height: 100%;
    background: #fff;
    transform: translateX(-1px);
    transition: left 50ms ease-out;
    box-shadow: 0 0 3px rgba(255, 255, 255, 0.8);
  }

  .band-value {
    width: 24px;
    text-align: right;
    color: #0f0;
    font-size: 9px;
  }
</style>
