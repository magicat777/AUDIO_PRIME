<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { spotifyService } from '../../core/SpotifyService';
  import type { SpotifyAuthStatus, SpotifyNowPlaying } from '../../core/SpotifyService';
  import { renderCoordinator } from '../../core/RenderCoordinator';
  import { moduleVisibility } from '../../stores/moduleVisibility';

  const RENDER_ID = 'spotify-panel';

  // Subscribed state
  let authStatus: SpotifyAuthStatus = { connected: false, connecting: false };
  let nowPlaying: SpotifyNowPlaying = { isPlaying: false, track: null };

  // Display progress
  let displayProgress = 0;

  // Sync visibility with RenderCoordinator
  $: renderCoordinator.setVisibility(RENDER_ID, $moduleVisibility.spotify);

  // Subscribe to stores
  const unsubAuth = spotifyService.authStatus.subscribe(value => {
    authStatus = value;
  });

  const unsubNowPlaying = spotifyService.nowPlaying.subscribe(value => {
    nowPlaying = value;
    if (value.track) {
      displayProgress = value.track.progressMs;
    }
  });

  // Progress animation (increment progress between API polls)
  function updateProgress() {
    if (nowPlaying.isPlaying && nowPlaying.track) {
      displayProgress = Math.min(displayProgress + 16.67, nowPlaying.track.durationMs); // ~60fps
    }
  }

  // Format time as MM:SS
  function formatTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  // Handle connect button
  function handleConnect() {
    spotifyService.connect();
  }

  // Handle disconnect button
  function handleDisconnect() {
    spotifyService.disconnect();
  }

  // Playback controls
  function handlePlayPause() {
    spotifyService.togglePlayPause();
  }

  function handlePrevious() {
    spotifyService.previous();
  }

  function handleNext() {
    spotifyService.next();
  }

  function handleSeek(event: MouseEvent) {
    if (!nowPlaying.track) return;
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const percent = (event.clientX - rect.left) / rect.width;
    const positionMs = Math.floor(percent * nowPlaying.track.durationMs);
    spotifyService.seek(positionMs);
    displayProgress = positionMs;
  }

  onMount(() => {
    spotifyService.initialize();
    // Register with centralized render coordinator (low priority)
    renderCoordinator.register(RENDER_ID, updateProgress, 'low');
  });

  onDestroy(() => {
    unsubAuth();
    unsubNowPlaying();
    renderCoordinator.unregister(RENDER_ID);
  });
</script>

