# AUDIO_PRIME Development Plan

> Professional Audio Spectrum Analyzer & Visualizer
> Built with Electron + Vite + TypeScript + Svelte

---

## Current Version: 1.1.0

**Last Updated:** December 2024

---

## Completed Features

### Core Audio Analysis
- [x] **512-Bar Spectrum Analyzer** - Logarithmic frequency display (20Hz-20kHz)
- [x] **Multi-Resolution FFT** - Optimized bin allocation for bass detail
- [x] **Real-Time Processing** - 60 FPS with PipeWire/PulseAudio integration
- [x] **Audio Device Selection** - Dynamic device enumeration and switching

### Metering & Measurement
- [x] **LUFS Metering** - ITU-R BS.1770-4 compliant
  - Momentary (400ms window)
  - Short-term (3s window)
  - Integrated (gated)
  - True Peak with visual indicators
- [x] **VU Meters** - Dual channel with peak hold
- [x] **BPM Detection** - Real-time tempo estimation with beat phase visualization

### Visualization Panels
- [x] **Spectrum Panel** - Main frequency analyzer with scale overlay
- [x] **Bass Detail Panel** - Enhanced 20-500Hz view with waterfall spectrogram
- [x] **Waterfall Spectrogram** - Time-frequency display with optimized scrolling
- [x] **Debug Panel** - Frequency band analysis (Sub/Low/Mid/High/Presence/Air)

### Voice Analysis
- [x] **Voice Detection** - Real-time voice activity detection
- [x] **Voice Classification** - Singing vs. speech detection
- [x] **Formant Analysis** - F1/F2/F3 tracking
- [x] **Pitch Detection** - Fundamental frequency estimation

### Spotify Integration (v1.1.0)
- [x] **OAuth 2.0 with PKCE** - Secure authentication flow
- [x] **Now Playing Display** - Track, artist, album with album art
- [x] **Playback Controls** - Play/Pause, Previous, Next
- [x] **Seekable Progress Bar** - Click-to-seek with smooth animation
- [x] **Token Persistence** - Auto-refresh with secure storage

### UI/UX
- [x] **Modular Panel System** - Toggle visibility via sidebar
- [x] **LocalStorage Persistence** - Remember panel states
- [x] **Keyboard Shortcuts**
  - `Space` - Toggle audio capture
  - `M` - Toggle mute
  - `F` - Toggle fullscreen
  - `D` - Toggle debug panel
  - `T` - Cycle color themes
  - `B` - Toggle beat flash
  - `1-6` - Window size presets
- [x] **Responsive Layout** - Adapts to window size

---

## Development Roadmap

### Phase 1: Quick Wins (1-2 hours each)

| Priority | Feature | Description | Status |
|----------|---------|-------------|--------|
| 1.1 | **RMS Level Display** | Add RMS alongside peak in VU meters | Planned |
| 1.2 | **Loudness Range (LRA)** | Show dynamic range from LUFS data | Planned |
| 1.3 | **Crest Factor Display** | Peak-to-RMS ratio indicator | Planned |
| 1.4 | **Frequency Cursor** | Hover to show exact Hz + dB value | Planned |
| 1.5 | **Peak Hold Lines** | Persistent peak markers on spectrum | Planned |
| 1.6 | **A-Weighting Toggle** | Apply A-weighting curve to spectrum | Planned |
| 1.7 | **Spectrum Fill Modes** | Solid fill, gradient, outline options | Planned |
| 1.8 | **Color Themes/Presets** | VU green, rainbow, heat, etc. | Planned |

### Phase 2: Stereo Analysis (2-4 hours each)

| Priority | Feature | Description | Status |
|----------|---------|-------------|--------|
| 2.1 | **Stereo Correlation Meter** | Phase coherence indicator (-1 to +1) | Planned |
| 2.2 | **Goniometer/Vectorscope** | X-Y stereo field display (Lissajous) | Planned |
| 2.3 | **Mid/Side Mode** | Switch spectrum to M/S instead of L/R | Planned |
| 2.4 | **Stereo Width Meter** | Visual indicator of stereo spread | Planned |

### Phase 3: Enhanced Visualization (2-4 hours each)

| Priority | Feature | Description | Status |
|----------|---------|-------------|--------|
| 3.1 | **Oscilloscope Display** | Real-time waveform view | Planned |
| 3.2 | **1/3 Octave Bands** | ISO standard 31-band display | Planned |
| 3.3 | **Frequency Band Meters** | Sub/Low/Mid/High/Air horizontal bars | Planned |
| 3.4 | **Full-Range Spectrogram** | Time-frequency waterfall for full spectrum | Planned |
| 3.5 | **Spectrum Freeze/Compare** | Capture and overlay reference spectrum | Planned |
| 3.6 | **K-System Metering** | K-12, K-14, K-20 loudness scales | Planned |

### Phase 4: Advanced Analysis (4-8 hours each)

