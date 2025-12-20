# AUDIO_PRIME

> Professional Real-Time Audio Spectrum Analyzer & Visualizer

A modern, high-performance audio analysis application built with Electron, featuring studio-grade metering, advanced visualizations, and Spotify integration.

![Version](https://img.shields.io/badge/version-1.1.0-blue)
![Electron](https://img.shields.io/badge/electron-28+-green)
![TypeScript](https://img.shields.io/badge/typescript-5.0+-blue)
![Svelte](https://img.shields.io/badge/svelte-4+-orange)

---

## Features

### Spectrum Analysis
- **512-Bar Spectrum Analyzer** - Logarithmic frequency display from 20Hz to 20kHz
- **Enhanced Bass Detail** - Dedicated panel with optimized 20-500Hz resolution
- **Waterfall Spectrogram** - Time-frequency visualization with 60 FPS scrolling
- **Frequency Band Analysis** - Sub, Low, Mid, High, Presence, Air breakdown

### Professional Metering
- **LUFS Metering** - ITU-R BS.1770-4 compliant loudness measurement
  - Momentary (400ms)
  - Short-term (3s)
  - Integrated (gated)
  - True Peak detection
- **VU Meters** - Dual channel with peak hold indicators
- **BPM Detection** - Real-time tempo tracking with beat phase visualization

### Voice Analysis
- **Voice Activity Detection** - Real-time voice/no-voice classification
- **Voice Type Classification** - Singing vs. speech detection
- **Formant Tracking** - F1, F2, F3 frequency analysis
- **Pitch Detection** - Fundamental frequency estimation

### Spotify Integration
- **Now Playing** - Track, artist, album display with album art
- **Playback Controls** - Play/Pause, Previous, Next, Seek
- **OAuth Authentication** - Secure connection with token refresh

---

## Installation

### Prerequisites
- **Node.js** 18+ and npm
- **Linux** with PipeWire or PulseAudio
- **parec** command available (usually part of pulseaudio-utils)

### Setup
```bash
# Navigate to AUDIO_PRIME directory
cd AUDIO_PRIME

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

---

## Usage

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Start/Stop audio capture |
| `M` | Toggle mute |
| `F` | Toggle fullscreen |
| `D` | Toggle debug panel |
| `T` | Cycle color themes |
| `B` | Toggle beat flash effect |
| `1` | Window: 1280×720 |
| `2` | Window: 1600×900 |
| `3` | Window: 1920×1080 |
| `4` | Window: 2000×900 |
| `5` | Window: 2560×1080 |
| `6` | Window: 2560×1440 |

### Panel Toggles
Use the sidebar to show/hide:
- Spectrum Analyzer
- VU Meters
- Bass Detail & Waterfall
- LUFS Metering
- BPM/Tempo
- Voice Detection
- Debug Panel
- Spotify

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         AUDIO_PRIME                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    SPECTRUM ANALYZER                     │    │
│  │              512 bars • 20Hz-20kHz • Logarithmic        │    │
│  └─────────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────┐ │
│  │   VU L   │ │   VU R   │ │   LUFS   │ │   BPM    │ │ VOICE │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └───────┘ │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────┐ ┌─────────────────────────────────┐    │
│  │    BASS DETAIL      │ │          WATERFALL              │    │
│  │    20-500Hz         │ │       Time-Frequency            │    │
│  └─────────────────────┘ └─────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  🎵 SPOTIFY: Track Name • Artist • Album    ◀ ▶ ▶▶     │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Technical Details

### Audio Pipeline
1. **Capture**: `parec` subprocess captures system audio via PipeWire/PulseAudio
2. **Transport**: Raw PCM data streamed to Electron main process
3. **Processing**: FFT analysis in AudioEngine with multi-resolution support
4. **Rendering**: 60 FPS canvas rendering in Svelte components

### Performance
- **Frame Rate**: Stable 60 FPS
- **Audio Latency**: ~5ms end-to-end
- **FFT Processing**: ~1.5ms per frame
- **Memory Usage**: ~150MB typical

### Tech Stack
- **Electron** - Desktop application framework
- **Vite** - Build tool and dev server
- **TypeScript** - Type-safe development
- **Svelte** - Reactive UI components
- **Canvas 2D** - Hardware-accelerated rendering

---

## Spotify Setup

1. Create a Spotify Developer application at [developer.spotify.com](https://developer.spotify.com/dashboard)
2. Add `http://127.0.0.1:8888/callback` as a redirect URI
3. Update credentials in `src/config/spotify.ts`
4. Click "Connect to Spotify" in the app

**Required Scopes:**
- `user-read-currently-playing`
- `user-read-playback-state`
- `user-modify-playback-state`

---

## Development

### Project Structure
```
AUDIO_PRIME/
├── electron/           # Main process
│   ├── main.ts         # Electron entry, IPC handlers
│   └── preload.ts      # Context bridge
├── src/
│   ├── components/     # Svelte components
│   ├── core/           # AudioEngine, SpotifyService
│   ├── stores/         # Svelte stores
│   ├── types/          # TypeScript definitions
│   └── config/         # Configuration
├── docs/               # Documentation
│   └── DEVELOPMENT_PLAN.md
└── package.json
```

### Commands
```bash
npm run dev      # Start dev server with hot reload
npm run build    # Build for production
npm run preview  # Preview production build
npm run lint     # Run ESLint
```

---

## Roadmap

See [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md) for the full feature roadmap including:

- **Phase 1**: Quick wins (RMS, LRA, Crest Factor, Frequency Cursor)
- **Phase 2**: Stereo analysis (Correlation Meter, Goniometer, M/S Mode)
- **Phase 3**: Enhanced visualization (Oscilloscope, Octave Bands)
- **Phase 4**: Advanced analysis (Spectral Centroid, Harmonics, 3D Spectrogram)
- **Phase 5**: Pro features (Multi-track, Surround, Recording)

---

## License

MIT License - See LICENSE file for details.

---

## Acknowledgments

- [Electron](https://www.electronjs.org/)
- [Svelte](https://svelte.dev/)
- [Vite](https://vitejs.dev/)
- [Spotify Web API](https://developer.spotify.com/documentation/web-api)
- ITU-R BS.1770-4 (LUFS Standard)
- EBU R128 (Broadcast Loudness)
