# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AUDIO_PRIME is a professional real-time audio spectrum analyzer built with Electron 35, Svelte 5, TypeScript, and WebGL2/Canvas 2D. It features Hi-Res audio support (up to 192kHz), studio-quality metering (LUFS, VU, true peak), beat detection, voice analysis, MPRIS2 media player integration, and Spotify connectivity.

*Breaking audio into its prime components.*

## Build & Development Commands

```bash
npm run dev              # Start dev server with hot reload (Vite on :5173, Electron auto-connects)
npm run build            # Production build (tsc + vite build + electron-builder → AppImage + deb)
npm run electron:dev     # Launch Electron in dev mode only
npm run electron:build   # Build Electron distributables only

npm run lint             # ESLint on src/ and electron/
npm run lint:fix         # ESLint with auto-fix
npm run lint:security    # ESLint with security rules as errors
npm run format           # Prettier formatting
npm run type-check       # TypeScript validation (no emit)

npm run test             # Run Vitest suite
npm run test:ui          # Vitest with browser UI
```

Requires **Node.js 22 LTS** (install via nvm: `nvm install 22`).

## Architecture

### Process Separation
- **Electron Main** (`electron/main.ts`): IPC handlers, audio capture (`parec` subprocess with auto-reconnect), MPRIS2 D-Bus queries, Spotify OAuth with PKCE, window management, graceful shutdown coordination
- **Electron Preload** (`electron/preload.ts`): Context bridge exposing `window.electronAPI`
- **Renderer** (`src/`): Svelte 5 SPA with hybrid rendering (WebGL2 for spectrum, Canvas 2D for overlays)

### Audio Pipeline
```
System Audio → parec (native sample rate) → ArrayBuffer IPC → FFTWorker (Web Worker) → SpectrumAnalyzer → Svelte stores → Canvas @60fps
```

Audio data transfers use raw ArrayBuffer over IPC (zero-copy via structured clone) instead of Array conversion, which is critical for 192kHz performance.

### Key Source Locations
- `src/core/AudioEngine.ts` - Central audio coordination, dynamic sample rate management
- `src/audio/SpectrumAnalyzer.ts` - 4096-point FFT with frequency compensation
- `src/analysis/` - LUFSMeter (rate-aware K-weighting), BeatDetector (sub-harmonic correction), VoiceDetector, TruePeakDetector
- `src/rendering/renderers/SpectrumRenderer.ts` - WebGL2 instanced rendering for spectrum bars (60+ FPS)
- `src/components/` - Svelte 5 components organized by function:
  - `layout/` - AppShell, ErrorBoundary, Sidebar, Header
  - `panels/` - Main visualization panels (Spectrum, LUFS, BPM, Voice, Bass, etc.)
  - `meters/` - VU meters and metering components
  - `media/` - MPRIS2 media player panel with Hi-Res badge
  - `spotify/` - Spotify integration UI
  - `ui/` - Shared UI components (HiResBadge, PanelGearMenu)
- `src/stores/` - Reactive Svelte stores for spectrum, loudness, beatInfo, voiceInfo
- `electron/mpris/MprisService.ts` - MPRIS2 D-Bus media player integration
- `electron/audio/LinuxCapture.ts` - PulseAudio/PipeWire capture with auto-reconnect

### TypeScript Path Aliases
```
@/* → src/*
@core/* → src/core/*
@audio/* → src/audio/*
@analysis/* → src/analysis/*
@rendering/* → src/rendering/*
@components/* → src/components/*
@stores/* → src/stores/*
@utils/* → src/utils/*
```

## Testing

Tests are in `tests/` and `src/**/*.{test,spec}.ts`. Run single test file:
```bash
npx vitest run tests/analysis/BeatDetector.test.ts
npx vitest run tests/analysis/LUFSMeter.test.ts
```

**Known**: BeatDetector test "should increment beat count" is a pre-existing timing-dependent failure in the test harness (not a code bug).

## Audio Capture

### Linux
Requires PulseAudio or PipeWire with `parec`. The main process spawns `parec` at the detected sink sample rate (44.1kHz-192kHz) in stereo float32. LinuxCapture auto-detects the rate via `pactl list sinks` before starting capture. If parec exits unexpectedly, auto-reconnect with exponential backoff kicks in.

### Hi-Res Audio
For rates above 48kHz, PipeWire must be configured with `allowed-rates` and WirePlumber needs `api.alsa.multirate = true` on the output device. See docs/INSTALLATION.md for configuration details.

## MPRIS2 Media Player Integration

Queries any MPRIS2-compatible player (Strawberry, mpv, VLC, Firefox) via `dbus-send` for now-playing metadata, playback controls, and album art. No authentication required — purely local D-Bus.

## Spotify Integration

Requires `.env` with `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`. Uses OAuth PKCE flow with tokens stored in OS keyring via Electron's `safeStorage`.

## Security Considerations

- Electron context isolation enabled, nodeIntegration disabled in renderer
- CSP headers defined in `index.html`
- ESLint security plugins active (detect-eval, detect-child-process, no-secrets)
- OAuth tokens never logged or exposed to renderer
- Spotify credentials sanitized (newlines stripped) before writing to .env
- OAuth error parameter HTML-escaped to prevent XSS
- `security/detect-object-injection` disabled due to false positives with array indexing

## Build Outputs

- `dist/` - Web frontend SPA
- `dist-electron/` - Compiled Electron main/preload
- `release/` - Platform installers (AppImage, deb)
