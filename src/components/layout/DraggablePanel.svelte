<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import interact from 'interactjs';
  import { gridLayout, GRID_CONFIG, type PanelId } from '../../stores/gridLayout';

  // Props
  export let panelId: PanelId;
  export let title: string = '';

  // Local state
  let panelElement: HTMLDivElement;
  let interactable: ReturnType<typeof interact> | null = null;
  let isDragging = false;
  let isResizing = false;

  // Reactive panel data from store
  $: panel = $gridLayout.panels[panelId];
  $: isActive = $gridLayout.activePanel === panelId;
  $: snapEnabled = $gridLayout.snapEnabled;

  // Calculate pixel position and size from grid coordinates
  $: pixelPos = panel ? gridLayout.gridToPixels(panel.x, panel.y) : { x: 0, y: 0 };
  $: pixelSize = panel ? gridLayout.sizeToPixels(panel.width, panel.height) : { width: 200, height: 150 };

  // Style string for positioning
  $: panelStyle = panel ? `
    left: ${pixelPos.x}px;
    top: ${pixelPos.y}px;
    width: ${pixelSize.width}px;
    height: ${pixelSize.height}px;
    z-index: ${panel.zIndex + (isActive ? 100 : 0)};
  ` : '';

  onMount(() => {
    if (!panelElement || !panel) return;

    // Initialize interact.js
    interactable = interact(panelElement)
      .draggable({
        inertia: false,
        modifiers: snapEnabled ? [
          interact.modifiers.snap({
            targets: [
              interact.snappers.grid({
                x: GRID_CONFIG.cellSize,
                y: GRID_CONFIG.cellSize,
              }),
            ],
            range: GRID_CONFIG.snapThreshold,
            relativePoints: [{ x: 0, y: 0 }],
          }),
        ] : [],
        autoScroll: false,
        // Use the drag handle, not the entire panel
        allowFrom: '.drag-handle',
        listeners: {
          start: () => {
            isDragging = true;
            gridLayout.setActivePanel(panelId);
            gridLayout.bringToFront(panelId);
            // Add will-change for GPU compositing during drag
            panelElement.style.willChange = 'transform';
          },
          move: (event) => {
            if (panel?.locked) return;

            // During drag, use CSS transform for performance (GPU layer)
            const target = event.target as HTMLElement;
            const x = (parseFloat(target.getAttribute('data-x') || '0')) + event.dx;
            const y = (parseFloat(target.getAttribute('data-y') || '0')) + event.dy;

            target.style.transform = `translate(${x}px, ${y}px)`;
            target.setAttribute('data-x', String(x));
            target.setAttribute('data-y', String(y));
          },
          end: (event) => {
            isDragging = false;
            gridLayout.setActivePanel(null);
            panelElement.style.willChange = '';

            // Calculate final grid position
            const target = event.target as HTMLElement;
            const x = parseFloat(target.getAttribute('data-x') || '0');
            const y = parseFloat(target.getAttribute('data-y') || '0');

            // Convert to grid coordinates and update store
            const newGridPos = gridLayout.pixelsToGrid(
              pixelPos.x + x,
              pixelPos.y + y,
              snapEnabled
            );

            // Reset transform and update actual position
            target.style.transform = '';
            target.removeAttribute('data-x');
            target.removeAttribute('data-y');

            // Update store (this triggers reactive update)
            gridLayout.updatePosition(panelId, Math.max(0, newGridPos.x), Math.max(0, newGridPos.y));
          },
        },
      })
      .resizable({
        edges: { left: false, right: true, bottom: true, top: false },
        modifiers: snapEnabled ? [
          interact.modifiers.snap({
            targets: [
              interact.snappers.grid({
                x: GRID_CONFIG.cellSize,
                y: GRID_CONFIG.cellSize,
              }),
            ],
            range: GRID_CONFIG.snapThreshold,
          }),
          interact.modifiers.restrictSize({
            min: {
              width: GRID_CONFIG.minPanelWidth,
              height: GRID_CONFIG.minPanelHeight,
            },
          }),
        ] : [
          interact.modifiers.restrictSize({
            min: {
              width: GRID_CONFIG.minPanelWidth,
              height: GRID_CONFIG.minPanelHeight,
            },
          }),
        ],
        listeners: {
          start: () => {
            isResizing = true;
            gridLayout.setActivePanel(panelId);
            gridLayout.bringToFront(panelId);
            panelElement.style.willChange = 'width, height';
          },
          move: (event) => {
            if (panel?.locked) return;

            // During resize, update dimensions directly (still performant)
            const target = event.target as HTMLElement;
            target.style.width = `${event.rect.width}px`;
            target.style.height = `${event.rect.height}px`;
          },
          end: (event) => {
            isResizing = false;
            gridLayout.setActivePanel(null);
            panelElement.style.willChange = '';

            // Convert to grid cells and update store
            const newWidth = Math.round((event.rect.width + GRID_CONFIG.gap) / GRID_CONFIG.cellSize);
            const newHeight = Math.round((event.rect.height + GRID_CONFIG.gap) / GRID_CONFIG.cellSize);

            gridLayout.updateSize(panelId, newWidth, newHeight);
          },
        },
      });
  });

  onDestroy(() => {
    if (interactable) {
      interactable.unset();
    }
  });

  function handleDoubleClick() {
    gridLayout.toggleLock(panelId);
  }
