# AUDIO_PRIME Professional Visualizer Development Plan

## Project Overview

AUDIO_PRIME is a professional-grade web-based audio spectrum analyzer and visualizer, ported from the proven Python OMEGA implementation. Built with Vite, Svelte 5, TypeScript, and WebGL2, it provides real-time audio analysis with studio-quality metering.

**Target Platform:** Ubuntu 24.04 (Electron desktop app)
**Audio Backend:** PulseAudio/PipeWire via `parec`
**Reference Implementation:** `legacy/v1_v3_analyzers/live_audio_analyzer_professional_v4_OMEGA-2.py`

---

## Current Status (2025-12-19)

### Completed
- [x] Basic Vite + Svelte 5 + TypeScript project structure
- [x] WebGL2 instanced spectrum renderer (512 bars, 60+ FPS)
- [x] Electron integration with parec audio capture
- [x] dB-domain frequency compensation curve
- [x] Psychoacoustic weighting for key frequencies
- [x] BassDetailPanel component (20-200Hz visualization)
- [x] DebugPanel with frequency band analysis
- [x] VU meters (L/R channels)
- [x] LUFS metering (momentary, short-term, integrated)
- [x] True Peak detection scaffolding
- [x] Scarlett 2i2 audio capture verified working

### In Progress
- [ ] Fine-tuning frequency compensation curves
- [ ] Performance optimization

---

## Phase 1: Core Audio Quality (High Priority)

### 1.1 Fine-tune Frequency Compensation Curve
**Status:** In Progress
**Priority:** Critical

Current implementation uses logarithmic dB-domain compensation:
- Reference: 1kHz = 0dB
- Below 1kHz: -1.5dB/octave
- Above 1kHz: +2.5dB/octave

**Tasks:**
- [ ] Test with heavy metal (strong bass/guitars)
- [ ] Test with classical (wide dynamic range)
- [ ] Test with electronic/EDM (sub-bass heavy)
- [ ] Test with podcasts/speech (vocal clarity)
- [ ] Adjust compensation curve based on findings
- [ ] Document final curve parameters

**Files:** `src/audio/SpectrumAnalyzer.ts`

### 1.2 Replace Inline FFT Worker with fft.js
**Status:** Pending
**Priority:** High

Current implementation uses inline Cooley-Tukey FFT in a blob worker. The `fft.js` library is already in dependencies but not utilized.

**Tasks:**
- [ ] Refactor FFTWorker to use fft.js
- [ ] Benchmark performance improvement
- [ ] Verify output matches current implementation

**Files:** `src/workers/FFTWorker.ts`

### 1.3 Implement MultiResolutionFFT
**Status:** Pending
**Priority:** High

Port OMEGA's multi-resolution approach for frequency-specific FFT sizes:

| Frequency Range | FFT Size | Hop Size | Purpose |
|-----------------|----------|----------|---------|
| 20-200 Hz       | 4096     | 1024     | Bass detail |
| 200-1000 Hz     | 2048     | 512      | Low-mid clarity |
| 1000-5000 Hz    | 1024     | 256      | Mid responsiveness |
| 5000-20000 Hz   | 1024     | 256      | High transient response |

**Tasks:**
- [ ] Create MultiResolutionFFT class
- [ ] Implement ring buffers for each resolution
- [ ] Merge results with proper weighting
- [ ] Test latency impact

**Files:** `src/audio/MultiResolutionFFT.ts` (new)

### 1.4 Audio Capture Verification
**Status:** COMPLETED
**Priority:** High

Parec audio capture from Scarlett 2i2 verified working via Electron main process.

---

## Phase 2: Metering & Analysis

### 2.1 Validate LUFS Metering Against EBU R128
**Status:** Pending
**Priority:** Medium

**Tasks:**
- [ ] Test with EBU R128 reference tones (-23 LUFS)
- [ ] Verify K-weighting filter coefficients
- [ ] Validate 400ms momentary window
- [ ] Validate 3s short-term window
- [ ] Test gated integrated measurement
- [ ] Compare against reference meter (if available)

**Files:** `src/audio/LUFSMeter.ts`

### 2.2 Add Waterfall/Spectrogram to BassDetailPanel
**Status:** Pending
**Priority:** Medium

