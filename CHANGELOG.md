# Changelog

All notable changes to AUDIO_PRIME will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-03-27

### Added
- **MPRIS2 Media Player panel** — integrates with Strawberry, mpv, VLC, and any MPRIS2-compatible player via D-Bus. Shows album art, track info, playback controls, and bitrate.
- **Hi-Res Audio badge** — displays the official Hi-Res Audio logo with live sample rate/bit depth when playing content above 44.1kHz
- **Dynamic sample rate detection** — captures audio at the device's native rate (44.1k-192kHz) instead of hardcoded 48kHz. Automatically reinitializes FFT workers, LUFS meter, spectrum analyzers, and beat detector when rate changes.
- **Preset import/export** — save presets as JSON files and import on other machines via native file dialogs
- **Module visibility file-based persistence** — panel show/hide state survives across installations
- **Auto-reconnect on parec crash** — exponential backoff (500ms-30s, max 10 attempts) with automatic recovery
- **WebGL context loss recovery** — SpectrumPanel and 3D visualizations auto-reinitialize on GPU context loss
- **Graceful shutdown coordination** — renderer flushes state, main process confirms writes before quit
- **Live PipeWire debug metrics** — quantum, processing times (busy/wait), pipeline latency, resampling detection, output device info via pw-top
- **Audio source scoring** — debug panel prefers music/media streams over system sounds (speech-dispatcher)
- **New app icon** — spectrum bars with green-to-red gradient, all sizes (16-1024px)
- **Distributable packages** — builds AppImage and deb via `npm run build`

### Fixed
- **BPM octave error drift** — sub-harmonic detection penalizes half-tempo peaks in autocorrelation; locked-reference correction prevents median drift; dead-zone coverage for 2/3 and 3/2 tempo ratios
- **IPC performance at 192kHz** — replaced `Array.from(Float32Array)` with raw ArrayBuffer transfer (zero-copy). Previous approach caused 1 FPS at high sample rates.
- **Preset persistence** — debounced file writes lost on app close; startup race condition between file and localStorage; reset wiping saved presets
- **Panel lock/unlock scaling** — unlock now reverses the scale conversion that lock applied
- **Frequency bands panel freezing** — removed CSS transitions conflicting with 60fps store-driven updates
- **VU meter peak hold** — split shared timer into per-channel L/R timers
- **FFT worker memory leak** — terminate old workers before creating new ones on mode switch
- **AppShell subscription leak** — capture and clean up audioEngine.state subscription in onDestroy
- **Header subscription leaks** — add onDestroy cleanup for store subscriptions
- **NaN/Infinity guards** — protect LUFSMeter K-weighting filters and BeatDetector BPM calculation
- **LinuxCapture spawn error** — handle parec not found / permission denied with proper error callback
- **Spotify credential injection** — sanitize newlines before writing to .env file
- **OAuth XSS** — HTML-escape error parameter in callback response
- **Dialog null guard** — check mainWindow not destroyed before opening file dialogs

### Changed
- **LUFSMeter K-weighting** — pre-computed filter coefficients for all standard rates (44.1k, 48k, 88.2k, 96k, 176.4k, 192kHz) per ITU-R BS.1770-4
- **Node.js 22 LTS** required (was 18)
- **Vitest v3** — resolves dual esbuild version conflict that caused EPIPE crashes on 3D renderer files
- **Correlation window** increased to 256 samples for more reliable BPM detection
- **Confidence smoothing** — faster rise (0.15), lower lock threshold (0.55) for quicker BPM lock
- **Tempo update interval** — 500ms (was 750ms) for faster initial detection

## [1.2.0] - 2024-12-28

### Added
- 3D visualizations: Cylindrical Bars, Waterfall 3D, Frequency Sphere, Stereo Space, Tunnel, Terrain
- Panel gear menu system with per-panel settings
- OCTA display mode (overlapping L/R octave analyzer)
- Selectable FFT resolution (512, 1024, 2048, 4096)

## [1.1.0] - 2024-12-20

### Security
- **Phase 1**: Upgraded Electron to v35.7.5, added ESLint security plugins, hardened CSP
- **Phase 2**: Moved Spotify credentials to environment variables, enabled TypeScript strict mode, added CI security workflow
- **Phase 3**: Enhanced Spotify API compliance, sanitized error logging, added Spotify attribution
- **Phase 4**: Added global exception handlers, ErrorBoundary component, memory leak detection

### Added
- Global error boundary for graceful UI error recovery
- Memory leak detection in PerformanceMonitor (tracks 60-second history)
- Environment variable configuration for Spotify credentials
- GitHub Actions security workflow for automated scanning
- Content Security Policy (CSP) for renderer process

### Changed
- Spotify credentials now loaded from `.env` file instead of hardcoded
- Enhanced TypeScript compiler options (noImplicitReturns, noPropertyAccessFromIndexSignature)
- Sanitized error logging to prevent sensitive data exposure

## [1.0.0] - 2024-12-15

### Added
- Real-time 512-bar logarithmic spectrum analyzer (20Hz-20kHz)
- ITU-R BS.1770-4 compliant LUFS metering (Momentary, Short-term, Integrated)
- True Peak detection with 4x oversampling
- BPM/tempo detection with beat phase tracking
- Voice detection with singing/speech classification
- Vibrato detection (4.5-8.5 Hz range)
- Formant analysis (F1-F4)
- Stereo analysis panels:
  - Goniometer (Lissajous display)
  - Stereo correlation meter
  - Oscilloscope with auto-gain
- Bass detail panel with waterfall spectrogram
- VU meters with peak hold
- Frequency bands panel with 7-band analysis
- Spotify Web API integration:
  - Now Playing display with album artwork
  - Playback controls (play/pause, next, previous)
  - Progress bar with seek capability
- Draggable/resizable panel layout system
- Dynamic audio source discovery (PulseAudio/PipeWire)
- Debug panel with comprehensive diagnostics
- Keyboard shortcuts (Space, M, F, D, T, B, 1-6)
- Fullscreen mode support

### Technical
- Electron 35 + Vite 6 + Svelte 5 + TypeScript
- WebGL2 rendering for high-performance visualization
- 4096-point FFT (standard) with multi-resolution option
- 60 FPS rendering with optimized waterfall scrolling
- 1/6-octave RTA smoothing
- Frequency-dependent temporal smoothing

## [0.9.0] - 2024-12-10

### Added
- Initial beta release
- Core spectrum analyzer functionality
- Basic LUFS metering
- Panel layout system

---

[1.1.0]: https://github.com/magicat777/live-audio-analyzer/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/magicat777/live-audio-analyzer/releases/tag/v1.0.0
[0.9.0]: https://github.com/magicat777/live-audio-analyzer/releases/tag/v0.9.0