<div class="spotify-panel">
  <div class="panel-header">
    <span class="title">SPOTIFY</span>
    {#if authStatus.connecting}
      <span class="status connecting">CONNECTING...</span>
    {:else if authStatus.connected}
      <button class="disconnect-btn" on:click={handleDisconnect}>DISCONNECT</button>
    {:else}
      <button class="connect-btn" on:click={handleConnect}>CONNECT</button>
    {/if}
  </div>

  {#if authStatus.connected}
    <div class="spotify-content">
      <!-- Left: Now Playing -->
      <div class="now-playing-section">
        {#if nowPlaying.track}
          <div class="album-art">
            {#if nowPlaying.track.albumArt}
              <img
                src={nowPlaying.track.albumArt}
                alt="Album art"
                crossorigin="anonymous"
                on:error={() => console.error('Failed to load album art:', nowPlaying.track?.albumArt)}
              />
            {:else}
              <div class="no-art">
                <span>No Art</span>
              </div>
            {/if}
          </div>
          <div class="track-info">
            <div class="track-name" title={nowPlaying.track.name}>{nowPlaying.track.name}</div>
            <div class="track-artist" title={nowPlaying.track.artist}>{nowPlaying.track.artist}</div>
            <div class="track-album" title={nowPlaying.track.album}>{nowPlaying.track.album}</div>
            <div class="track-progress">
              <span class="play-state">{nowPlaying.isPlaying ? '▶' : '⏸'}</span>
              <span class="progress-time">{formatTime(displayProgress)} / {formatTime(nowPlaying.track.durationMs)}</span>
            </div>
          </div>
        {:else}
          <div class="no-track">
            <span class="no-track-icon">🎵</span>
            <span class="no-track-text">No track playing</span>
          </div>
        {/if}
      </div>

      <!-- Right: Playback Controls -->
      <div class="controls-section">
        <div class="playback-controls">
          <button class="control-btn" on:click={handlePrevious} title="Previous">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
            </svg>
          </button>
          <button class="control-btn play-btn" on:click={handlePlayPause} title={nowPlaying.isPlaying ? 'Pause' : 'Play'}>
            {#if nowPlaying.isPlaying}
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
              </svg>
            {:else}
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
            {/if}
          </button>
          <button class="control-btn" on:click={handleNext} title="Next">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
            </svg>
          </button>
        </div>

        {#if nowPlaying.track}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div class="progress-bar-container" on:click={handleSeek}>
            <div class="progress-bar">
              <div
                class="progress-fill"
                style="width: {(displayProgress / nowPlaying.track.durationMs) * 100}%"
              ></div>
            </div>
            <div class="progress-times">
              <span>{formatTime(displayProgress)}</span>
              <span>{formatTime(nowPlaying.track.durationMs)}</span>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <!-- Disconnected state -->
    <div class="disconnected-state">
      <div class="spotify-logo">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
        </svg>
      </div>
      <span class="disconnected-text">Connect to Spotify to see what's playing</span>
      {#if authStatus.error}
        <div class="error-message">
          <svg class="error-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
          </svg>
          <span class="error-text">Spotify integration not configured</span>
          {#if authStatus.error.includes('credentials not configured')}
            <span class="error-hint">This feature requires Spotify API credentials. See documentation for setup instructions.</span>
          {:else}
            <span class="error-hint">{authStatus.error}</span>
          {/if}
        </div>
      {/if}
      {#if !authStatus.connecting}
        <button class="connect-btn-large" on:click={handleConnect}>
          Connect to Spotify
        </button>
      {:else}
        <span class="connecting-text">Opening Spotify login...</span>
      {/if}
    </div>
  {/if}

  <!-- Spotify Attribution (required by Spotify API terms) -->
  <div class="spotify-attribution">
    <span>Powered by</span>
    <svg class="spotify-logo-small" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
    </svg>
    <span>Spotify</span>
  </div>
</div>

<style>
  .spotify-panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-width: 280px;
    padding: 0.5rem 0.6rem;
    background: var(--bg-panel);
    border-radius: var(--border-radius);
    border: 1px solid var(--border-color);
    gap: 0.3rem;
    box-sizing: border-box;
    overflow: hidden;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 0.3rem;
    border-bottom: 1px solid var(--border-color);
  }

  .title {
    font-size: 0.7rem;
    font-weight: 500;
    color: var(--text-secondary);
    letter-spacing: 0.1em;
  }

  .status {
    font-size: 0.6rem;
    font-family: var(--font-mono);
    padding: 0.15rem 0.4rem;
    border-radius: 2px;
  }

  .status.connecting {
    color: var(--meter-yellow);
    background: rgba(234, 179, 8, 0.15);
  }

  .connect-btn, .disconnect-btn {
    font-size: 0.6rem;
    font-family: var(--font-mono);
    padding: 0.2rem 0.5rem;
    border-radius: 3px;
    border: none;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .connect-btn {
    background: #1DB954;
    color: white;
  }

  .connect-btn:hover {
    background: #1ed760;
  }

  .disconnect-btn {
    background: var(--bg-secondary);
    color: var(--text-muted);
    border: 1px solid var(--border-color);
  }

  .disconnect-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
  }

  .spotify-content {
    display: flex;
    gap: 1rem;
    flex: 1;
    min-height: 0;
  }

  /* Now Playing Section */
  .now-playing-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    flex: 1;
    min-width: 0;
    min-height: 0;
    padding: 0.25rem;
    overflow: hidden;
  }

  .album-art {
    width: auto;
    max-width: min(240px, 80%);
    max-height: calc(100% - 80px); /* Leave room for track info */
    aspect-ratio: 1;
    flex-shrink: 1;
    flex-grow: 0;
    border-radius: 4px;
    overflow: hidden;
    background: var(--bg-secondary);
    align-self: center;
  }

  .album-art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .no-art {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: 0.6rem;
  }

  .track-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.15rem;
    width: 100%;
    flex-shrink: 0;
    min-height: 60px;
  }

  .track-name {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.2;
    word-wrap: break-word;
    overflow-wrap: break-word;
    max-width: 100%;
  }

  .track-artist {
    font-size: 0.7rem;
    color: var(--text-secondary);
    line-height: 1.2;
    word-wrap: break-word;
    overflow-wrap: break-word;
    max-width: 100%;
  }

  .track-album {
    font-size: 0.6rem;
    color: var(--text-muted);
    line-height: 1.2;
    word-wrap: break-word;
    overflow-wrap: break-word;
    max-width: 100%;
  }

  .track-progress {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    margin-top: 0.2rem;
  }

  .play-state {
    font-size: 0.7rem;
    color: #1DB954;
  }

  .progress-time {
    font-size: 0.65rem;
    font-family: var(--font-mono);
    color: var(--text-muted);
  }

  .no-track {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 0.3rem;
    color: var(--text-muted);
  }

  .no-track-icon {
    font-size: 1.5rem;
    opacity: 0.5;
  }

  .no-track-text {
    font-size: 0.7rem;
  }

  /* Controls Section */
  .controls-section {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    min-width: 180px;
    padding-left: 0.75rem;
    border-left: 1px solid var(--border-color);
    gap: 0.5rem;
  }

  .playback-controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .control-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 50%;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .control-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  .control-btn svg {
    width: 16px;
    height: 16px;
  }

  .control-btn.play-btn {
    width: 40px;
    height: 40px;
    background: #1DB954;
    border-color: #1DB954;
    color: white;
  }

  .control-btn.play-btn:hover {
    background: #1ed760;
    border-color: #1ed760;
    color: white;
    transform: scale(1.05);
  }

  .control-btn.play-btn svg {
    width: 20px;
    height: 20px;
  }

  .progress-bar-container {
    width: 100%;
    cursor: pointer;
  }

  .progress-bar {
    height: 4px;
    background: var(--bg-secondary);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: #1DB954;
    border-radius: 2px;
    transition: width 0.1s linear;
  }

  .progress-bar-container:hover .progress-fill {
    background: #1ed760;
  }

  .progress-times {
    display: flex;
    justify-content: space-between;
    margin-top: 0.25rem;
    font-size: 0.55rem;
    font-family: var(--font-mono);
    color: var(--text-muted);
  }

  /* Disconnected State */
  .disconnected-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 0.75rem;
    color: var(--text-muted);
  }

  .spotify-logo {
    width: 40px;
    height: 40px;
    color: #1DB954;
    opacity: 0.6;
  }

  .disconnected-text {
    font-size: 0.7rem;
  }

  .connect-btn-large {
    padding: 0.5rem 1.25rem;
    font-size: 0.75rem;
    font-weight: 500;
    background: #1DB954;
    color: white;
    border: none;
    border-radius: 20px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .connect-btn-large:hover {
    background: #1ed760;
    transform: scale(1.02);
  }

  .connecting-text {
    font-size: 0.65rem;
    color: var(--meter-yellow);
  }

  /* Spotify Attribution - required by API terms */
  .spotify-attribution {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    padding: 0.25rem 0;
    margin-top: auto;
    font-size: 0.55rem;
    color: var(--text-muted);
    opacity: 0.7;
    border-top: 1px solid var(--border-color);
  }

  .spotify-logo-small {
    width: 12px;
    height: 12px;
    color: #1DB954;
  }

  /* Error message styling */
  .error-message {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    padding: 0.6rem 0.8rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 4px;
    max-width: 90%;
  }

  .error-icon {
    width: 20px;
    height: 20px;
    color: #ef4444;
  }

  .error-text {
    font-size: 0.65rem;
    color: #ef4444;
    text-align: center;
    line-height: 1.4;
  }

  .error-hint {
    font-size: 0.6rem;
    color: var(--text-muted);
    text-align: center;
    font-family: var(--font-mono);
    line-height: 1.3;
  }
</style>
