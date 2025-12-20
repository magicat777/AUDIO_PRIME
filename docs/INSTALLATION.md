# AUDIO_PRIME Installation Guide

## System Requirements

### Minimum Requirements
- **OS**: Ubuntu 20.04+ / Debian 11+ / macOS 12+
- **CPU**: Dual-core 2.0 GHz
- **RAM**: 4 GB
- **Display**: 1280x720 resolution

### Recommended Requirements
- **OS**: Ubuntu 22.04+ / macOS 13+
- **CPU**: Quad-core 2.5 GHz+
- **RAM**: 8 GB
- **Display**: 1920x1080 or higher
- **Audio**: PulseAudio or PipeWire (Linux)

---

## Linux Installation

### AppImage (Universal)

1. Download the latest `.AppImage` file from the releases page
2. Make it executable:
   ```bash
   chmod +x AUDIO_PRIME-*.AppImage
   ```
3. Run the application:
   ```bash
   ./AUDIO_PRIME-*.AppImage
   ```

### Debian/Ubuntu (.deb)

1. Download the latest `.deb` file from the releases page
2. Install using dpkg:
   ```bash
   sudo dpkg -i audio-prime_*.deb
   ```
3. Fix any dependency issues:
   ```bash
   sudo apt-get install -f
   ```
4. Launch from the application menu or run:
   ```bash
   audio-prime
   ```

### Audio Permissions (Linux)

AUDIO_PRIME requires access to system audio. Ensure your user is in the `audio` group:

```bash
sudo usermod -a -G audio $USER
```

Log out and back in for the change to take effect.

---

## macOS Installation

### DMG Installation

1. Download the latest `.dmg` file from the releases page
2. Open the DMG file
3. Drag AUDIO_PRIME to your Applications folder
4. First launch: Right-click the app and select "Open" to bypass Gatekeeper

### Microphone/Audio Permissions

On first launch, macOS will request permission to access audio input. Grant this permission in:
**System Preferences > Security & Privacy > Privacy > Microphone**

---

## Spotify Integration Setup

AUDIO_PRIME includes optional Spotify integration for Now Playing display.

### Prerequisites
- Spotify Premium account (required for playback control)
- Spotify Developer application credentials

### Configuration

1. Create a Spotify Developer application at https://developer.spotify.com/dashboard
2. Add `http://127.0.0.1:8888/callback` to your Redirect URIs
3. Create a `.env` file in the AUDIO_PRIME directory:
   ```
   SPOTIFY_CLIENT_ID=your_client_id_here
   SPOTIFY_CLIENT_SECRET=your_client_secret_here
   ```
4. Restart AUDIO_PRIME
5. Click "Connect to Spotify" in the Spotify panel

---

## Development Setup

### Prerequisites
- Node.js 18+
- npm 9+
- Git

### Build from Source

```bash
# Clone the repository
git clone https://github.com/magicat777/live-audio-analyzer.git
cd live-audio-analyzer/AUDIO_PRIME

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build
```

---

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues and solutions.