</script>

{#if panel}
  <div
    bind:this={panelElement}
    class="draggable-panel"
    class:is-dragging={isDragging}
    class:is-resizing={isResizing}
    class:is-active={isActive}
    class:is-locked={panel.locked}
    style={panelStyle}
    role="region"
    aria-label={title || panelId}
  >
    <!-- Drag handle (title bar) -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="drag-handle" on:dblclick={handleDoubleClick}>
      {#if panel.locked}
        <span class="lock-icon" title="Locked - double-click to unlock">🔒</span>
      {/if}
      {#if title}
        <span class="panel-title">{title}</span>
      {/if}
      <div class="drag-indicator">⋮⋮</div>
    </div>

    <!-- Panel content -->
    <div class="panel-content">
      <slot />
    </div>

    <!-- Resize handle (bottom-right corner) -->
    {#if !panel.locked}
      <div class="resize-handle" aria-hidden="true">
        <svg viewBox="0 0 10 10" class="resize-icon">
          <path d="M8,0 L10,0 L10,10 L0,10 L0,8 L8,8 Z" fill="currentColor" opacity="0.3" />
          <line x1="3" y1="10" x2="10" y2="3" stroke="currentColor" stroke-width="1" opacity="0.5" />
          <line x1="6" y1="10" x2="10" y2="6" stroke="currentColor" stroke-width="1" opacity="0.5" />
        </svg>
      </div>
    {/if}
  </div>
{/if}

<style>
  .draggable-panel {
    position: absolute;
    display: flex;
    flex-direction: column;
    background: var(--bg-panel);
    border-radius: var(--border-radius);
    border: 1px solid var(--border-color);
    overflow: hidden;
    user-select: none;
    touch-action: none;
    transition: box-shadow 0.15s ease;
  }

  .draggable-panel.is-active {
    box-shadow: 0 0 0 2px var(--accent-color), 0 8px 24px rgba(0, 0, 0, 0.4);
  }

  .draggable-panel.is-dragging {
    cursor: grabbing;
    opacity: 0.9;
  }

  .draggable-panel.is-resizing {
    cursor: se-resize;
  }

  .draggable-panel.is-locked {
    border-color: rgba(255, 200, 50, 0.3);
  }

  .drag-handle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.5rem;
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid var(--border-color);
    cursor: grab;
    min-height: 22px;
  }

  .drag-handle:active {
    cursor: grabbing;
  }

  .is-locked .drag-handle {
    cursor: default;
  }

  .lock-icon {
    font-size: 0.65rem;
    opacity: 0.6;
  }

  .panel-title {
    font-size: 0.6rem;
    font-weight: 500;
    color: var(--text-muted);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .drag-indicator {
    margin-left: auto;
    font-size: 0.7rem;
    color: var(--text-muted);
    opacity: 0.4;
    letter-spacing: 1px;
  }

  .is-locked .drag-indicator {
    display: none;
  }

  .panel-content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .resize-handle {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 16px;
    height: 16px;
    cursor: se-resize;
    color: var(--text-muted);
  }

  .resize-icon {
    width: 100%;
    height: 100%;
  }

  .is-locked .resize-handle {
    display: none;
  }

  /* During drag/resize, prevent child interactions */
  .is-dragging .panel-content,
  .is-resizing .panel-content {
    pointer-events: none;
  }
</style>
