# AUDIO_PRIME Troubleshooting Guide

## Audio Issues

### No Audio Input Detected

**Symptoms**: Spectrum analyzer shows no activity, all meters at minimum.

**Solutions**:

1. **Check audio source selection**
   - Click the audio source dropdown in the top bar
   - Select your system's monitor output (e.g., "Monitor of Built-in Audio")

2. **Verify audio is playing**
   - Ensure audio is actually playing from some application
   - Check system volume isn't muted

3. **Linux: Check PulseAudio/PipeWire**
   ```bash
   # List available audio sources
   pactl list sources short

   # Check if monitor sources exist
   pactl list sources | grep -A 2 "monitor"
   ```

4. **Linux: Restart audio daemon**
   ```bash
   # PulseAudio
   pulseaudio -k && pulseaudio --start

   # PipeWire
   systemctl --user restart pipewire pipewire-pulse
   ```

### Audio Latency/Delay

**Symptoms**: Visualization lags behind actual audio.

**Solutions**:
- This is normal; Web Audio API introduces ~20-50ms latency
- Close other audio-intensive applications
- Reduce buffer size if available in audio settings

---

## Display Issues

### Low Frame Rate / Stuttering

**Symptoms**: Visualization is choppy, FPS below 60.

**Solutions**:

1. **Close unused panels**
   - Toggle off panels you don't need via sidebar
   - Waterfall spectrogram is most CPU-intensive

2. **Check GPU acceleration**
   - Ensure hardware acceleration is enabled
   - Update graphics drivers

3. **Reduce window size**
   - Use keyboard shortcuts 1-4 for smaller presets
   - 4K displays require more GPU power

### Panels Not Visible

**Symptoms**: Expected panels missing from layout.

**Solutions**:
1. Click the sidebar toggle buttons to show hidden panels
2. Reset layout: Delete `~/.config/audio-prime/` and restart

---

## Spotify Integration Issues

### "Connect to Spotify" Button Missing

**Cause**: Spotify credentials not configured.

**Solution**:
1. Create `.env` file in AUDIO_PRIME directory
2. Add your Spotify Developer credentials
3. Restart the application

### Authorization Failed

**Symptoms**: Error after clicking "Connect to Spotify".

**Solutions**:

1. **Check redirect URI**
   - Ensure `http://127.0.0.1:8888/callback` is added in Spotify Developer Dashboard
   - Note: Must be `http://` not `https://`

2. **Verify credentials**
   - Double-check CLIENT_ID and CLIENT_SECRET in `.env`
   - Regenerate secret if needed

3. **Check firewall**
   - Port 8888 must be available for OAuth callback

### Playback Controls Not Working

**Cause**: Spotify Free account (Premium required for playback control).

**Solution**: Upgrade to Spotify Premium for playback control features.

---

## Application Issues

### Application Won't Start

**Solutions**:

1. **Linux: Check dependencies**
   ```bash
   ldd /path/to/audio-prime | grep "not found"
   ```

2. **Clear cache and settings**
   ```bash
   rm -rf ~/.config/audio-prime
   ```

3. **Check logs**
   ```bash
   ./AUDIO_PRIME-*.AppImage --enable-logging
   ```

### High Memory Usage

**Symptoms**: Memory usage grows over time (potential leak).

**Solutions**:
1. Check memory trend indicator in Debug panel
2. Disable waterfall spectrogram if not needed
3. Report issue with memory stats if trend shows "warning"

### Crash on Startup

**Solutions**:

1. **Run from terminal to see error messages**
   ```bash
   ./AUDIO_PRIME-*.AppImage
   ```

2. **Check for conflicting audio devices**
   ```bash
   pactl list sources
   ```

3. **Try with audio disabled**
   - Useful to isolate audio-related crashes

---

## macOS-Specific Issues

### "App is damaged" Error

**Cause**: Gatekeeper blocking unsigned app.

**Solution**:
```bash
xattr -cr /Applications/AUDIO_PRIME.app
```

### No Audio Input Options

**Solution**:
1. Grant microphone permission in System Preferences
2. Install a virtual audio device like BlackHole for system audio capture

---

## Reporting Bugs

If you encounter an issue not covered here:

1. Check the Debug panel for diagnostic information
2. Note your OS version and audio setup
3. Capture any console errors (View > Toggle Developer Tools)
4. Open an issue at https://github.com/magicat777/live-audio-analyzer/issues
