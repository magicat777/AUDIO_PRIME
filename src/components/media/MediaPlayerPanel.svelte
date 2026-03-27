<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { renderCoordinator } from '../../core/RenderCoordinator';
  import { moduleVisibility } from '../../stores/moduleVisibility';
  import { audioEngine } from '../../core/AudioEngine';
  import HiResBadge from '../ui/HiResBadge.svelte';
  import type { MprisNowPlaying } from '../../types/global';

  const RENDER_ID = 'media-player-panel';

  let nowPlaying: MprisNowPlaying = {
    available: false,
    playerName: '',
    status: 'Unknown',
    title: '',
    artist: '',
    album: '',
    artUrl: '',
    durationMs: 0,
    positionMs: 0,
    bitrate: 0,
    fileUrl: '',
    year: 0,
    trackNumber: 0,
    shuffle: false,
    loopStatus: 'None',
    volume: 1,
  };

  let displayProgress = 0;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let artSrc = '';
  let lastArtUrl = '';

  // Sync visibility with RenderCoordinator
  $: renderCoordinator.setVisibility(RENDER_ID, $moduleVisibility.mediaPlayer);

  // Live audio info — subscribe to the engine's capture sample rate
  let liveSampleRate = 0;
  let liveBitDepth = 0;

  const unsubState = audioEngine.state.subscribe((state) => {
    if (state.sampleRate > 0) {
      liveSampleRate = state.sampleRate;
      // Infer bit depth: rates above 44.1kHz are always 24-bit in HiRes
      liveBitDepth = state.sampleRate > 44100 ? 24 : 16;
    }
  });

  $: sampleRate = liveSampleRate;
  $: bitDepth = liveBitDepth;
  $: isHiRes = sampleRate > 44100;
  $: isPlaying = nowPlaying.status === 'Playing';

  function formatTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  function formatBitrate(kbps: number): string {
    if (kbps <= 0) return '';
    if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
    return `${kbps} kbps`;
  }

  async function fetchNowPlaying() {
    if (!window.electronAPI?.mpris) return;
    try {
      nowPlaying = await window.electronAPI.mpris.getNowPlaying();
      if (nowPlaying.available) {
        displayProgress = nowPlaying.positionMs;
        // Resolve file:// art URL to data URL via main process
        if (nowPlaying.artUrl && nowPlaying.artUrl !== lastArtUrl) {
          lastArtUrl = nowPlaying.artUrl;
          if (nowPlaying.artUrl.startsWith('file://') && window.electronAPI?.mpris?.getArt) {
            try {
              const dataUrl = await window.electronAPI.mpris.getArt(nowPlaying.artUrl);
              if (dataUrl) {
                artSrc = dataUrl;
              }
            } catch (artError) {
              console.error('Failed to load art:', artError);
            }
          } else if (!nowPlaying.artUrl.startsWith('file://')) {
            artSrc = nowPlaying.artUrl;
          }
        }
      }
    } catch {
      // API not available
    }
  }

  function updateProgress() {
    if (isPlaying && nowPlaying.durationMs > 0) {
      displayProgress = Math.min(displayProgress + 16.67, nowPlaying.durationMs);
    }
  }

  // Playback controls
  async function handlePlayPause() {
    await window.electronAPI?.mpris?.command('PlayPause');
    setTimeout(fetchNowPlaying, 100);
  }

  async function handlePrevious() {
    await window.electronAPI?.mpris?.command('Previous');
    setTimeout(fetchNowPlaying, 200);
  }

  async function handleNext() {
    await window.electronAPI?.mpris?.command('Next');
    setTimeout(fetchNowPlaying, 200);
  }

  async function handleShuffle() {
    await window.electronAPI?.mpris?.shuffle(!nowPlaying.shuffle);
    setTimeout(fetchNowPlaying, 100);
  }

  async function handleLoop() {
    const next = nowPlaying.loopStatus === 'None' ? 'Playlist'
      : nowPlaying.loopStatus === 'Playlist' ? 'Track' : 'None';
    await window.electronAPI?.mpris?.loop(next);
    setTimeout(fetchNowPlaying, 100);
  }

  function handleSeek(event: MouseEvent) {
    if (!nowPlaying.durationMs) return;
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const percent = (event.clientX - rect.left) / rect.width;
    const positionUs = Math.floor(percent * nowPlaying.durationMs * 1000); // ms → μs
    window.electronAPI?.mpris?.seek(positionUs);
    displayProgress = percent * nowPlaying.durationMs;
  }

  onMount(() => {
    fetchNowPlaying();
    pollInterval = setInterval(fetchNowPlaying, 2000);
    renderCoordinator.register(RENDER_ID, updateProgress, 'low');
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
    renderCoordinator.unregister(RENDER_ID);
    unsubState();
  });
</script>

