# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AUDIO_PRIME is a professional real-time audio spectrum analyzer built with Electron 35, Svelte 5, TypeScript, and WebGL2/Canvas 2D. It features studio-quality metering (LUFS, VU, true peak), beat detection, voice analysis, and Spotify integration.

## Build & Development Commands

```bash
npm run dev              # Start dev server with hot reload (Vite on :5173, Electron auto-connects)
npm run build            # Production build (tsc + vite build + electron-builder)
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

## Architecture

### Process Separation
- **Electron Main** (`electron/main.ts`): IPC handlers, audio capture (Linux: `parec` subprocess, macOS: CoreAudio), Spotify OAuth with PKCE, window management
- **Electron Preload** (`electron/preload.ts`): Context bridge exposing `window.electronAPI`
- **Renderer** (`src/`): Svelte 5 SPA with hybrid rendering (WebGL2 for spectrum, Canvas 2D for overlays)

### Audio Pipeline
```
System Audio → parec subprocess → IPC → FFTWorker (Web Worker) → SpectrumAnalyzer → Svelte stores → Canvas @60fps
```

### Key Source Locations
- `src/core/AudioEngine.ts` - Central audio coordination and data distribution
- `src/audio/SpectrumAnalyzer.ts` - 4096-point FFT with frequency compensation
- `src/analysis/` - LUFSMeter, BeatDetector, VoiceDetector, TruePeakDetector
- `src/rendering/renderers/SpectrumRenderer.ts` - WebGL2 instanced rendering for spectrum bars (60+ FPS)
- `src/components/` - Svelte 5 components organized by function:
  - `layout/` - AppShell, ErrorBoundary
  - `panels/` - Main visualization panels (Spectrum, LUFS, BPM, Voice, Bass, etc.)
  - `meters/` - VU meters and metering components
  - `spotify/` - Spotify integration UI
- `src/stores/` - Reactive Svelte stores for spectrum, loudness, beatInfo, voiceInfo

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

## Audio Capture

### Linux
Requires PulseAudio or PipeWire with `parec`. The main process spawns `parec` with selected monitor device at 48kHz stereo float32.

### macOS
Uses CoreAudio API via native Node.js addon for low-latency system audio capture at 48kHz stereo float32.

## Spotify Integration

Requires `.env` with `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`. Uses OAuth PKCE flow with tokens stored in OS keyring via Electron's `safeStorage`.

## Security Considerations

- Electron context isolation enabled, nodeIntegration disabled in renderer
- CSP headers defined in `index.html`
- ESLint security plugins active (detect-eval, detect-child-process, no-secrets)
- OAuth tokens never logged or exposed to renderer
- `security/detect-object-injection` disabled due to false positives with array indexing

## Build Outputs

- `dist/` - Web frontend SPA
- `dist-electron/` - Compiled Electron main/preload
- `release/` - Platform installers (AppImage, deb, rpm, dmg, NSIS)
