<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { audioEngine } from '../../core/AudioEngine';
  import type { AudioDevice } from '../../core/AudioEngine';
  import { moduleVisibility } from '../../stores/moduleVisibility';
  import { gridLayout } from '../../stores/gridLayout';

  export let open = false;

  const dispatch = createEventDispatcher();

  let devices: AudioDevice[] = [];
  let selectedDeviceId: string | null = null;

  // Check if all panels are locked
  $: allLocked = Object.values($gridLayout.panels).every(p => p.locked);
  $: someLocked = Object.values($gridLayout.panels).some(p => p.locked);

  // Get devices on mount
  $: if (open && devices.length === 0) {
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

  function toggleModule(module: 'spectrum' | 'vuMeters' | 'bassDetail' | 'waterfall' | 'lufsMetering' | 'bpmTempo' | 'voiceDetection' | 'stereoCorrelation' | 'goniometer' | 'oscilloscope' | 'frequencyBands' | 'debug' | 'spotify') {
    moduleVisibility.toggle(module);
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
    <section class="section">
      <h3>Audio Source</h3>
      <div class="device-list">
        {#each devices as device}
          <button
            class="device-item"
            class:selected={device.id === selectedDeviceId}
            on:click={() => selectDevice(device)}
          >
            <span class="device-icon">
              {#if device.type === 'monitor'}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="2" y="3" width="12" height="8" rx="1" stroke="currentColor" fill="none" />
                  <path d="M6 13h4M8 11v2" stroke="currentColor" />
                </svg>
              {:else}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" fill="none" />
                  <circle cx="8" cy="8" r="2" fill="currentColor" />
                </svg>
              {/if}
            </span>
            <span class="device-name">{device.name}</span>
          </button>
        {:else}
          <p class="no-devices">No audio sources found</p>
        {/each}
      </div>
    </section>

    <section class="section">
      <h3>Modules</h3>
      <div class="module-list">
        <label class="module-toggle">
          <input type="checkbox" checked={$moduleVisibility.spectrum} on:change={() => toggleModule('spectrum')} />
          <span>Spectrum Display</span>
          <span class="badge">Core</span>
        </label>
        <label class="module-toggle">
          <input type="checkbox" checked={$moduleVisibility.vuMeters} on:change={() => toggleModule('vuMeters')} />
          <span>VU Meters</span>
          <span class="badge">Core</span>
        </label>
        <label class="module-toggle">
          <input type="checkbox" checked={$moduleVisibility.bassDetail} on:change={() => toggleModule('bassDetail')} />
          <span>Bass Detail</span>
        </label>
        <label class="module-toggle sub-toggle">
          <input type="checkbox" checked={$moduleVisibility.waterfall} on:change={() => toggleModule('waterfall')} />
          <span>Waterfall Display</span>
        </label>
        <label class="module-toggle">
          <input type="checkbox" checked={$moduleVisibility.lufsMetering} on:change={() => toggleModule('lufsMetering')} />
          <span>LUFS Metering</span>
        </label>
        <label class="module-toggle">
          <input type="checkbox" checked={$moduleVisibility.bpmTempo} on:change={() => toggleModule('bpmTempo')} />
          <span>BPM / Tempo</span>
        </label>
        <label class="module-toggle">
          <input type="checkbox" checked={$moduleVisibility.voiceDetection} on:change={() => toggleModule('voiceDetection')} />
          <span>Voice Detection</span>
        </label>
        <label class="module-toggle">
          <input type="checkbox" checked={$moduleVisibility.stereoCorrelation} on:change={() => toggleModule('stereoCorrelation')} />
          <span>Stereo Correlation</span>
          <span class="badge stereo">NEW</span>
        </label>
        <label class="module-toggle">
          <input type="checkbox" checked={$moduleVisibility.goniometer} on:change={() => toggleModule('goniometer')} />
          <span>Goniometer</span>
          <span class="badge stereo">NEW</span>
        </label>
        <label class="module-toggle">
          <input type="checkbox" checked={$moduleVisibility.oscilloscope} on:change={() => toggleModule('oscilloscope')} />
          <span>Oscilloscope</span>
          <span class="badge stereo">NEW</span>
        </label>
        <label class="module-toggle">
          <input type="checkbox" checked={$moduleVisibility.frequencyBands} on:change={() => toggleModule('frequencyBands')} />
          <span>Frequency Bands</span>
          <span class="badge stereo">NEW</span>
        </label>
        <label class="module-toggle">
          <input type="checkbox" checked={$moduleVisibility.debug} on:change={() => toggleModule('debug')} />
          <span>Debug Panel</span>
        </label>
        <label class="module-toggle">
          <input type="checkbox" checked={$moduleVisibility.spotify} on:change={() => toggleModule('spotify')} />
          <span>Spotify</span>
          <span class="badge spotify">API</span>
        </label>
      </div>
    </section>

    <section class="section">
      <h3>Layout</h3>
      <div class="layout-controls">
        <button
          class="layout-btn"
          class:active={allLocked}
          on:click={() => allLocked ? gridLayout.unlockAll() : gridLayout.lockAll()}
        >
          <span class="lock-icon">{allLocked ? '🔓' : '🔒'}</span>
          <span>{allLocked ? 'Unlock All Panels' : 'Lock All Panels'}</span>
        </button>
        <button class="layout-btn" on:click={() => gridLayout.toggleGrid()}>
          <span class="grid-icon">⊞</span>
          <span>Toggle Grid</span>
          {#if $gridLayout.gridVisible}
            <span class="badge active">ON</span>
          {/if}
        </button>
        <button class="layout-btn" on:click={() => gridLayout.toggleSnap()}>
          <span class="snap-icon">⊡</span>
          <span>Snap to Grid</span>
          {#if $gridLayout.snapEnabled}
            <span class="badge active">ON</span>
          {/if}
        </button>
        <button class="layout-btn danger" on:click={() => gridLayout.reset()}>
          <span class="reset-icon">↺</span>
          <span>Reset Layout</span>
        </button>
      </div>
    </section>

    <section class="section">
      <h3>Keyboard Shortcuts</h3>
      <div class="shortcuts">
        <div class="shortcut"><kbd>Space</kbd> Start/Stop</div>
        <div class="shortcut"><kbd>M</kbd> Toggle Menu</div>
        <div class="shortcut"><kbd>F</kbd> Fullscreen</div>
        <div class="shortcut"><kbd>Esc</kbd> Close Menu</div>
        <div class="shortcut"><kbd>Shift</kbd>+<kbd>G</kbd> Toggle Grid</div>
        <div class="shortcut"><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> Toggle Snap</div>
        <div class="shortcut"><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> Reset Layout</div>
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

  .device-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
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

  .module-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .module-toggle {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.4rem 0;
    cursor: pointer;
    font-size: 0.85rem;
    color: var(--text-secondary);
  }

  .module-toggle input {
    width: 16px;
    height: 16px;
    accent-color: var(--accent-color);
  }

  .module-toggle:hover {
    color: var(--text-primary);
  }

  .module-toggle.sub-toggle {
    padding-left: 1.5rem;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .badge {
    font-size: 0.65rem;
    padding: 0.15rem 0.4rem;
    background: var(--bg-tertiary);
    border-radius: 2px;
    color: var(--text-muted);
    margin-left: auto;
  }

  .badge.spotify {
    background: rgba(29, 185, 84, 0.2);
    color: #1DB954;
  }

  .badge.stereo {
    background: rgba(74, 158, 255, 0.2);
    color: var(--accent-color);
  }

  .shortcuts {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .shortcut {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.85rem;
    color: var(--text-secondary);
  }

  kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    padding: 0.15rem 0.4rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 3px;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--text-primary);
  }

  /* Layout controls */
  .layout-controls {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .layout-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 0.8rem;
    cursor: pointer;
    transition: all var(--transition-fast);
  }

  .layout-btn:hover {
    background: rgba(74, 158, 255, 0.1);
    border-color: var(--accent-color);
    color: var(--text-primary);
  }

  .layout-btn.active {
    background: rgba(74, 220, 150, 0.1);
    border-color: var(--meter-green);
  }

  .layout-btn.danger:hover {
    background: rgba(239, 68, 68, 0.1);
    border-color: var(--meter-red);
    color: var(--meter-red);
  }

  .layout-btn .badge.active {
    background: rgba(74, 220, 150, 0.2);
    color: var(--meter-green);
  }

  .lock-icon, .grid-icon, .snap-icon, .reset-icon {
    font-size: 0.9rem;
  }
</style>
