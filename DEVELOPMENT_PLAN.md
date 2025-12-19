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
- [x] BassDetailPanel with waterfall spectrogram (optimized 60 FPS)
- [x] DebugPanel with frequency band analysis
- [x] VU meters (L/R channels)
- [x] LUFS metering (momentary, short-term, integrated)
- [x] True Peak detection
- [x] Scarlett 2i2 audio capture verified working
- [x] fft.js integration with pre-computed twiddle factors
- [x] MultiResolution FFT with 5-band analysis (STD/MR toggle)
- [x] Voice Detection with formants, pitch, classification
- [x] BPM/Tempo detection with beat phase visualization
- [x] Keyboard shortcuts (Space, M, F, D, T, B, 1-6, Esc)
- [x] Module visibility toggles with localStorage persistence

### Pending
- [ ] Build production Electron package
- [ ] LUFS validation against EBU R128 reference
- [ ] Accessibility improvements

---

## Phase 1: Core Audio Quality - COMPLETED

### 1.1 Fine-tune Frequency Compensation Curve
**Status:** COMPLETED
**Priority:** Critical

Implemented logarithmic dB-domain compensation:
- Reference: 1kHz = 0dB
- Below 1kHz: -1.5dB/octave
- Above 1kHz: +2.5dB/octave
- Additional rolloffs for sub-bass (<30Hz) and air (>14kHz)

**Files:** `src/audio/SpectrumAnalyzer.ts`

### 1.2 Replace Inline FFT Worker with fft.js
**Status:** COMPLETED
**Priority:** High

FFTWorker now uses fft.js library with pre-computed twiddle factors for ~2x speedup.

**Files:** `src/audio/workers/FFTWorker.ts`

### 1.3 Implement MultiResolutionFFT
**Status:** COMPLETED
**Priority:** High

Implemented 5-band multi-resolution analysis with STD/MR toggle in spectrum display:

| Band | Frequency Range | FFT Size |
|------|-----------------|----------|
| Sub-Bass | 20-60 Hz | 8192 |
| Bass | 60-250 Hz | 4096 |
| Low-Mid | 250-1000 Hz | 2048 |
| Mid | 1000-4000 Hz | 2048 |
| High | 4000-20000 Hz | 1024 |

**Files:** `src/audio/MultiResolutionSpectrumAnalyzer.ts`, `src/components/panels/SpectrumPanel.svelte`

### 1.4 Audio Capture Verification
**Status:** COMPLETED
**Priority:** High

Parec audio capture from Scarlett 2i2 verified working via Electron main process.

---

## Phase 2: Metering & Analysis - COMPLETED

### 2.1 Validate LUFS Metering Against EBU R128
**Status:** Pending (validation only)
**Priority:** Medium

Implementation complete, needs validation against reference tones.

**Tasks:**
- [ ] Test with EBU R128 reference tones (-23 LUFS)
- [ ] Compare against reference meter (if available)

**Files:** `src/analysis/LUFSMeter.ts`

### 2.2 Add Waterfall/Spectrogram to BassDetailPanel
**Status:** COMPLETED
**Priority:** Medium

Implemented optimized waterfall spectrogram:
- Canvas scrolling with `drawImage()` for O(n) updates
- Pre-computed 256-entry color LUT
- Reused ImageData buffer (no GC pressure)
- Maintains 60 FPS with all panels active
- Toggle via sidebar settings

**Files:** `src/components/panels/BassDetailPanel.svelte`

### 2.3 Port IndustryVoiceDetector
**Status:** COMPLETED
**Priority:** Medium

Implemented voice detection with:
- Vocal presence indicator (DETECTED/NONE)
- Classification (SINGING/SPEECH/VOICE)
- Formant frequency detection (F1-F4)
- Pitch estimation
- Spectral centroid
- Voice ratio
- Confidence percentage with color-coded meter

**Files:** `src/analysis/VoiceDetector.ts`, `src/components/meters/VoicePanel.svelte`

### 2.4 Add BPM Detection and Beat Grid
**Status:** COMPLETED
**Priority:** Low

Implemented BeatDetector with:
- Onset detection for kick/snare/hihat
- Tempo estimation (60-200 BPM range)
- Beat phase visualization (circular indicator)
- Beat strength meter
- Tap tempo support (T key)
- Silence detection (resets to 0 after 3s)

**Files:** `src/analysis/BeatDetector.ts`, `src/components/meters/BPMPanel.svelte`

---

## Phase 3: UI/UX Polish - MOSTLY COMPLETED

