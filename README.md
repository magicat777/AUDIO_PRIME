# AUDIO_PRIME

> Professional Real-Time Audio Spectrum Analyzer & Visualizer for Linux

A modern, high-performance audio analysis application built with Electron + Svelte 5, featuring studio-grade metering, advanced visualizations, and Spotify integration.

![Version](https://img.shields.io/badge/version-1.1.0-blue)
![Platform](https://img.shields.io/badge/platform-Linux-orange)
![Electron](https://img.shields.io/badge/electron-35+-green)
![TypeScript](https://img.shields.io/badge/typescript-5.7+-blue)
![Svelte](https://img.shields.io/badge/svelte-5+-orange)
![License](https://img.shields.io/badge/license-MIT-green)

---

<p align="center">
  <img src="audio_prime_layout_all.png" alt="AUDIO_PRIME Screenshot" width="900">
  <br>
  <em>Full application layout with spectrum analyzer, LUFS metering, BPM detection, voice analysis, and Spotify integration</em>
</p>

---

## Platform Support

**AUDIO_PRIME is a Linux-only application.**

| Platform | Status | Reason |
|----------|--------|--------|
| Linux | ✅ Supported | Native PulseAudio/PipeWire access via `parec` |
| macOS | ❌ Not Supported | Chromium limits system audio to mono only |
| Windows | ❌ Not Supported | No viable system audio capture path in Electron |

### Why Linux Only?

Professional audio analysis requires **stereo capture** for features like the goniometer, stereo correlation, and M/S metering. After extensive development effort, we found:

- **Linux**: Direct access to PulseAudio/PipeWire via `parec` subprocess provides full stereo audio capture outside of Chromium's sandbox.

- **macOS**: Apple's ScreenCaptureKit API supports stereo, but Chromium's `getDisplayMedia()` implementation only returns mono audio. Native Swift subprocesses can't inherit TCC (screen recording) permissions. A proper fix would require a native Node.js addon—significant complexity for uncertain results.

- **Windows**: Similar limitations exist with WASAPI loopback capture in Electron's sandboxed environment.

For cross-platform pro audio applications, native development (Swift/C++) is the appropriate choice. Electron excels for many use cases, but system audio capture for professional analysis isn't one of them.

---

## Features

### Spectrum Analysis
- **512-Bar Spectrum Analyzer** - Logarithmic frequency display from 20Hz to 20kHz
- **Enhanced Bass Detail** - Dedicated panel with optimized 20-500Hz resolution
- **Waterfall Spectrogram** - Time-frequency visualization with 60 FPS scrolling
- **Frequency Band Analysis** - Sub, Low, Mid, High, Presence, Air breakdown
- **Multi-Resolution FFT** - Adaptive resolution for optimal frequency/time tradeoff

### Professional Metering
- **LUFS Metering** - ITU-R BS.1770-4 compliant loudness measurement
  - Momentary (400ms)
  - Short-term (3s)
  - Integrated (gated)
  - True Peak detection (4x oversampling)
- **VU Meters** - Dual channel with peak hold indicators
- **BPM Detection** - Real-time tempo tracking with beat phase visualization

### Voice Analysis
- **Voice Activity Detection** - Real-time voice/no-voice classification
- **Voice Type Classification** - Singing vs. speech detection
- **Formant Tracking** - F1-F4 frequency analysis
- **Vibrato Detection** - 4.5-8.5 Hz modulation tracking
- **Pitch Detection** - Fundamental frequency estimation

### Stereo Analysis
- **Goniometer** - Lissajous stereo field display
- **Correlation Meter** - Phase relationship (-1 to +1)
- **M/S Metering** - Mid/Side level analysis
- **Oscilloscope** - Waveform display with auto-gain

### Spotify Integration
- **Now Playing** - Track, artist, album display with album art
- **Playback Controls** - Play/Pause, Previous, Next, Seek
- **OAuth Authentication** - Secure PKCE flow with encrypted token storage

---

## Installation

### Download (Recommended)

Download the latest release:
- **AppImage** - Universal Linux (recommended)
- **.deb** - Ubuntu, Debian, Pop!_OS, Linux Mint
- **.rpm** - Fedora, RHEL, CentOS, openSUSE

See [Releases](https://github.com/magicat777/AUDIO_PRIME/releases)

### System Requirements

- **OS**: Linux (Ubuntu 20.04+, Fedora 35+, or equivalent)
- **Audio**: PipeWire or PulseAudio with `parec` command
- **Display**: 1920x1080 or higher recommended

### Build from Source

```bash
# Prerequisites: Node.js 18+ and npm

# Clone repository
git clone https://github.com/magicat777/AUDIO_PRIME.git
cd AUDIO_PRIME

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

---

## Spotify Setup

Spotify integration requires you to create your own Spotify Developer application (free):

1. Create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Add `http://127.0.0.1:8888/callback` as a Redirect URI
3. Create `~/.config/audio-prime/.env`:
   ```
   SPOTIFY_CLIENT_ID=your_client_id_here
   SPOTIFY_CLIENT_SECRET=your_client_secret_here
   ```
4. Restart AUDIO_PRIME and click "Connect to Spotify"

See the [User Guide](docs/USER_GUIDE.md#spotify-integration) for detailed instructions.

**Note:** Spotify Premium is required for playback controls. Free accounts can view now-playing info.

---

## Usage

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Toggle mute |
| `M` | Toggle mute |
| `F` | Toggle fullscreen |
| `D` | Toggle debug panel |
| `T` | Reset tempo detection |
| `B` | Toggle bass waterfall |
| `1-6` | Window size presets |

### Panel Controls
Use the sidebar toggles to show/hide panels:
- Spectrum Analyzer
- VU Meters
- Bass Detail & Waterfall
- LUFS Metering
- BPM/Tempo
- Voice Detection
- Stereo Analysis
- Debug Panel
- Spotify

---

## Technical Details

### Audio Pipeline
1. **Capture**: `parec` subprocess captures system audio via PipeWire/PulseAudio
2. **Transport**: Raw PCM float32 data streamed to Electron main process
3. **Processing**: FFT analysis in AudioEngine with multi-resolution support
4. **Rendering**: 60 FPS canvas rendering in Svelte 5 components

### Performance
- **Frame Rate**: Stable 60 FPS
- **Audio Latency**: ~10ms end-to-end
- **FFT Processing**: ~1.5ms per frame
- **Memory Usage**: ~150MB typical

### Tech Stack
| Component | Technology |
|-----------|------------|
| Framework | Electron 35 |
| UI | Svelte 5 |
| Build | Vite 6 |
| Language | TypeScript 5.7 (strict mode) |
| Rendering | Canvas 2D |
| Audio | PulseAudio/PipeWire (parec) |
| Testing | Vitest |
| Linting | ESLint + Security plugins |

---

## Project Structure

```
AUDIO_PRIME/
├── electron/              # Main process
│   ├── main.ts            # Electron entry, IPC handlers, auto-updater
│   ├── preload.ts         # Context bridge
│   └── audio/             # Audio capture module
│       ├── AudioCapture.ts
│       ├── LinuxCapture.ts
│       ├── types.ts
│       └── index.ts
├── src/
│   ├── components/        # Svelte 5 components
│   │   ├── layout/        # AppShell, ErrorBoundary
│   │   ├── panels/        # Spectrum, LUFS, BPM, Voice, etc.
│   │   └── spotify/       # Spotify integration
│   ├── core/              # AudioEngine, PerformanceMonitor
│   ├── analysis/          # LUFSMeter, BeatDetector
│   ├── stores/            # Svelte stores
│   └── types/             # TypeScript definitions
├── tests/                 # Vitest test suites
├── docs/                  # Documentation
│   ├── USER_GUIDE.md      # Comprehensive user documentation
│   ├── INSTALLATION.md    # Installation instructions
│   └── TROUBLESHOOTING.md # Common issues & solutions
├── .github/workflows/     # CI/CD
│   └── security.yml       # Automated security scanning
├── CHANGELOG.md           # Version history
├── LICENSE                # MIT License
└── THIRD_PARTY_LICENSES.md
```

---

## Security

- ✅ Electron 35 with hardened security flags
- ✅ Content Security Policy (CSP)
- ✅ Context isolation & disabled node integration
- ✅ Encrypted token storage (safeStorage)
- ✅ Environment-based credential management
- ✅ ESLint security plugins
- ✅ Automated vulnerability scanning (CI/CD)

---

## Development

### Commands
```bash
npm run dev          # Start dev server with hot reload
npm run build        # Build for production
npm run test         # Run test suite
npm run lint         # Run ESLint
npm run type-check   # TypeScript validation
```

### Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

MIT License - See [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- [Electron](https://www.electronjs.org/)
- [Svelte](https://svelte.dev/)
- [Vite](https://vitejs.dev/)
- [PulseAudio](https://www.freedesktop.org/wiki/Software/PulseAudio/)
- [PipeWire](https://pipewire.org/)
- [Spotify Web API](https://developer.spotify.com/documentation/web-api)
- ITU-R BS.1770-4 (LUFS Standard)
- EBU R128 (Broadcast Loudness)
