<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { audioEngine } from '../../core/AudioEngine';
  import type { AudioDevice } from '../../core/AudioEngine';
  import { moduleVisibility } from '../../stores/moduleVisibility';
  import { gridLayout, layoutPresets } from '../../stores/gridLayout';

  export let open = false;

  const dispatch = createEventDispatcher();

  let devices: AudioDevice[] = [];
  let selectedDeviceId: string | null = null;

  // Input gain control
  let inputGain = 1.0;
  audioEngine.inputGain.subscribe(value => {
    inputGain = value;
  });

  function handleGainChange(event: Event) {
    const target = event.target as HTMLInputElement;
    const newGain = parseFloat(target.value);
    audioEngine.setInputGain(newGain);
  }

  // Convert gain to dB for display
  function gainToDb(gain: number): string {
    if (gain === 0) return '-∞';
    const db = 20 * Math.log10(gain);
    return db >= 0 ? `+${db.toFixed(1)}` : db.toFixed(1);
  }

  // Accordion state for audio sources, modules, layout, presets, and spotify (collapsed by default)
  let monitorsExpanded = false;
  let inputsExpanded = false;
  let modulesExpanded = false;
  let layoutExpanded = false;
  let presetsExpanded = false;
  let spotifySettingsExpanded = false;

  // Spotify settings state
  let spotifyConfigured = false;
  let spotifyClientId = '';
  let spotifyClientSecret = '';
  let spotifyClientIdPreview = '';
  let spotifySaving = false;
  let spotifySaveError = '';
  let spotifySaveSuccess = false;

  // Load Spotify config on mount
  async function loadSpotifyConfig() {
    if (window.electronAPI?.spotify?.getConfig) {
      const config = await window.electronAPI.spotify.getConfig();
      spotifyConfigured = config.configured;
      spotifyClientIdPreview = config.clientIdPreview;
    }
  }

  // Save Spotify credentials
  async function saveSpotifyCredentials() {
    if (!spotifyClientId.trim() || !spotifyClientSecret.trim()) {
      spotifySaveError = 'Both Client ID and Client Secret are required';
      return;
    }

    spotifySaving = true;
    spotifySaveError = '';
    spotifySaveSuccess = false;

    try {
      const result = await window.electronAPI.spotify.saveConfig({
        clientId: spotifyClientId.trim(),
        clientSecret: spotifyClientSecret.trim(),
      });

      if (result.success) {
        spotifyConfigured = result.configured ?? false;
        spotifyClientIdPreview = spotifyClientId.substring(0, 8) + '...';
        spotifyClientId = '';
        spotifyClientSecret = '';
        spotifySaveSuccess = true;
        // Hide success message after 3 seconds
        setTimeout(() => { spotifySaveSuccess = false; }, 3000);
      } else {
        spotifySaveError = result.error || 'Failed to save credentials';
      }
    } catch (err) {
      spotifySaveError = String(err);
    } finally {
      spotifySaving = false;
    }
  }

  // Load config when sidebar opens (only on transition to open)
  let prevOpen = false;
  $: if (open && !prevOpen) {
    loadSpotifyConfig();
  }
  $: prevOpen = open;

  // Check if all panels are locked
  $: allLocked = Object.values($gridLayout.panels).every(p => p.locked);
  $: someLocked = Object.values($gridLayout.panels).some(p => p.locked);

  // Get visible panel IDs for auto-arrange
  $: visiblePanelIds = Object.entries($moduleVisibility)
    .filter(([key, visible]) => visible && key !== 'waterfall') // waterfall is part of bassDetail
    .map(([key]) => {
      // Map module visibility keys to panel IDs
      const mapping: Record<string, string> = {
        spectrum: 'spectrum',
        vuMeters: 'vuMeters',
        bassDetail: 'bassDetail',
        lufsMetering: 'lufsMetering',
        bpmTempo: 'bpmTempo',
        voiceDetection: 'voiceDetection',
        stereoCorrelation: 'stereoCorrelation',
        goniometer: 'goniometer',
        oscilloscope: 'oscilloscope',
        frequencyBands: 'frequencyBands',
        debug: 'debug',
        spotify: 'spotify',
      };
      return mapping[key];
    })
    .filter(Boolean) as string[];

  function handleAutoArrange() {
    gridLayout.autoArrange(visiblePanelIds);
  }

  // Preset management
  let newPresetName = '';
  let showSavePreset = false;

  function handleSavePreset() {
    if (newPresetName.trim() || $layoutPresets.length < 5) {
      gridLayout.savePreset(newPresetName);
      newPresetName = '';
      showSavePreset = false;
    }
  }

  function handleLoadPreset(index: number) {
    gridLayout.loadPreset(index);
  }

  function handleDeletePreset(index: number) {
    gridLayout.deletePreset(index);
  }

  // Split devices by type
  $: monitorDevices = devices.filter(d => d.type === 'monitor');
  $: inputDevices = devices.filter(d => d.type === 'input');

  // Refresh devices when sidebar opens
  $: if (open) {
    refreshDevices();
  }

  async function refreshDevices() {
    devices = audioEngine.getDevices();
  }

  audioEngine.state.subscribe((state) => {
    selectedDeviceId = state.currentDevice?.id || null;
  });

  async function selectDevice(device: AudioDevice) {
    await audioEngine.stop();
    await audioEngine.start(device);
  }

  function handleBackdropClick() {
    dispatch('close');
  }

  function toggleModule(module: 'spectrum' | 'vuMeters' | 'bassDetail' | 'waterfall' | 'lufsMetering' | 'bpmTempo' | 'voiceDetection' | 'stereoCorrelation' | 'goniometer' | 'oscilloscope' | 'frequencyBands' | 'debug' | 'spotify' | 'cylindricalBars' | 'waterfall3d' | 'frequencySphere' | 'stereoSpace3d' | 'tunnel' | 'terrain') {
    moduleVisibility.toggle(module);
  }

  // Accordion state for 3D visualizations
  let viz3dExpanded = false;

  // Accordion state for keyboard shortcuts
  let shortcutsExpanded = false;

  // Count active 3D visualizations
  $: active3dCount = [
    $moduleVisibility.cylindricalBars,
    $moduleVisibility.waterfall3d,
    $moduleVisibility.frequencySphere,
    $moduleVisibility.stereoSpace3d,
    $moduleVisibility.tunnel,
    $moduleVisibility.terrain,
  ].filter(v => v).length;

  function formatSampleRate(rate: number): string {
    if (rate >= 1000) {
      return `${(rate / 1000).toFixed(1)}kHz`;
    }
    return `${rate}Hz`;
  }

  function formatChannels(ch: number): string {
    if (ch === 1) return 'Mono';
    if (ch === 2) return 'Stereo';
    return `${ch}ch`;
  }