### 3.1 Keyboard Shortcuts
**Status:** COMPLETED
**Priority:** Medium

| Key | Action |
|-----|--------|
| Space | Start/Stop capture |
| M | Toggle sidebar menu |
| F | Toggle fullscreen |
| D | Toggle debug panel |
| T | Tap tempo |
| B | Reset beat detector |
| 1-6 | Window size presets |
| Esc | Close sidebar |

**Files:** `src/components/layout/AppShell.svelte`, `electron/main.ts`

### 3.2 Fix Accessibility Warnings
**Status:** Pending
**Priority:** Low

Add aria-labels to icon-only buttons in Header and Sidebar components.

**Files:**
- `src/components/layout/Header.svelte`
- `src/components/layout/Sidebar.svelte`

### 3.3 Peak Hold Decay Animation
**Status:** COMPLETED
**Priority:** Low

Implemented in DebugPanel with configurable:
- Hold time: 1500ms
- Decay rate: 15% per frame after hold expires
- Visual style: white line indicator

**Files:** `src/components/panels/DebugPanel.svelte`

---

## Phase 4: Testing & Production

### 4.1 Create Vitest Test Suite
**Status:** Partial
**Priority:** Medium

Basic test files exist for BeatDetector and LUFSMeter.

**Files:** `tests/analysis/`

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

## Phase 5: Additional Features & Nice-to-Haves

### 5.1 Screenshot Capture
**Status:** Pending
**Priority:** Low

Add ability to capture and save spectrum snapshots.

**Tasks:**
- [ ] Implement canvas-to-image export
- [ ] Add S keyboard shortcut
- [ ] Save to user's Pictures folder with timestamp

### 5.2 Audio Source Selector UI
**Status:** Pending
**Priority:** Medium

Enhance sidebar device selector with:
- [ ] Live preview of audio levels per device
- [ ] Favorite/recent devices
- [ ] Auto-reconnect on device change

### 5.3 Theme Customization
**Status:** Pending
**Priority:** Low

**Tasks:**
- [ ] Add color theme presets (dark, light, high contrast)
- [ ] Customizable spectrum gradient colors
- [ ] Save preferences to localStorage

### 5.4 Spectrum Overlay Options
**Status:** Pending
**Priority:** Low

**Tasks:**
- [ ] Musical note overlay (A4=440Hz reference)
- [ ] Frequency cursor with readout
- [ ] Configurable grid density

### 5.5 Recording/Export
**Status:** Pending
**Priority:** Low

**Tasks:**
- [ ] Record spectrum animation to video
- [ ] Export analysis data to CSV
- [ ] Session statistics summary

### 5.6 Presets for Different Use Cases
**Status:** Pending
**Priority:** Medium

**Tasks:**
- [ ] Music listening preset (full spectrum)
- [ ] Podcast/speech preset (voice-focused)
- [ ] DJ/mixing preset (bass-heavy)
- [ ] Mastering preset (LUFS focus)

### 5.7 Window Always-on-Top Option
**Status:** Pending
**Priority:** Low

Add toggle to keep visualizer window above other windows.

### 5.8 Mini Mode
**Status:** Pending
**Priority:** Low

Compact mode showing only spectrum and basic meters for minimal screen footprint.

---

## Technical Specifications

### Audio Processing Pipeline
```
parec (48kHz, stereo)
  → Electron Main Process
  → IPC to Renderer
  → Web Worker (FFT with fft.js)
  → SpectrumAnalyzer / MultiResolutionAnalyzer
  → WebGL Renderer
```

### FFT Parameters
- Sample Rate: 48000 Hz
- Standard FFT Size: 4096 (85ms window)
- Multi-Res FFT Sizes: 1024-8192 (band-specific)
- Bin Width: 11.72 Hz (standard)
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

### 2025-12-19 (Session 2)
- Added waterfall spectrogram to BassDetailPanel (optimized for 60 FPS)
- Ported VoiceDetector with formants, pitch, classification
- Restructured UI layout (Voice panel in meters row)
- Fixed Voice panel sizing and classification width
- Committed and pushed to GitHub

### 2025-12-19 (Session 1)
- Initial development plan created
- Completed FFT binning debug session
- Fixed BassDetailPanel and DebugPanel data binding
- Implemented dB-domain frequency compensation
- Verified Scarlett 2i2 audio capture working
- Implemented fft.js integration
- Implemented MultiResolution FFT analyzer
- Added BPM/tempo detection
- Added keyboard shortcuts
- Added module visibility toggles
