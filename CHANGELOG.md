# Changelog

All notable changes to AUDIO_PRIME will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