</script>

{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="backdrop" on:click={handleBackdropClick}></div>
{/if}

<aside class="sidebar" class:open>
  <div class="sidebar-header">
    <h2>Settings</h2>
    <button class="close-btn" on:click={() => dispatch('close')} aria-label="Close settings">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" fill="none" />
      </svg>
    </button>
  </div>

  <div class="sidebar-content">
    <section class="section audio-sources">
      <div class="section-header-row">
        <h3>Audio Sources</h3>
        <button class="refresh-btn" on:click={refreshDevices} title="Refresh devices">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M13.65 2.35A8 8 0 1 0 16 8h-2a6 6 0 1 1-1.76-4.24L10 6h6V0l-2.35 2.35z"/>
          </svg>
        </button>
      </div>

      <!-- Playback (Monitor) Sources -->
      <div class="accordion-section">
        <button
          class="accordion-header"
          class:expanded={monitorsExpanded}
          on:click={() => monitorsExpanded = !monitorsExpanded}
        >
          <svg class="accordion-icon" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="2" fill="none"/>
          </svg>
          <span class="accordion-title">Playback (System Audio)</span>
          <span class="device-count">{monitorDevices.length}</span>
        </button>
        {#if monitorsExpanded}
          <div class="accordion-content">
            {#each monitorDevices as device}
              <button
                class="device-item"
                class:selected={device.id === selectedDeviceId}
                class:running={device.state === 'running'}
                on:click={() => selectDevice(device)}
                title={device.description}
              >
                <span class="device-icon monitor">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <rect x="2" y="3" width="12" height="8" rx="1" stroke="currentColor" fill="none" />
                    <path d="M6 13h4M8 11v2" stroke="currentColor" />
                  </svg>
                </span>
                <div class="device-info">
                  <span class="device-name">{device.name}</span>
                  <span class="device-meta">{formatSampleRate(device.sampleRate)} {formatChannels(device.channels)}</span>
                </div>
                {#if device.state === 'running'}
                  <span class="state-indicator running" title="Active"></span>
                {/if}
              </button>
            {:else}
              <p class="no-devices">No playback sources found</p>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Recording (Input) Sources -->
      <div class="accordion-section">
        <button
          class="accordion-header"
          class:expanded={inputsExpanded}
          on:click={() => inputsExpanded = !inputsExpanded}
        >
          <svg class="accordion-icon" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="2" fill="none"/>
          </svg>
          <span class="accordion-title">Recording (Inputs)</span>
          <span class="device-count">{inputDevices.length}</span>
        </button>
        {#if inputsExpanded}
          <div class="accordion-content">
            {#each inputDevices as device}
              <button
                class="device-item"
                class:selected={device.id === selectedDeviceId}
                class:running={device.state === 'running'}
                on:click={() => selectDevice(device)}
                title={device.description}
              >
                <span class="device-icon input">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <circle cx="8" cy="6" r="3" stroke="currentColor" fill="none" />
                    <path d="M8 9v3M5 14h6" stroke="currentColor" stroke-width="1.5" />
                  </svg>
                </span>
                <div class="device-info">
                  <span class="device-name">{device.name}</span>
                  <span class="device-meta">{formatSampleRate(device.sampleRate)} {formatChannels(device.channels)}</span>
                </div>
                {#if device.state === 'running'}
                  <span class="state-indicator running" title="Active"></span>
                {/if}
              </button>
            {:else}
              <p class="no-devices">No recording sources found</p>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Input Level Slider -->
      <div class="input-level-control">
        <div class="level-header">
          <span class="level-label">Input Level</span>
          <span class="level-value">{gainToDb(inputGain)} dB</span>
        </div>
        <div class="level-slider-row">
          <input
            type="range"
            min="0"
            max="2"
            step="0.01"
            value={inputGain}
            on:input={handleGainChange}
            class="level-slider"
            title="Adjust input gain ({gainToDb(inputGain)} dB)"
          />
          <button
            class="reset-gain-btn"
            on:click={() => audioEngine.setInputGain(1.0)}
            title="Reset to unity gain (0 dB)"
            class:active={inputGain === 1.0}
          >
            0
          </button>
        </div>
        <div class="level-scale">
          <span>-∞</span>
          <span>-6</span>
          <span>0</span>
          <span>+6</span>
        </div>
      </div>

      {#if devices.length === 0}
        <p class="no-devices">No audio devices found. Is PulseAudio/PipeWire running?</p>
      {/if}
    </section>

    <section class="section">
      <h3>Modules</h3>
      <div class="accordion-section">
        <button
          class="accordion-header"
          class:expanded={modulesExpanded}
          on:click={() => modulesExpanded = !modulesExpanded}
        >
          <svg class="accordion-icon" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="2" fill="none"/>
          </svg>
          <span class="accordion-title">Display Panels</span>
          <span class="device-count">{Object.values($moduleVisibility).filter(v => v).length - ($moduleVisibility.waterfall ? 1 : 0)}</span>
        </button>
        {#if modulesExpanded}
          <div class="accordion-content">
            <button class="module-item" class:active={$moduleVisibility.spectrum} on:click={() => toggleModule('spectrum')}>
              <span class="module-name">Spectrum Display</span>
              <span class="led-indicator" class:on={$moduleVisibility.spectrum}></span>
            </button>
            <button class="module-item" class:active={$moduleVisibility.vuMeters} on:click={() => toggleModule('vuMeters')}>
              <span class="module-name">VU Meters</span>
              <span class="led-indicator" class:on={$moduleVisibility.vuMeters}></span>
            </button>
            <button class="module-item" class:active={$moduleVisibility.bassDetail} on:click={() => toggleModule('bassDetail')}>
              <span class="module-name">Bass Detail</span>
              <span class="led-indicator" class:on={$moduleVisibility.bassDetail}></span>
            </button>
            <button class="module-item sub-item" class:active={$moduleVisibility.waterfall} on:click={() => toggleModule('waterfall')}>
              <span class="module-name">Waterfall Display</span>
              <span class="led-indicator" class:on={$moduleVisibility.waterfall}></span>
            </button>
            <button class="module-item" class:active={$moduleVisibility.lufsMetering} on:click={() => toggleModule('lufsMetering')}>
              <span class="module-name">LUFS Metering</span>
              <span class="led-indicator" class:on={$moduleVisibility.lufsMetering}></span>
            </button>
            <button class="module-item" class:active={$moduleVisibility.bpmTempo} on:click={() => toggleModule('bpmTempo')}>
              <span class="module-name">BPM / Tempo</span>
              <span class="led-indicator" class:on={$moduleVisibility.bpmTempo}></span>
            </button>
            <button class="module-item" class:active={$moduleVisibility.voiceDetection} on:click={() => toggleModule('voiceDetection')}>
              <span class="module-name">Voice Detection</span>
              <span class="led-indicator" class:on={$moduleVisibility.voiceDetection}></span>
            </button>
            <button class="module-item" class:active={$moduleVisibility.stereoCorrelation} on:click={() => toggleModule('stereoCorrelation')}>
              <span class="module-name">Stereo Correlation</span>
              <span class="led-indicator" class:on={$moduleVisibility.stereoCorrelation}></span>
            </button>
            <button class="module-item" class:active={$moduleVisibility.goniometer} on:click={() => toggleModule('goniometer')}>
              <span class="module-name">Goniometer</span>
              <span class="led-indicator" class:on={$moduleVisibility.goniometer}></span>
            </button>
            <button class="module-item" class:active={$moduleVisibility.oscilloscope} on:click={() => toggleModule('oscilloscope')}>
              <span class="module-name">Oscilloscope</span>
              <span class="led-indicator" class:on={$moduleVisibility.oscilloscope}></span>
            </button>
            <button class="module-item" class:active={$moduleVisibility.frequencyBands} on:click={() => toggleModule('frequencyBands')}>
              <span class="module-name">Frequency Bands</span>
              <span class="led-indicator" class:on={$moduleVisibility.frequencyBands}></span>
            </button>
            <button class="module-item" class:active={$moduleVisibility.debug} on:click={() => toggleModule('debug')}>
              <span class="module-name">Debug Panel</span>
              <span class="led-indicator" class:on={$moduleVisibility.debug}></span>
            </button>
            <button class="module-item" class:active={$moduleVisibility.spotify} on:click={() => toggleModule('spotify')}>
              <span class="module-name">Spotify</span>
              <span class="led-indicator" class:on={$moduleVisibility.spotify}></span>
            </button>
          </div>
        {/if}
      </div>
    </section>

    <section class="section">
      <h3>3D Visualizations</h3>
      <div class="accordion-section">
        <button
          class="accordion-header"
          class:expanded={viz3dExpanded}
          on:click={() => viz3dExpanded = !viz3dExpanded}
        >
          <svg class="accordion-icon" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="2" fill="none"/>
          </svg>
          <span class="accordion-title">3D Panels</span>
          <span class="device-count">{active3dCount}</span>
        </button>
        {#if viz3dExpanded}
          <div class="accordion-content">
            <button class="module-item" class:active={$moduleVisibility.cylindricalBars} on:click={() => toggleModule('cylindricalBars')}>
              <span class="module-name">3D Bars (Cylinder)</span>
              <span class="led-indicator" class:on={$moduleVisibility.cylindricalBars}></span>
            </button>
            <button class="module-item" class:active={$moduleVisibility.waterfall3d} on:click={() => toggleModule('waterfall3d')}>
              <span class="module-name">3D Waterfall</span>
              <span class="led-indicator" class:on={$moduleVisibility.waterfall3d}></span>
            </button>
            <button class="module-item" class:active={$moduleVisibility.frequencySphere} on:click={() => toggleModule('frequencySphere')}>
              <span class="module-name">Frequency Sphere</span>
              <span class="led-indicator" class:on={$moduleVisibility.frequencySphere}></span>
            </button>
            <button class="module-item" class:active={$moduleVisibility.stereoSpace3d} on:click={() => toggleModule('stereoSpace3d')}>
              <span class="module-name">3D Stereo Space</span>
              <span class="led-indicator" class:on={$moduleVisibility.stereoSpace3d}></span>
            </button>
            <button class="module-item" class:active={$moduleVisibility.tunnel} on:click={() => toggleModule('tunnel')}>
              <span class="module-name">Tunnel Effect</span>
              <span class="led-indicator" class:on={$moduleVisibility.tunnel}></span>
            </button>
            <button class="module-item" class:active={$moduleVisibility.terrain} on:click={() => toggleModule('terrain')}>
              <span class="module-name">Terrain Landscape</span>
              <span class="led-indicator" class:on={$moduleVisibility.terrain}></span>
            </button>
          </div>
        {/if}
      </div>
    </section>

    <section class="section">
      <h3>Layout</h3>
      <div class="accordion-section">
        <button
          class="accordion-header"
          class:expanded={layoutExpanded}
          on:click={() => layoutExpanded = !layoutExpanded}
        >
          <svg class="accordion-icon" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="2" fill="none"/>
          </svg>
          <span class="accordion-title">Layout Controls</span>
        </button>
        {#if layoutExpanded}
          <div class="accordion-content">
            <button class="module-item" class:active={allLocked} on:click={() => allLocked ? gridLayout.unlockAll() : gridLayout.lockAll()}>
              <span class="module-name">{allLocked ? 'Unlock All Panels' : 'Lock All Panels'}</span>
              <span class="led-indicator" class:on={allLocked}></span>
            </button>
            <button class="module-item" class:active={$gridLayout.gridVisible} on:click={() => gridLayout.toggleGrid()}>
              <span class="module-name">Toggle Grid</span>
              <span class="led-indicator" class:on={$gridLayout.gridVisible}></span>
            </button>
            <button class="module-item" class:active={$gridLayout.snapEnabled} on:click={() => gridLayout.toggleSnap()}>
              <span class="module-name">Snap to Grid</span>
              <span class="led-indicator" class:on={$gridLayout.snapEnabled}></span>
            </button>
            <button class="module-item" on:click={handleAutoArrange}>
              <span class="module-name">Auto-Arrange</span>
            </button>
            <button class="module-item danger" on:click={() => gridLayout.reset()}>
              <span class="module-name">Reset Layout</span>
            </button>
          </div>
        {/if}
      </div>
    </section>

    <section class="section">
      <h3>Layout Presets</h3>
      <div class="accordion-section">
        <button
          class="accordion-header"
          class:expanded={presetsExpanded}
          on:click={() => presetsExpanded = !presetsExpanded}
        >
          <svg class="accordion-icon" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="2" fill="none"/>
          </svg>
          <span class="accordion-title">Saved Presets</span>
          <span class="device-count">{$layoutPresets.length}/5</span>
        </button>
        {#if presetsExpanded}
          <div class="accordion-content">
            {#if $layoutPresets.length > 0}
              {#each $layoutPresets as preset, index}
                <div class="preset-item">
                  <button class="module-item preset-load" on:click={() => handleLoadPreset(index)} title="Load preset">
                    <span class="module-name">{preset.name}</span>
                  </button>
                  <button class="preset-delete-btn" on:click={() => handleDeletePreset(index)} title="Delete preset">
                    ×
                  </button>
                </div>
              {/each}
            {:else}
              <p class="no-presets">No saved presets</p>
            {/if}

            {#if showSavePreset}
              <div class="save-preset-form">
                <input
                  type="text"
                  bind:value={newPresetName}
                  placeholder="Preset name"
                  class="preset-input"
                  on:keydown={(e) => e.key === 'Enter' && handleSavePreset()}
                />
                <button class="preset-save-btn" on:click={handleSavePreset}>Save</button>
                <button class="preset-cancel-btn" on:click={() => showSavePreset = false}>Cancel</button>
              </div>
            {:else}
              <button
                class="module-item save-preset-btn"
                on:click={() => showSavePreset = true}
                disabled={$layoutPresets.length >= 5}
              >
                <span class="module-name">Save Current Layout</span>
                {#if $layoutPresets.length >= 5}
                  <span class="badge-small">MAX</span>
                {/if}
              </button>
            {/if}
          </div>
        {/if}
      </div>
    </section>

    <section class="section">
      <h3>Spotify Settings</h3>
      <div class="accordion-section">
        <button
          class="accordion-header"
          class:expanded={spotifySettingsExpanded}
          on:click={() => spotifySettingsExpanded = !spotifySettingsExpanded}
        >
          <svg class="accordion-icon" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="2" fill="none"/>
          </svg>
          <span class="accordion-title">API Credentials</span>
          <span class="led-indicator" class:on={spotifyConfigured}></span>
        </button>
        {#if spotifySettingsExpanded}
          <div class="accordion-content spotify-settings">
            {#if spotifyConfigured}
              <div class="spotify-status configured">
                <span class="status-icon">&#10003;</span>
                <span>Configured</span>
                <span class="client-id-preview">{spotifyClientIdPreview}</span>
              </div>
              <p class="spotify-hint">Enter new credentials to update:</p>
            {:else}
              <div class="spotify-status not-configured">
                <span class="status-icon">!</span>
                <span>Not configured</span>
              </div>
              <p class="spotify-hint">
                Get credentials from <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">Spotify Developer Dashboard</a>
              </p>
            {/if}

            <div class="spotify-form">
              <label class="spotify-label">
                Client ID
                <input
                  type="text"
                  bind:value={spotifyClientId}
                  placeholder="Enter Client ID"
                  class="spotify-input"
                />
              </label>
              <label class="spotify-label">
                Client Secret
                <input
                  type="password"
                  bind:value={spotifyClientSecret}
                  placeholder="Enter Client Secret"
                  class="spotify-input"
                />
              </label>

              {#if spotifySaveError}
                <div class="spotify-error">{spotifySaveError}</div>
              {/if}

              {#if spotifySaveSuccess}
                <div class="spotify-success">Credentials saved successfully!</div>
              {/if}

              <button
                class="spotify-save-btn"
                on:click={saveSpotifyCredentials}
                disabled={spotifySaving || !spotifyClientId.trim() || !spotifyClientSecret.trim()}
              >
                {spotifySaving ? 'Saving...' : 'Save Credentials'}
              </button>
            </div>
          </div>
        {/if}
      </div>
    </section>

    <section class="section">
      <h3>Keyboard Shortcuts</h3>
      <div class="accordion-section">
        <button
          class="accordion-header"
          class:expanded={shortcutsExpanded}
          on:click={() => shortcutsExpanded = !shortcutsExpanded}
        >
          <svg class="accordion-icon" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M4 2l4 4-4 4" stroke="currentColor" stroke-width="2" fill="none"/>
          </svg>
          <span class="accordion-title">All Shortcuts</span>
        </button>
        {#if shortcutsExpanded}
          <div class="accordion-content shortcuts-content">
            <!-- Controls -->
            <div class="shortcut-category">Controls</div>
            <div class="shortcut"><kbd>Space</kbd> Start/Stop</div>
            <div class="shortcut"><kbd>M</kbd> Menu</div>
            <div class="shortcut"><kbd>F</kbd> Fullscreen</div>
            <div class="shortcut"><kbd>Esc</kbd> Exit Fullscreen / Close Menu</div>
            <div class="shortcut"><kbd>Q</kbd> Quit</div>

            <!-- 2D Panels -->
            <div class="shortcut-category">2D Panels</div>
            <div class="shortcut"><kbd>S</kbd> Spectrum</div>
            <div class="shortcut"><kbd>U</kbd> VU Meters</div>
            <div class="shortcut"><kbd>B</kbd> Bass Detail</div>
            <div class="shortcut"><kbd>W</kbd> Waterfall</div>
            <div class="shortcut"><kbd>L</kbd> LUFS</div>
            <div class="shortcut"><kbd>T</kbd> Tempo</div>
            <div class="shortcut"><kbd>V</kbd> Voice Detection</div>
            <div class="shortcut"><kbd>C</kbd> Stereo Correlation</div>
            <div class="shortcut"><kbd>G</kbd> Goniometer</div>
            <div class="shortcut"><kbd>O</kbd> Oscilloscope</div>
            <div class="shortcut"><kbd>N</kbd> Frequency Bands</div>
            <div class="shortcut"><kbd>D</kbd> Debug</div>
            <div class="shortcut"><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> Spotify</div>

            <!-- 3D Panels -->
            <div class="shortcut-category">3D Panels</div>
            <div class="shortcut"><kbd>Shift</kbd>+<kbd>B</kbd> 3D Bars</div>
            <div class="shortcut"><kbd>Shift</kbd>+<kbd>W</kbd> 3D Waterfall</div>
            <div class="shortcut"><kbd>Shift</kbd>+<kbd>F</kbd> Frequency Sphere</div>
            <div class="shortcut"><kbd>Shift</kbd>+<kbd>S</kbd> 3D Stereo</div>
            <div class="shortcut"><kbd>Shift</kbd>+<kbd>T</kbd> Tunnel</div>
            <div class="shortcut"><kbd>Shift</kbd>+<kbd>L</kbd> Terrain</div>

            <!-- Layout Controls -->
            <div class="shortcut-category">Layout</div>
            <div class="shortcut"><kbd>Alt</kbd>+<kbd>L</kbd> Lock/Unlock All</div>
            <div class="shortcut"><kbd>Alt</kbd>+<kbd>T</kbd> Toggle Grid</div>
            <div class="shortcut"><kbd>Alt</kbd>+<kbd>S</kbd> Toggle Snap</div>
            <div class="shortcut"><kbd>Alt</kbd>+<kbd>A</kbd> Auto-Arrange</div>
            <div class="shortcut"><kbd>Alt</kbd>+<kbd>R</kbd> Reset Layout</div>
          </div>
        {/if}
      </div>
    </section>
  </div>
</aside>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 99;
  }

  .sidebar {
    position: fixed;
    top: var(--header-height);
    left: 0;
    bottom: 0;
    width: var(--sidebar-width);
    background: var(--bg-secondary);
    border-right: 1px solid var(--border-color);
    transform: translateX(-100%);
    transition: transform var(--transition-normal);
    z-index: 100;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .sidebar.open {
    transform: translateX(0);
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem;
    border-bottom: 1px solid var(--border-color);
  }

  .sidebar-header h2 {
    font-size: 1rem;
    font-weight: 500;
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 4px;
  }

  .close-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .sidebar-content {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
  }

  .section {
    margin-bottom: 1.5rem;
  }

  .section h3 {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-muted);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin-bottom: 0.75rem;
  }

  .device-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--text-secondary);
    cursor: pointer;
    text-align: left;
    transition: all var(--transition-fast);
  }

  .device-item:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .device-item.selected {
    background: rgba(74, 158, 255, 0.1);
    border-color: var(--accent-color);
    color: var(--accent-color);
  }

  .device-name {
    flex: 1;
    font-size: 0.85rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .no-devices {
    color: var(--text-muted);
    font-size: 0.85rem;
    padding: 0.5rem;
  }

  /* Module Item Styles */
  .module-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.5rem 0.75rem;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 0.85rem;
    cursor: pointer;
    text-align: left;
    transition: all var(--transition-fast);
  }

  .module-item:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .module-item.active {
    color: var(--text-primary);
  }

  .module-item.sub-item {
    padding-left: 1.5rem;
    font-size: 0.8rem;
  }

  .module-name {
    flex: 1;
  }

  .led-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    flex-shrink: 0;
    transition: all var(--transition-fast);
  }

  .led-indicator.on {
    background: var(--meter-green);
    border-color: var(--meter-green);
    box-shadow: 0 0 6px var(--meter-green);
  }

  .module-item.danger:hover {
    background: rgba(239, 68, 68, 0.1);
    color: var(--meter-red);
  }

  .module-item.preset-load {
    flex: 1;
  }

  .module-item.save-preset-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .badge-small {
    font-size: 0.6rem;
    padding: 0.1rem 0.3rem;
    background: rgba(239, 68, 68, 0.2);
    border-radius: 2px;
    color: var(--meter-red);
  }

  .shortcuts-content {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.5rem !important;
  }

  .shortcut-category {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--accent-color);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-top: 0.5rem;
    margin-bottom: 0.1rem;
    padding-bottom: 0.2rem;
    border-bottom: 1px solid var(--border-color);
  }

  .shortcut-category:first-child {
    margin-top: 0;
  }

  .shortcut {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
    color: var(--text-secondary);
    padding: 0.15rem 0;
  }

  kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    padding: 0.1rem 0.35rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 3px;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--text-primary);
  }

  /* Audio Sources Section */
  .section-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }

  .section-header-row h3 {
    margin-bottom: 0;
  }

  .refresh-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-muted);
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .refresh-btn:hover {
    background: var(--bg-tertiary);
    border-color: var(--accent-color);
    color: var(--accent-color);
  }

  /* Accordion Styles */
  .accordion-section {
    margin-bottom: 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    overflow: hidden;
  }

  .accordion-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.5rem 0.75rem;
    background: var(--bg-tertiary);
    border: none;
    color: var(--text-secondary);
    font-size: 0.8rem;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .accordion-header:hover {
    background: rgba(74, 158, 255, 0.1);
    color: var(--text-primary);
  }

  .accordion-header.expanded {
    border-bottom: 1px solid var(--border-color);
  }

  .accordion-icon {
    transition: transform var(--transition-fast);
    flex-shrink: 0;
  }

  .accordion-header.expanded .accordion-icon {
    transform: rotate(90deg);
  }

  .accordion-title {
    flex: 1;
    text-align: left;
    font-weight: 500;
  }

  .device-count {
    font-size: 0.7rem;
    padding: 0.1rem 0.4rem;
    background: var(--bg-secondary);
    border-radius: 10px;
    color: var(--text-muted);
  }

  .accordion-content {
    padding: 0.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  /* Device Item Styles */
  .device-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    color: var(--text-muted);
  }

  .device-icon.monitor {
    color: var(--accent-color);
  }

  .device-icon.input {
    color: var(--meter-green);
  }

  .device-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }

  .device-meta {
    font-size: 0.7rem;
    color: var(--text-muted);
  }

  .device-item.running .device-meta {
    color: var(--meter-green);
  }

  .state-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .state-indicator.running {
    background: var(--meter-green);
    box-shadow: 0 0 6px var(--meter-green);
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .audio-sources .no-devices {
    padding: 0.75rem;
    text-align: center;
    font-style: italic;
  }

  /* Layout Presets Styles */
  .preset-item {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .preset-item .module-item {
    border-radius: 4px 0 0 4px;
  }

  .preset-delete-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-muted);
    font-size: 1rem;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .preset-delete-btn:hover {
    background: rgba(239, 68, 68, 0.1);
    border-color: var(--meter-red);
    color: var(--meter-red);
  }

  .save-preset-form {
    display: flex;
    gap: 0.25rem;
  }

  .preset-input {
    flex: 1;
    padding: 0.4rem 0.5rem;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 0.8rem;
  }

  .preset-input:focus {
    outline: none;
    border-color: var(--accent-color);
  }

  .preset-input::placeholder {
    color: var(--text-muted);
  }

  .preset-save-btn {
    padding: 0.4rem 0.6rem;
    background: var(--accent-color);
    border: none;
    border-radius: 4px;
    color: white;
    font-size: 0.75rem;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .preset-save-btn:hover {
    background: var(--accent-hover);
  }

  .preset-cancel-btn {
    padding: 0.4rem 0.6rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 0.75rem;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .preset-cancel-btn:hover {
    background: rgba(239, 68, 68, 0.1);
    border-color: var(--meter-red);
    color: var(--meter-red);
  }

  .no-presets {
    color: var(--text-muted);
    font-size: 0.8rem;
    font-style: italic;
    padding: 0.25rem 0;
  }

  /* Input Level Control Styles */
  .input-level-control {
    margin-top: 0.75rem;
    padding: 0.75rem;
    background: var(--bg-tertiary);
    border-radius: 6px;
    border: 1px solid var(--border-color);
  }

  .level-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .level-label {
    font-size: 0.8rem;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .level-value {
    font-size: 0.75rem;
    font-family: monospace;
    color: var(--accent-color);
    min-width: 50px;
    text-align: right;
  }

  .level-slider-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .level-slider {
    flex: 1;
    height: 6px;
    -webkit-appearance: none;
    appearance: none;
    background: linear-gradient(to right,
      var(--meter-red) 0%,
      var(--meter-yellow) 25%,
      var(--meter-green) 50%,
      var(--meter-yellow) 75%,
      var(--meter-red) 100%
    );
    border-radius: 3px;
    cursor: pointer;
  }

  .level-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    background: var(--text-primary);
    border: 2px solid var(--bg-primary);
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }

  .level-slider::-moz-range-thumb {
    width: 14px;
    height: 14px;
    background: var(--text-primary);
    border: 2px solid var(--bg-primary);
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }

  .reset-gain-btn {
    width: 24px;
    height: 24px;
    padding: 0;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 0.7rem;
    font-weight: 600;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .reset-gain-btn:hover {
    background: var(--accent-color);
    border-color: var(--accent-color);
    color: white;
  }

  .reset-gain-btn.active {
    background: var(--accent-color);
    border-color: var(--accent-color);
    color: white;
  }

  .level-scale {
    display: flex;
    justify-content: space-between;
    margin-top: 0.25rem;
    padding: 0 2px;
  }

  .level-scale span {
    font-size: 0.6rem;
    color: var(--text-muted);
    font-family: monospace;
  }

  /* Spotify Settings Styles */
  .spotify-settings {
    padding: 0.5rem;
  }

  .spotify-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
    font-size: 0.8rem;
    margin-bottom: 0.5rem;
  }

  .spotify-status.configured {
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.3);
    color: var(--meter-green);
  }

  .spotify-status.not-configured {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: var(--meter-red);
  }

  .spotify-status .status-icon {
    font-weight: bold;
  }

  .spotify-status .client-id-preview {
    margin-left: auto;
    font-family: monospace;
    font-size: 0.7rem;
    color: var(--text-muted);
  }

  .spotify-hint {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-bottom: 0.75rem;
    line-height: 1.4;
  }

  .spotify-hint a {
    color: var(--accent-color);
    text-decoration: none;
  }

  .spotify-hint a:hover {
    text-decoration: underline;
  }

  .spotify-form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .spotify-label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .spotify-input {
    padding: 0.5rem;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 0.8rem;
    font-family: inherit;
  }

  .spotify-input:focus {
    outline: none;
    border-color: var(--accent-color);
  }

  .spotify-input::placeholder {
    color: var(--text-muted);
  }

  .spotify-save-btn {
    padding: 0.5rem 1rem;
    background: var(--accent-color);
    border: none;
    border-radius: 4px;
    color: white;
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition-fast);
    margin-top: 0.25rem;
  }

  .spotify-save-btn:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .spotify-save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .spotify-error {
    padding: 0.5rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 4px;
    color: var(--meter-red);
    font-size: 0.75rem;
  }

  .spotify-success {
    padding: 0.5rem;
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.3);
    border-radius: 4px;
    color: var(--meter-green);
    font-size: 0.75rem;
  }
</style>
