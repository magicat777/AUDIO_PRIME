# AUDIO_PRIME Installation Guide

**AUDIO_PRIME is a Linux-only application.**

## System Requirements

### Minimum Requirements
- **OS**: Ubuntu 20.04+ / Debian 11+ / Fedora 35+
- **CPU**: Dual-core 2.0 GHz
- **RAM**: 4 GB
- **Display**: 1280x720 resolution
- **Audio**: PulseAudio or PipeWire with `parec` command

### Recommended Requirements
- **OS**: Ubuntu 24.04+ / Fedora 40+
- **CPU**: Quad-core 2.5 GHz+
- **RAM**: 8 GB
- **Display**: 1920x1080 or higher
- **Audio**: PipeWire with WirePlumber (required for Hi-Res audio)
- **Audio Interface**: USB DAC supporting 96kHz/192kHz (e.g., Focusrite Scarlett 2i2)

---

## Installation Methods

### AppImage (Universal - Recommended)

The AppImage works on most Linux distributions without installation.

1. Download the latest `.AppImage` file from [Releases](https://github.com/magicat777/AUDIO_PRIME/releases)
2. Make it executable:
   ```bash
   chmod +x AUDIO_PRIME-*.AppImage
   ```
3. Run the application:
   ```bash
   ./AUDIO_PRIME-*.AppImage
   ```

### Debian/Ubuntu (.deb)

For Ubuntu, Debian, Pop!_OS, Linux Mint, and derivatives.

1. Download the latest `.deb` file from [Releases](https://github.com/magicat777/AUDIO_PRIME/releases)
2. Install using dpkg:
   ```bash
   sudo dpkg -i AUDIO_PRIME-*.deb
   ```
3. Fix any dependency issues:
   ```bash
   sudo apt-get install -f
   ```
4. Launch from the application menu or run:
   ```bash
   audio-prime
   ```

### Fedora/RHEL (.rpm)

For Fedora, RHEL, CentOS, openSUSE, and derivatives.

1. Download the latest `.rpm` file from [Releases](https://github.com/magicat777/AUDIO_PRIME/releases)
2. Install using dnf:
   ```bash
   sudo dnf install AUDIO_PRIME-*.rpm
   ```
3. Launch from the application menu or run:
   ```bash
   audio-prime
   ```

---

## Audio Setup

### Verify PulseAudio/PipeWire

AUDIO_PRIME uses `parec` to capture system audio. Verify it's available:

```bash
which parec
```

If not found, install PulseAudio utilities:

```bash
# Ubuntu/Debian
sudo apt install pulseaudio-utils

# Fedora
sudo dnf install pulseaudio-utils
```

### Audio Group Permissions

Ensure your user is in the `audio` group:

```bash
sudo usermod -a -G audio $USER
```

Log out and back in for the change to take effect.

### Selecting Audio Source

1. Launch AUDIO_PRIME
2. Click the audio device dropdown in the header
3. Select a "Monitor" source to capture system audio output
4. Select an "Input" source to capture microphone input

**Tip:** Monitor sources with "Running" state are currently playing audio.

---

## Spotify Integration Setup

AUDIO_PRIME includes optional Spotify integration. See the [User Guide](USER_GUIDE.md#spotify-integration) for detailed setup instructions.

**Quick Setup:**

1. Create a Spotify Developer app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Add `http://127.0.0.1:8888/callback` as a Redirect URI
3. Create `~/.config/audio-prime/.env`:
   ```
   SPOTIFY_CLIENT_ID=your_client_id_here
   SPOTIFY_CLIENT_SECRET=your_client_secret_here
   ```
4. Restart AUDIO_PRIME and click "Connect to Spotify"

---

## Build from Source

### Prerequisites
- Node.js 22 LTS (install via nvm: `nvm install 22`)
- npm 9+
- Git
- PulseAudio or PipeWire

### Build Steps

```bash
# Clone the repository
git clone https://github.com/magicat777/AUDIO_PRIME.git
cd AUDIO_PRIME

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build
```

Production builds are output to the `release/` directory.

---

## Uninstallation

### AppImage
Simply delete the AppImage file.

### Debian/Ubuntu
```bash
sudo apt remove audio-prime
```

### Fedora/RHEL
```bash
sudo dnf remove audio-prime
```

### Configuration Files
To remove user configuration:
```bash
rm -rf ~/.config/audio-prime
```

---

## Hi-Res Audio Configuration (Optional)

AUDIO_PRIME supports capture at native device sample rates up to 192kHz. To enable Hi-Res audio:

### 1. PipeWire — Allow High Sample Rates

Create `~/.config/pipewire/pipewire.conf.d/10-hidef-audio.conf`:
```conf
context.properties = {
    default.clock.rate = 48000
    default.clock.allowed-rates = [ 44100 48000 88200 96000 176400 192000 ]
    default.clock.quantum = 256
    default.clock.min-quantum = 64
    default.clock.max-quantum = 2048
}
```

### 2. WirePlumber — Enable Dynamic Rate Switching

Create `~/.config/wireplumber/wireplumber.conf.d/50-hidef-device.conf` (replace the `node.name` match with your audio device):
```conf
monitor.alsa.rules = [
  {
    matches = [
      { node.name = "~alsa_output.usb-*" }
    ]
    actions = {
      update-props = {
        api.alsa.multirate = true
        api.alsa.period-size = 256
        api.alsa.period-num = 4
      }
    }
  }
]
```

### 3. Restart PipeWire
```bash
systemctl --user restart wireplumber pipewire pipewire-pulse
```

### 4. Verify
Play a Hi-Res file (e.g., 192kHz FLAC via Strawberry) and check the AUDIO_PRIME debug panel — Stream Rate and Device Rate should both show the native rate with "No (native)" resampling.

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues and solutions.