<div class="media-player-panel">
  <div class="panel-header">
    <span class="title">{nowPlaying.playerName || 'MEDIA PLAYER'}</span>
    <span class="status-indicator" class:playing={isPlaying} class:paused={nowPlaying.status === 'Paused'}>
      {nowPlaying.available ? nowPlaying.status.toUpperCase() : 'NO PLAYER'}
    </span>
  </div>

  {#if nowPlaying.available && nowPlaying.title}
    <div class="player-content">
      <!-- Album art fills available space -->
      <div class="art-area">
        {#if artSrc}
          <img src={artSrc} alt="Album art" class="album-art-img" />
        {:else}
          <div class="no-art">No Art</div>
        {/if}
      </div>

      <!-- HiRes badge below art -->
      {#if isHiRes}
        <div class="hires-row">
          <HiResBadge sampleRate={sampleRate} bitDepth={bitDepth} />
        </div>
      {/if}

      <!-- Track info row -->
      <div class="track-info">
        <div class="track-name" title={nowPlaying.title}>{nowPlaying.title}</div>
        <div class="track-artist" title={nowPlaying.artist}>{nowPlaying.artist}</div>
        <div class="track-detail">
          <span class="track-album" title={nowPlaying.album}>{nowPlaying.album}{nowPlaying.year ? ` (${nowPlaying.year})` : ''}</span>
          {#if nowPlaying.bitrate > 0}
            <span class="bitrate">{formatBitrate(nowPlaying.bitrate)}</span>
          {/if}
        </div>
      </div>

      <!-- Progress bar -->
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-static-element-interactions -->
      <div class="progress-bar" on:click={handleSeek}>
        <div class="progress-fill" style="width: {nowPlaying.durationMs > 0 ? (displayProgress / nowPlaying.durationMs * 100) : 0}%"></div>
      </div>
      <div class="progress-times">
        <span>{formatTime(displayProgress)}</span>
        <span>{formatTime(nowPlaying.durationMs)}</span>
      </div>

      <!-- Playback controls -->
      <div class="controls">
        <button class="control-btn small" on:click={handleShuffle} class:active={nowPlaying.shuffle} title="Shuffle">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
        </button>
        <button class="control-btn" on:click={handlePrevious} title="Previous">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
        </button>
        <button class="control-btn play-btn" on:click={handlePlayPause} title={isPlaying ? 'Pause' : 'Play'}>
          {#if isPlaying}
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          {/if}
        </button>
        <button class="control-btn" on:click={handleNext} title="Next">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
        </button>
        <button class="control-btn small" on:click={handleLoop} class:active={nowPlaying.loopStatus !== 'None'} title="Loop: {nowPlaying.loopStatus}">
          {#if nowPlaying.loopStatus === 'Track'}
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/><text x="12" y="15.5" text-anchor="middle" font-size="7" font-weight="bold">1</text></svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>
          {/if}
        </button>
      </div>
    </div>
  {:else}
    <div class="no-player">
      <div class="no-player-icon">🎵</div>
      <div class="no-player-text">
        {nowPlaying.available ? 'No track playing' : 'No MPRIS2 player detected'}
      </div>
      <div class="no-player-hint">Start Strawberry, mpv, or any MPRIS2 player</div>
    </div>
  {/if}
</div>

<style>
  .media-player-panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding: 0.5rem;
    background: var(--bg-panel);
    border-radius: var(--border-radius);
    box-sizing: border-box;
    overflow: hidden;
    gap: 0.35rem;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
    padding-bottom: 0.25rem;
    border-bottom: 1px solid var(--border-color);
  }

  .title {
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--text-primary);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .status-indicator {
    font-size: 0.6rem;
    font-family: var(--font-mono);
    color: var(--text-muted);
    padding: 1px 6px;
    border-radius: 3px;
    background: rgba(255,255,255,0.05);
  }

  .status-indicator.playing {
    color: #22c55e;
    background: rgba(34, 197, 94, 0.1);
  }

  .status-indicator.paused {
    color: #f59e0b;
    background: rgba(245, 158, 11, 0.1);
  }

  .player-content {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    flex: 1;
    min-height: 0;
  }

  /* Album art fills all available vertical space */
  .art-area {
    flex: 1;
    min-height: 60px;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    overflow: hidden;
    background: var(--bg-secondary);
  }

  .album-art-img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 4px;
  }

  .no-art {
    font-size: 0.7rem;
    color: var(--text-muted);
    opacity: 0.5;
  }

  .hires-row {
    flex-shrink: 0;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  /* Track info — compact, pinned below art */
  .track-info {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .track-name {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .track-artist {
    font-size: 0.7rem;
    color: var(--accent-color, #8b5cf6);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .track-detail {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .track-album {
    font-size: 0.6rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .bitrate {
    flex-shrink: 0;
    font-size: 0.55rem;
    font-family: var(--font-mono);
    color: var(--text-secondary);
    padding: 0 4px;
    background: rgba(255,255,255,0.05);
    border-radius: 2px;
  }

  /* Progress bar */
  .progress-bar {
    flex-shrink: 0;
    width: 100%;
    height: 4px;
    background: var(--bg-secondary);
    border-radius: 2px;
    cursor: pointer;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent-color, #8b5cf6);
    border-radius: 2px;
    max-width: 100%;
  }

  .progress-times {
    flex-shrink: 0;
    display: flex;
    justify-content: space-between;
    font-size: 0.55rem;
    font-family: var(--font-mono);
    color: var(--text-muted);
  }

  /* Playback controls — pinned to bottom */
  .controls {
    flex-shrink: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 0.3rem;
  }

  .control-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255,255,255,0.05);
    border: 1px solid var(--border-color);
    border-radius: 50%;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 4px;
  }

  .control-btn:hover {
    background: rgba(255,255,255,0.12);
    color: var(--text-primary);
  }

  .control-btn.small {
    width: 22px;
    height: 22px;
    padding: 3px;
  }

  .control-btn.active {
    color: var(--accent-color, #8b5cf6);
    border-color: var(--accent-color, #8b5cf6);
  }

  .control-btn.play-btn {
    width: 34px;
    height: 34px;
    background: var(--accent-color, #8b5cf6);
    border-color: var(--accent-color, #8b5cf6);
    color: #fff;
  }

  .control-btn.play-btn:hover {
    background: var(--accent-hover, #7c3aed);
  }

  .control-btn svg {
    width: 100%;
    height: 100%;
  }

  .no-player {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    color: var(--text-muted);
  }

  .no-player-icon {
    font-size: 2rem;
    opacity: 0.4;
  }

  .no-player-text {
    font-size: 0.75rem;
  }

  .no-player-hint {
    font-size: 0.6rem;
    opacity: 0.6;
  }
</style>
