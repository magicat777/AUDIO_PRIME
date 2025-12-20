<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { gridLayout, GRID_CONFIG } from '../../stores/gridLayout';

  // Container dimensions for grid rendering
  let containerElement: HTMLDivElement;
  let containerWidth = 0;
  let containerHeight = 0;

  $: gridVisible = $gridLayout.gridVisible;
  $: snapEnabled = $gridLayout.snapEnabled;

  // Calculate grid line counts
  $: columns = Math.floor((containerWidth - GRID_CONFIG.padding * 2) / GRID_CONFIG.cellSize);
  $: rows = Math.floor((containerHeight - GRID_CONFIG.padding * 2) / GRID_CONFIG.cellSize);

  // Create grid line arrays for rendering
  $: verticalLines = gridVisible ? Array.from({ length: columns + 1 }, (_, i) => i) : [];
  $: horizontalLines = gridVisible ? Array.from({ length: rows + 1 }, (_, i) => i) : [];

  // ResizeObserver for container dimensions
  let resizeObserver: ResizeObserver | null = null;

  onMount(() => {
    if (!containerElement) return;

    // Initial size
    containerWidth = containerElement.clientWidth;
    containerHeight = containerElement.clientHeight;

    // Watch for resize
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerWidth = entry.contentRect.width;
        containerHeight = entry.contentRect.height;
      }
    });
    resizeObserver.observe(containerElement);
  });

  onDestroy(() => {
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
  });

  // Keyboard shortcuts for grid controls
  function handleKeydown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }

    switch (e.key.toLowerCase()) {
      case 'g':
        if (e.shiftKey) {
          // Shift+G: Toggle grid visibility
          gridLayout.toggleGrid();
          e.preventDefault();
        }
        break;
      case 's':
        if (e.shiftKey && e.ctrlKey) {
          // Ctrl+Shift+S: Toggle snap
          gridLayout.toggleSnap();
          e.preventDefault();
        }
        break;
      case 'r':
        if (e.shiftKey && e.ctrlKey) {
          // Ctrl+Shift+R: Reset layout
          gridLayout.reset();
          e.preventDefault();
        }
        break;
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });
</script>

<div
  bind:this={containerElement}
  class="grid-layout-container"
  class:grid-visible={gridVisible}
>
  <!-- Grid overlay (rendered when visible) -->
  {#if gridVisible}
    <svg class="grid-overlay" aria-hidden="true">
      <!-- Vertical lines -->
      {#each verticalLines as i}
        <line
          x1={GRID_CONFIG.padding + i * GRID_CONFIG.cellSize}
          y1={GRID_CONFIG.padding}
          x2={GRID_CONFIG.padding + i * GRID_CONFIG.cellSize}
          y2={containerHeight - GRID_CONFIG.padding}
          class="grid-line"
          class:grid-line-major={i % 5 === 0}
        />
      {/each}

      <!-- Horizontal lines -->
      {#each horizontalLines as i}
        <line
          x1={GRID_CONFIG.padding}
          y1={GRID_CONFIG.padding + i * GRID_CONFIG.cellSize}
          x2={containerWidth - GRID_CONFIG.padding}
          y2={GRID_CONFIG.padding + i * GRID_CONFIG.cellSize}
          class="grid-line"
          class:grid-line-major={i % 5 === 0}
        />
      {/each}
    </svg>
  {/if}

  <!-- Panels slot -->
  <div class="panels-container">
    <slot />
  </div>

  <!-- Grid status indicator -->
  <div class="grid-status">
    {#if gridVisible}
      <span class="status-badge status-grid">GRID</span>
    {/if}
    {#if snapEnabled}
      <span class="status-badge status-snap">SNAP</span>
    {/if}
  </div>
</div>

<style>
  .grid-layout-container {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--bg-primary);
  }

  .grid-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 0;
  }

  .grid-line {
    stroke: rgba(255, 255, 255, 0.04);
    stroke-width: 1;
  }

  .grid-line-major {
    stroke: rgba(255, 255, 255, 0.08);
  }

  .panels-container {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 1;
  }

  .grid-status {
    position: absolute;
    bottom: 8px;
    right: 8px;
    display: flex;
    gap: 4px;
    z-index: 1000;
    pointer-events: none;
  }

  .status-badge {
    font-size: 0.55rem;
    font-family: var(--font-mono);
    padding: 2px 6px;
    border-radius: 3px;
    letter-spacing: 0.1em;
    font-weight: 600;
  }

  .status-grid {
    background: rgba(74, 144, 226, 0.3);
    color: rgb(74, 144, 226);
    border: 1px solid rgba(74, 144, 226, 0.5);
  }

  .status-snap {
    background: rgba(74, 220, 150, 0.3);
    color: rgb(74, 220, 150);
    border: 1px solid rgba(74, 220, 150, 0.5);
  }
</style>