| Priority | Feature | Description | Status |
|----------|---------|-------------|--------|
| 4.1 | **Spectral Centroid Display** | "Brightness" indicator | Planned |
| 4.2 | **Harmonic Analysis** | Identify fundamental + harmonics | Planned |
| 4.3 | **Dynamics Histogram** | Distribution of loudness values over time | Planned |
| 4.4 | **Inter-Sample Peak Detection** | True peak with 4x oversampling | Planned |
| 4.5 | **3D Spectrogram** | WebGL frequency × time × amplitude | Planned |
| 4.6 | **EQ Match Curve** | Show difference between two sources | Planned |
| 4.7 | **Export Measurements** | CSV/JSON export of analysis data | Planned |
| 4.8 | **Session Recording** | Record analysis data over time | Planned |

### Phase 5: Advanced Features (8+ hours each)

| Priority | Feature | Description | Status |
|----------|---------|-------------|--------|
| 5.1 | **Multi-Track Comparison** | Analyze multiple audio sources | Planned |
| 5.2 | **Surround Sound Support** | 5.1/7.1 channel metering | Planned |
| 5.3 | **Audio Recording** | Record system audio to file | Planned |
| 5.4 | **Plugin Hosting (VST)** | Load VST plugins for processing | Planned |
| 5.5 | **AI-Powered Analysis** | Genre detection, quality scoring | Planned |

---

## Technical Architecture

### Directory Structure
```
AUDIO_PRIME/
├── electron/
│   ├── main.ts              # Electron main process
│   └── preload.ts           # IPC bridge
├── src/
│   ├── components/
│   │   ├── layout/          # AppShell, Sidebar, Header
│   │   ├── panels/          # SpectrumPanel, BassDetailPanel, DebugPanel
│   │   ├── meters/          # LUFSMeterPanel, BPMPanel, VoicePanel
│   │   └── spotify/         # SpotifyPanel
│   ├── core/
│   │   ├── AudioEngine.ts   # FFT processing, audio capture
│   │   └── SpotifyService.ts # Spotify API integration
│   ├── stores/
│   │   └── moduleVisibility.ts # Panel toggle state
│   ├── types/
│   │   ├── global.d.ts      # Electron API types
│   │   └── spotify.d.ts     # Spotify types
│   └── config/
│       └── spotify.ts       # Spotify OAuth config
├── index.html
├── package.json
└── vite.config.ts
```

### Data Flow
```
PipeWire/PulseAudio
    ↓
Electron Main Process (parec subprocess)
    ↓
IPC Channel (audio:data)
    ↓
AudioEngine.ts (FFT processing)
    ↓
Svelte Stores (reactive state)
    ↓
UI Components (canvas rendering)
```

### Key Technologies
- **Electron 28+** - Desktop application framework
- **Vite** - Fast build tool and dev server
- **TypeScript** - Type-safe JavaScript
- **Svelte** - Reactive UI components
- **Web Audio API** - Audio processing
- **Canvas 2D** - High-performance rendering

---

## Implementation Notes

### Adding a New Panel

1. Create component in `src/components/panels/NewPanel.svelte`
2. Add visibility flag to `src/stores/moduleVisibility.ts`
3. Import and render in `src/components/layout/AppShell.svelte`
4. Add toggle button in `src/components/layout/Sidebar.svelte`

### Adding Audio Features

1. Extend `AudioEngine.ts` with new analysis methods
2. Create derived store or add to existing stores
3. Subscribe in relevant components

### Adding Electron IPC

1. Add handler in `electron/main.ts`
2. Expose in `electron/preload.ts`
3. Add types to `src/types/global.d.ts`

---

## Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| Frame Rate | 60 FPS | 60 FPS |
| Audio Latency | <10ms | ~5ms |
| FFT Processing | <2ms | ~1.5ms |
| Memory Usage | <200MB | ~150MB |
| CPU Usage | <15% | ~10% |

---

## Contributing

When implementing new features:

1. Follow existing TypeScript patterns
2. Use Svelte stores for reactive state
3. Prefer canvas rendering for visualizations
4. Add keyboard shortcuts where appropriate
5. Ensure panel visibility is toggleable
6. Test with various audio sources

---

## References

### Professional Tools Analyzed
- [SIR Audio Tools SpectrumAnalyzer](https://www.siraudiotools.com/Spectrum-Analyzer.php)
- [Youlean Loudness Meter](https://youlean.co/youlean-loudness-meter/)
- [iZotope Insight 2](https://www.izotope.com/en/products/insight.html)
- [ToneBoosters GonioMeter](https://www.toneboosters.com/tb_goniometer_v1.html)
- [Blue Cat's Oscilloscope Multi](https://www.bluecataudio.com/Products/Product_OscilloscopeMulti/)

### Standards
- ITU-R BS.1770-4 (LUFS Measurement)
- EBU R128 (Broadcast Loudness)
- IEC 61260 (Octave Bands)