**Tasks:**
- [ ] Implement circular buffer for history
- [ ] Add WebGL texture-based spectrogram rendering
- [ ] Color mapping (amplitude to color)
- [ ] Configurable time window (1-10 seconds)

**Files:** `src/components/panels/BassDetailPanel.svelte`

### 2.3 Port IndustryVoiceDetector
**Status:** Pending
**Priority:** Medium

Port vocal detection from OMEGA for highlighting voice frequencies (200Hz-4kHz).

**Features:**
- Vocal presence indicator
- Formant frequency detection
- Speech vs singing classification

**Files:** `src/audio/VoiceDetector.ts` (new)

### 2.4 Add BPM Detection and Beat Grid
**Status:** Pending
**Priority:** Low

**Tasks:**
- [ ] Port GrooveAnalyzer from OMEGA
- [ ] Onset detection for kick/snare
- [ ] Tempo estimation (60-200 BPM range)
- [ ] Beat grid visualization overlay

**Files:** `src/audio/GrooveAnalyzer.ts` (new)

---

## Phase 3: UI/UX Polish

### 3.1 Keyboard Shortcuts
**Status:** Pending
**Priority:** Medium

| Key | Action |
|-----|--------|
| ESC | Exit/close |
| F | Toggle fullscreen |
| D | Toggle debug panel |
| S | Take screenshot |
| 1-6 | Window size presets |
| Space | Pause/resume |

**Files:** `src/App.svelte`, `electron/main.ts`

### 3.2 Fix Accessibility Warnings
**Status:** Pending
**Priority:** Low

Add aria-labels to icon-only buttons in Header and Sidebar components.

**Files:**
- `src/components/layout/Header.svelte`
- `src/components/layout/Sidebar.svelte`

### 3.3 Smooth Peak Hold Decay Animation
**Status:** Pending
**Priority:** Low

Improve peak hold indicator animation with configurable:
- Hold time (default: 1000ms)
- Decay rate (default: exponential)
- Visual style (line vs dot)

**Files:** `src/audio/SpectrumAnalyzer.ts`, `src/rendering/renderers/SpectrumRenderer.ts`

---

## Phase 4: Testing & Production

### 4.1 Create Vitest Test Suite
**Status:** Pending
**Priority:** Medium

**Test Coverage:**
- [ ] SpectrumAnalyzer: bin mapping, compensation, normalization
- [ ] LUFSMeter: K-weighting, window calculations
- [ ] TruePeakDetector: oversampling, peak detection
- [ ] MultiResolutionFFT: frequency merging

**Files:** `src/__tests__/` (new directory)

### 4.2 Build Production Electron Package
**Status:** Pending
**Priority:** High (for deployment)

**Tasks:**
- [ ] Configure electron-builder for Linux
- [ ] Create AppImage package
- [ ] Create .deb package
- [ ] Test on clean Ubuntu 24.04 install
- [ ] Document installation process

**Files:** `package.json`, `electron-builder.yml` (new)

---

## Technical Specifications

### Audio Processing Pipeline
```
parec (48kHz, stereo)
  → Electron Main Process
  → IPC to Renderer
  → Web Worker (FFT)
  → SpectrumAnalyzer
  → WebGL Renderer
```

### FFT Parameters
- Sample Rate: 48000 Hz
- FFT Size: 4096 (85ms window)
- Bin Width: 11.72 Hz
- Frequency Range: 20 Hz - 20 kHz
- Bar Count: 512 (logarithmic distribution)

### Display Specifications
- Target FPS: 60
- Dynamic Range: 60 dB (-70 to -10 dB normalized)
- Color Gradient: Rainbow (bass=red → highs=purple)

---

## Reference Documents

- OMEGA Python Implementation: `legacy/v1_v3_analyzers/live_audio_analyzer_professional_v4_OMEGA-2.py`
- Production v3 Visualizer: `production/spectrum_analyzers/spectrum_visualizer_v3_production.py`
- EBU R128 Loudness Standard: https://tech.ebu.ch/docs/r/r128.pdf

---

## Changelog

### 2025-12-19
- Initial development plan created
- Completed FFT binning debug session
- Fixed BassDetailPanel and DebugPanel data binding
- Implemented dB-domain frequency compensation
- Verified Scarlett 2i2 audio capture working
