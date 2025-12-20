# AUDIO_PRIME User Guide

## Professional Real-Time Audio Analysis & Visualization

**Version 1.0** | **Technical Reference for Audio Professionals**

---

## Table of Contents

1. [Overview](#overview)
2. [Spectrum Analyzer Panel](#spectrum-analyzer-panel)
3. [Bass Detail Panel](#bass-detail-panel)
4. [VU Meters Panel](#vu-meters-panel)
5. [Loudness Metering (LUFS) Panel](#loudness-metering-lufs-panel)
6. [BPM/Tempo Detection Panel](#bpmtempo-detection-panel)
7. [Voice Detection Panel](#voice-detection-panel)
8. [Stereo Analysis Panels](#stereo-analysis-panels)
9. [Debug Panel](#debug-panel)
10. [Spotify Integration](#spotify-integration)
11. [Technical Specifications](#technical-specifications)
12. [Keyboard Shortcuts](#keyboard-shortcuts)

---

## Overview

AUDIO_PRIME is a professional-grade real-time audio spectrum analyzer and metering application designed for audio engineers, musicians, and broadcast professionals. Built with WebGL2 for high-performance rendering, it provides accurate, standards-compliant audio analysis at 60 frames per second.

### Core Capabilities

| Feature | Description |
|---------|-------------|
| **Spectrum Analysis** | 512-bar logarithmic display, 20Hz-20kHz |
| **Loudness Metering** | ITU-R BS.1770-4 compliant LUFS measurement |
| **True Peak Detection** | 4x oversampled inter-sample peak detection |
| **Beat Detection** | Real-time BPM estimation with phase tracking |
| **Voice Detection** | Vocal classification with vibrato analysis |
| **Stereo Analysis** | Goniometer, correlation, and M/S metering |

### Audio Pipeline

```
System Audio → Web Audio API → FFT Analysis → Processing Pipeline → Display
              (48kHz stereo)    (4096-point)   (8-stage)           (60fps)
```

---

## Spectrum Analyzer Panel

The main spectrum display provides a comprehensive view of the audio frequency content from 20Hz to 20kHz.

### Display Elements

#### Spectrum Bars (512 bars)

The spectrum is divided into 512 vertical bars distributed logarithmically across the frequency range. This logarithmic distribution matches human pitch perception, where each octave occupies equal visual space.

**Frequency Mapping Formula:**
```
frequency = 20 × (20000/20)^(bar/511)
```

This means:
- Bars 0-170: 20Hz - 200Hz (3.3 octaves, bass frequencies)
- Bars 171-341: 200Hz - 2kHz (3.3 octaves, midrange)
- Bars 342-511: 2kHz - 20kHz (3.3 octaves, high frequencies)

**Why 512 bars?** This provides sufficient resolution to distinguish individual musical notes in the bass range while maintaining smooth visual continuity across the spectrum. With 512 bars over 10 octaves, each bar represents approximately 1/51 of an octave (about 23 cents), finer than the typical 50-cent just-noticeable difference for pitch.

#### Amplitude Scale (dB)

The vertical axis displays amplitude in decibels (dB), ranging from -60dB to 0dB.

**Normalization:**
```
displayHeight = (dB + 60) / 60
```

Where:
- 0dB = Full scale (maximum digital level)
- -60dB = Noise floor / minimum display threshold
- -70dB internal floor for calculations (prevents -Infinity)

**Why -60dB floor?** This provides approximately 10 bits of dynamic range visibility, sufficient to show the full dynamic range of most musical content while filtering out very low-level noise.

#### Frequency Grid Lines

Vertical grid lines mark standard frequency reference points:

| Frequency | Musical Significance |
|-----------|---------------------|
| 50 Hz | Typical bass fundamental |
| 100 Hz | Upper bass fundamental range |
| 200 Hz | Low-mid transition |
| 500 Hz | Vocal fundamental range |
| 1 kHz | Reference frequency |
| 2 kHz | Speech consonant range |
| 5 kHz | Presence/clarity |
| 10 kHz | Brilliance/air |

#### Peak Hold Indicators

White horizontal markers show the maximum level reached at each frequency. These help identify the highest peaks in the audio, useful for:
- Detecting resonances
- Identifying the loudest frequency components
- Tracking transient peaks that may cause clipping

**Peak Behavior:**
- Hold time: 1000ms (1 second)
- Decay rate: 0.003 per frame after hold expires
- Visual: 2px white markers above bar tops

#### Interactive Frequency Cursor

Hovering over the spectrum displays:
- Current frequency in Hz (below 1kHz) or kHz (above 1kHz)
- Amplitude in dB at that frequency

### Signal Processing Pipeline

The spectrum analyzer employs an 8-stage processing pipeline to convert raw FFT data into a perceptually accurate display:

#### Stage 1: Weighted Bin Sampling

Raw FFT bins are mapped to display bars using triangular-weighted averaging. For each bar, multiple FFT bins are sampled with decreasing weight away from the center frequency.

**Why triangular weighting?** This provides smooth interpolation between bins while emphasizing the energy at the target frequency, reducing spectral leakage artifacts.

#### Stage 2: Decibel Conversion

Linear magnitude values are converted to logarithmic decibels:
```
dB = 20 × log10(magnitude)
```

This matches human loudness perception, which is approximately logarithmic.

#### Stage 3: Frequency Compensation

Raw FFT data is compensated for the inherent spectral tilt in most audio:

**Low frequencies (below 1kHz):**
```
compensation = (log2(1000) - log2(freq)) × -1.5 dB/octave
```

**High frequencies (above 1kHz):**
```
compensation = (log2(freq) - log2(1000)) × 2.5 dB/octave
```

**Why frequency compensation?** Pink noise (equal energy per octave) is the reference standard for audio measurement. Without compensation, the display would show pink noise as a -3dB/octave slope rather than flat.

#### Stage 4: Psychoacoustic Emphasis

Additional emphasis is applied to frequency ranges of musical significance:

| Frequency Range | Boost | Rationale |
|-----------------|-------|-----------|
| 20-60 Hz (Sub-bass) | +1.2 dB | Enhance subsonic content visibility |
| 55-100 Hz (Kick) | +1.9 dB | Emphasize kick drum fundamental |
| 80-200 Hz (Bass body) | +2.6 dB | Highlight bass instrument tone |
| 180-400 Hz (Voice fundamental) | +2.3 dB | Emphasize vocal fundamentals |
| 300-800 Hz (Instrument body) | +2.6 dB | Highlight mid-range instruments |
| 1-3 kHz (Voice clarity) | +2.6 dB | Presence region visibility |
| 3-6 kHz (Presence) | +2.9 dB | Critical speech intelligibility range |
| 8-12 kHz (Air) | +1.2 dB | Subtle high-frequency enhancement |

#### Stage 5: Normalization

Values are normalized to 0-1 range for display:
```
normalized = (dB - (-70)) / ((-10) - (-70))
normalized = clamp(normalized, 0, 1)
```

#### Stage 6: Gap-Filling Interpolation

Low-frequency gaps (where FFT bins don't align with display bars) are smoothed:

**Detection:** A bar is considered a "gap" if:
```
currentValue < neighborAverage × 0.15 AND neighborAverage > 0.05
```

**Correction:**
```
correctedValue = originalValue × 0.4 + interpolatedValue × 0.6
```

#### Stage 7: Fractional-Octave Smoothing

Professional RTA-standard 1/6-octave smoothing is applied:

- Window: ±1/12 octave around each bar
- Weighting: Triangular (1.0 at center, 0.5 at edges)

**Why 1/6 octave?** This matches professional real-time analyzers (RTAs) and provides the ideal balance between frequency resolution and smooth display. Finer resolution (1/12 or 1/24 octave) would show excessive detail; coarser (1/3 octave) would lose important features.

#### Stage 8: Temporal Smoothing

Attack and decay rates are frequency-dependent:

| Frequency Range | Attack | Decay |
|-----------------|--------|-------|
| Below 100 Hz | 0.90 | 0.10 |
| 100-500 Hz | 0.85 | 0.15 |
| 500 Hz - 3 kHz | 0.80 | 0.20 |
| Above 3 kHz | 0.75 | 0.25 |

**Why frequency-dependent timing?** Low frequencies have longer wavelengths and natural energy sustain. High frequencies are more transient. This timing matches the natural behavior of audio content.

### FFT Mode Toggle

Two FFT analysis modes are available:

**STD (Standard):** Single 4096-point FFT
- Frequency resolution: 11.7 Hz (48000/4096)
- Best for: General-purpose analysis

**MR (Multi-Resolution):** Hybrid multi-resolution FFT
- Sub-bass (20-60Hz): 8192-point FFT (5.86 Hz resolution)
- Bass (60-250Hz): 4096-point FFT (11.7 Hz resolution)
- Low-mid (250-1kHz): 2048-point FFT (23.4 Hz resolution)
- Mid (1-4kHz): 2048-point FFT (23.4 Hz resolution)
- High (4-20kHz): 1024-point FFT (46.9 Hz resolution)

**Why multi-resolution?** Low frequencies benefit from finer resolution to distinguish individual notes. High frequencies need faster temporal response more than fine frequency resolution.

---

## Bass Detail Panel

The bass detail panel provides enhanced visualization of low-frequency content (20-200Hz), critical for monitoring bass instruments, kick drums, and sub-bass content.

### Display Elements

#### Bass Spectrum Graph

A filled area graph showing bass frequency content with:
- Purple gradient fill (brighter at top, fading to bottom)
- 2px purple stroke outline
- Logarithmic frequency scale matching main spectrum

**Frequency Grid Lines:** 20, 30, 40, 50, 60, 80, 100, 120, 150, 200 Hz

**dB Grid Lines:** -60, -48, -36, -24, -12, 0 dB

#### Waterfall Spectrogram (Optional)

A time-frequency display showing bass content history:

**History Depth:** 150 frames (~2.5 seconds at 60fps)

**Color Mapping (Heat Map):**

| Magnitude | Color | Interpretation |
|-----------|-------|----------------|
| 0.0 - 0.1 | Dark blue | Very quiet |
| 0.1 - 0.3 | Blue → Cyan | Low level |
| 0.3 - 0.5 | Cyan → Green | Moderate |
| 0.5 - 0.7 | Green → Yellow | Strong |
| 0.7 - 0.9 | Yellow → Red | Loud |
| 0.9 - 1.0 | Red → White | Peak |

**Why a waterfall display?** Bass frequencies have longer decay times and interact with room acoustics. The waterfall shows temporal patterns like:
- Kick drum decay characteristics
- Bass note sustain and release
- Low-frequency buildup or resonances

### Performance Optimization

The waterfall uses an optimized rendering technique:
1. Canvas content is scrolled down by 1 line height
2. Only the new top row is drawn using ImageData
3. Pre-computed 256-entry color lookup table (LUT) eliminates per-pixel calculations

This achieves O(n) complexity per frame rather than O(n×m) for full redraw.

---

## VU Meters Panel

Traditional VU (Volume Unit) meters with peak hold, modeled after analog meter ballistics.

### Display Elements

#### Left and Right Channel Meters

Horizontal bar meters showing:
- Current RMS level (main bar)
- Peak hold indicator (white marker)
- Color-coded level zones

**Color Zones:**
| Range | Color | Meaning |
|-------|-------|---------|
| -60 to -6 dB | Green | Safe operating range |
| -6 to -3 dB | Yellow | Approaching peak |
| -3 to 0 dB | Red | Near clipping |

#### Peak Hold Behavior

- **Hold time:** 1.5 seconds
- **Decay rate:** 0.05 dB/frame after hold expires

**Why 1.5 second hold?** This allows operators to observe peak levels without them disappearing too quickly, while still providing timely feedback for mixing decisions.

#### VU Ballistics

The meters simulate traditional VU meter behavior:

- **Attack time:** 10ms (300ms to reach 99% of sudden change)
- **Release time:** 300ms (smooth decay)

**Formula:**
```
smoothed = previous × coefficient + current × (1 - coefficient)
```

Where coefficient is derived from the time constant and sample rate.

**Why VU ballistics?** VU meters were designed to approximate human loudness perception. The 300ms integration time roughly corresponds to how we perceive sustained loudness.

### Statistics Display

#### RMS Levels

Root Mean Square levels for each channel in dB. RMS better represents perceived loudness than peak levels.

```
RMS = sqrt(mean(samples²))
RMS_dB = 20 × log10(RMS)
```

#### Crest Factor

The difference between peak and RMS levels:

```
Crest Factor = Peak_dB - RMS_dB
```

| Crest Factor | Interpretation |
|--------------|----------------|
| 3-6 dB | Heavily compressed |
| 6-12 dB | Moderately dynamic |
| 12-20+ dB | Very dynamic (classical, acoustic) |

**Color Coding:**
- Orange: < 6 dB (compressed)
- Yellow: 6-12 dB (moderate)
- Green: > 12 dB (dynamic)

---

## Loudness Metering (LUFS) Panel

Standards-compliant loudness metering following ITU-R BS.1770-4 and EBU R 128.

### Measurement Types

#### Momentary Loudness (M)

- **Integration time:** 400ms sliding window
- **Update rate:** Every frame (60fps)
- **Use:** Real-time loudness monitoring

#### Short-Term Loudness (S)

- **Integration time:** 3 seconds sliding window
- **Update rate:** Every frame
- **Use:** Phrase-level loudness monitoring

#### Integrated Loudness (I)

- **Integration:** Gated over entire program
- **Gating:** Two-stage (absolute + relative)
- **Use:** Overall program loudness measurement

**Gating Algorithm:**
1. **Absolute gate:** Discard blocks below -70 LUFS
2. **Relative gate:** Discard blocks below (ungated mean - 10 LU)

This prevents silence and quiet passages from artificially lowering the integrated loudness.

### Technical Implementation

#### K-Weighting Filter

The ITU-R BS.1770 K-weighting filter applies two stages:

**Stage 1: Pre-filter (High-shelf boost)**
- Boost: +4 dB at high frequencies
- Models head-related transfer function

**Stage 2: RLB Filter (High-pass)**
- Revised low-frequency B-weighting
- Attenuates frequencies below 100 Hz

**Filter Coefficients (48kHz):**
```
Pre-filter:
  b = [1.53512485958697, -2.69169618940638, 1.19839281085285]
  a = [1.0, -1.69065929318241, 0.73248077421585]

RLB:
  b = [1.0, -2.0, 1.0]
  a = [1.0, -1.99004745483398, 0.99007225036621]
```

#### Loudness Calculation

```
Loudness (LUFS) = -0.691 + 10 × log10(meanSquare)
```

Where meanSquare is the K-weighted power averaged over the integration window.

### Display Elements

#### Target Markers

| Target | Standard | Use Case |
|--------|----------|----------|
| -23 LUFS | EBU R 128 | European broadcast |
| -14 LUFS | Spotify, YouTube | Streaming platforms |

#### Loudness Range (LRA)

The statistical distribution of loudness over time, measured in Loudness Units (LU):

```
LRA = loudness_high - loudness_low
```

Where high and low are the 95th and 10th percentiles of short-term loudness.

| LRA | Interpretation |
|-----|----------------|
| < 5 LU | Very compressed |
| 5-10 LU | Moderate dynamics |
| > 10 LU | Wide dynamic range |

#### True Peak (dBTP)

Inter-sample peak detection using 4x oversampling to detect peaks between samples that would cause clipping in DAC reconstruction.

**Implementation:**
- 4 polyphase filters at 0°, 90°, 180°, 270° phase offsets
- 12-tap FIR filter per phase
- Peak hold: 1 second
- Release: Exponential decay over 2 seconds

**Why 4x oversampling?** Nyquist theory guarantees that 4x oversampling can reconstruct the true analog waveform with sufficient accuracy to detect inter-sample peaks within 0.1 dB.

---

## BPM/Tempo Detection Panel

Real-time beat and tempo detection using spectral flux onset detection and autocorrelation.

### Display Elements

#### BPM Value

Large numeric display of current tempo estimate in beats per minute.

**Range:** 60-180 BPM (extended to 30-240 via octave detection)

#### Beat Indicator

Animated circular indicator that flashes on detected beats:
- 40px diameter with rotating ring
- Green flash on downbeat (beat 1)
- Standard flash on other beats
- 100ms flash duration

#### Beat Phase Meter

Progress bar showing position within the current beat (0-100%):
- 0% = Beat just occurred
- 50% = Halfway to next beat
- 100% = Next beat imminent

#### Confidence Indicator

How certain the algorithm is about the tempo:

| Confidence | Color | Meaning |
|------------|-------|---------|
| > 70% | Green | Stable tempo lock |
| 40-70% | Yellow | Moderate confidence |
| < 40% | Orange | Low confidence |

#### TAP Button

Manual tempo input by tapping. The algorithm averages tap intervals to determine tempo.

### Technical Implementation

#### Onset Detection

Spectral flux is computed from the difference between consecutive spectra:

```
onset = sum(max(0, spectrum[i] - prevSpectrum[i]) × weight[i])
```

**Frequency Band Weights:**
| Band | Range | Weight | Rationale |
|------|-------|--------|-----------|
| Kick | 60-150 Hz | 2.0 | Strong beat indicator |
| Snare | 150-300 Hz | 1.2 | Secondary beat marker |
| Hi-hat | 3-10 kHz | 0.6 | Subdivision marker |

#### Tempo Estimation

Autocorrelation of onset signal over ~4 seconds:
1. Compute onset detection function
2. Apply autocorrelation: R(lag) = sum(onset[i] × onset[i + lag])
3. Find peaks in autocorrelation within BPM range
4. Convert lag to BPM: `BPM = 60000 / (lag × frameTime)`

#### Octave Error Correction

Tempo detection often produces double or half the actual tempo. Correction is applied by:
1. Checking for strong correlation at 2× and 0.5× detected tempo
2. Preferring tempos in the "natural" 80-140 BPM range
3. Maintaining tempo history to resist sudden octave jumps

#### Beat Phase Tracking

Once tempo is established, phase is tracked continuously:
```
phase = (currentTime % beatInterval) / beatInterval
```

With gradual phase correction when detected beats drift from predictions.

---

## Voice Detection Panel

Real-time vocal detection and classification using spectral analysis and modulation detection.

### Display Elements

#### Classification Box

Large central display showing current classification:

| Label | Meaning |
|-------|---------|
| SINGING | Sustained vocal with vibrato |
| SPEECH | Spoken word detected |
| VOICE | Generic vocal content |
| INSTR | Instrumental (no voice) |

#### Confidence Meter

Full-width progress bar showing detection confidence (0-100%):

| Confidence | Color | Meaning |
|------------|-------|---------|
| > 70% | Green | High confidence |
| 40-70% | Yellow | Moderate |
| 20-40% | Orange | Low confidence |
| < 20% | Muted | Not detected |

#### Pitch Display

Estimated fundamental frequency of detected voice in Hz.
- Range: 85-500 Hz (typical vocal range)
- Shows "---" when no voice detected

#### Vibrato Indicator

When voice-like vibrato is detected:
- Rate: Frequency of pitch modulation (typically 5-7 Hz)
- Highlighted in accent color when active

**Why is vibrato important?** Vibrato (5-8 Hz frequency modulation) is a strong differentiator between singing and instruments. Guitar solos, even in the voice frequency range, typically lack this modulation pattern.

#### Pitch Stability

Percentage indicating how stable the pitch is over time:
- High stability (>80%): Sustained notes, likely guitar
- Moderate stability (40-70%): Typical singing
- Low stability (<40%): Speech or noise

#### Spectral Centroid

The "center of mass" of the spectrum in the voice range (Hz).
- 300-800 Hz: Typical speech
- 400-2000 Hz: Typical singing
- Higher values may indicate instruments

#### Formants (F1-F4)

Detected resonant peaks characteristic of vocal production:

| Formant | Typical Range | Significance |
|---------|---------------|--------------|
| F1 | 200-900 Hz | Vowel openness |
| F2 | 700-2500 Hz | Front/back position |
| F3 | 2000-3500 Hz | Individual voice character |
| F4 | 3000-4500 Hz | Speaker identity |

### Technical Implementation

#### Voice Frequency Analysis

Voice content is identified by analyzing the 80-5000 Hz range:

1. **Voice energy ratio:** Energy in voice band / total energy
2. **Mid-voice energy:** Focus on 200-3000 Hz (most characteristic)
3. **Bass ratio:** Energy below 80 Hz (instruments have more)

#### Formant Detection

Peaks are detected in the 200-4000 Hz range:
```
isPeak = spectrum[i] > spectrum[i-1] AND
         spectrum[i] > spectrum[i+1] AND
         spectrum[i] > meanLevel × 1.5
```

#### Vibrato Detection

Pitch history is analyzed for periodic modulation:

1. Track pitch over 500ms (30 frames at 60fps)
2. Convert to cents deviation from mean: `cents = 1200 × log2(pitch/meanPitch)`
3. Count zero-crossings in deviation signal
4. Calculate modulation rate: `rate = zeroCrossings / 2 / timeSpan`

**Detection criteria:**
- Rate: 4.5-8.5 Hz
- Depth: > 15 cents (peak-to-peak)

#### Classification Logic

```
IF vibrato detected AND formants >= 2:
    SINGING
ELSE IF pitch stability > 0.8 AND no vibrato:
    INSTRUMENTAL (likely guitar)
ELSE IF formants >= 3 AND centroid 400-2000 Hz:
    SINGING
ELSE IF centroid 300-800 Hz AND low pitch stability:
    SPEECH
ELSE IF confidence >= 40%:
    VOICE (generic)
ELSE:
    INSTRUMENTAL
```

---

## Stereo Analysis Panels

Three panels for comprehensive stereo field analysis.

### Goniometer Panel

A Lissajous-style display showing the stereo field relationship.

#### Display

180×180 pixel canvas with:
- Vertical axis: Mid (mono) signal (L+R)
- Horizontal axis: Side signal (R-L)
- 45° diagonals: Pure L and pure R

#### Transform

```
X = (R - L) / √2
Y = (L + R) / √2
```

This rotates the L/R plane by 45° to show mono content vertically.

#### Visual Interpretation

| Pattern | Meaning |
|---------|---------|
| Vertical line | Mono (L = R) |
| Circle | 90° phase difference |
| Horizontal line | Out of phase (L = -R) |
| Ellipse tilted right | Right-heavy stereo |
| Ellipse tilted left | Left-heavy stereo |
| Wide ellipse | Wide stereo image |

#### Persistence

94% phosphor decay per frame creates trail effect, showing stereo movement over time.

### Stereo Correlation Panel

Measures phase relationship between channels.

#### Correlation Meter

Horizontal bar from -1 to +1:
- **+1:** Perfect mono (in-phase)
- **0:** Uncorrelated (typical stereo)
- **-1:** Out of phase (phase cancellation)

**Calculation:**
```
correlation = sum(L × R) / sqrt(sum(L²) × sum(R²))
```

#### Status Labels

| Value | Label | Meaning |
|-------|-------|---------|
| > 0.9 | MONO | Essentially mono |
| 0.5 - 0.9 | CORR | Correlated stereo |
| 0 - 0.5 | WIDE | Wide stereo |
| -0.5 - 0 | DIFF | Decorrelated |
| < -0.5 | OUT | Phase issues |

#### Stereo Width

Percentage display of stereo spread:
```
width = 1 - abs(correlation)
```
- 0%: Pure mono
- 100%: Maximum stereo separation

#### Balance

Indicator showing left/right energy distribution:
- C (center): Balanced
- L xx: Left-heavy by xx%
- R xx: Right-heavy by xx%

#### M/S Levels

Mid and Side channel levels in dB:
- **Mid:** (L + R) / 2 - Mono content
- **Side:** (L - R) / 2 - Stereo difference

**Use:** Comparing M and S levels shows the mono compatibility of the mix.

### Oscilloscope Panel

Waveform display with auto-scaling.

#### Display

400×180 pixel canvas showing mono waveform (L+R average).

#### Features

- **Auto-gain:** 1-50× amplification for quiet signals
  - Attack: 100µs (fast response to peaks)
  - Release: 20µs (smooth decay)
  - Target amplitude: 70% of display height

- **Trigger:** Zero-crossing detection stabilizes display
  - Trigger level indicator (yellow dashed line)

- **Grid:** 8 time divisions × 4 amplitude divisions

#### Scale Indicators

- +1 / -1: Amplitude limits
- ms/div: Time scale per division
- ×N: Current auto-gain factor (when > 1.5×)

---

## Debug Panel

Comprehensive diagnostic display for troubleshooting and detailed analysis.

### Sections

#### Signal Status

- Active/inactive indicator
- Update latency (ms)
- Dominant frequency

#### Levels

- Left/Right/Peak in dB

#### LUFS

- Momentary, Short-term, True Peak

#### Beat Detection

- BPM (highlighted)
- Confidence, beat count, phase
- Band energies (Kick, Snare, Hi-Hat)
- Onset history statistics

#### Frequency Bands

Seven-band analysis with peak hold:

| Band | Range |
|------|-------|
| Sub-Bass | 20-60 Hz |
| Bass | 60-250 Hz |
| Low-Mid | 250-500 Hz |
| Mid | 500-2 kHz |
| Upper-Mid | 2-4 kHz |
| Presence | 4-6 kHz |
| Brilliance | 6-20 kHz |

---

## Spotify Integration

Optional Spotify Web API integration for now-playing display.

### Features

- Album artwork (64×64)
- Track, artist, album information
- Playback controls (previous, play/pause, next)
- Progress bar with seek capability
- Play state indicator

### Setup

Click "Connect to Spotify" to initiate OAuth2 authorization. Requires Spotify Premium account for playback control.

---

## Technical Specifications

| Specification | Value |
|---------------|-------|
| Sample Rate | 48,000 Hz |
| FFT Size (Standard) | 4,096 points |
| FFT Size (Multi-Res) | 1,024 - 8,192 points |
| Frequency Resolution | 11.7 Hz (standard) |
| Spectrum Bars | 512 logarithmic |
| Frequency Range | 20 Hz - 20,000 Hz |
| Display Refresh | 60 fps |
| Peak Hold Time | 1,000 ms |
| RTA Smoothing | 1/6 octave |
| LUFS Gate (Absolute) | -70 LUFS |
| LUFS Gate (Relative) | -10 LU |
| True Peak Oversampling | 4× |
| Vibrato Detection Range | 4.5 - 8.5 Hz |
| BPM Detection Range | 60 - 180 BPM |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Space | Toggle audio mute |
| M | Toggle mute |
| F | Toggle fullscreen |
| D | Toggle debug panel |
| T | Reset tempo detection |
| B | Toggle bass detail waterfall |
| 1-6 | Quick window size presets |

---

## Standards Compliance

AUDIO_PRIME implements analysis methods compliant with:

- **ITU-R BS.1770-4:** Loudness measurement
- **ITU-R BS.1771-1:** Loudness range (LRA)
- **EBU R 128:** Broadcast loudness recommendation
- **EBU Tech 3341:** Loudness metering
- **EBU Tech 3342:** Loudness range
- **AES17:** Peak measurement (true peak methodology)

---

*AUDIO_PRIME - Professional Audio Analysis*

*Document Version 1.0*
