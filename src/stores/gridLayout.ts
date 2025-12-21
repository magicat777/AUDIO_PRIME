/**
 * Grid Layout Store - Manages panel positions and sizes for drag/resize
 *
 * Uses a virtual grid system where panels snap to grid cells.
 * Positions are stored as grid coordinates, converted to pixels at render time.
 * Supports proportional scaling when window size changes (e.g., fullscreen).
 */
import { writable, derived, get } from 'svelte/store';

// Grid configuration
export const GRID_CONFIG = {
  cellSize: 20,           // Base grid cell size in pixels
  snapThreshold: 15,      // Pixels before snap kicks in (increased for easier snapping)
  minPanelWidth: 160,     // Minimum panel width (8 cells)
  minPanelHeight: 100,    // Minimum panel height (5 cells)
  gap: 8,                 // Gap between panels in pixels
  padding: 8,             // Container padding in pixels
} as const;

// Reference dimensions for proportional scaling
// These represent the "design size" at which default layouts look correct
// Extended to provide more room at edges for panel snapping
export const REFERENCE_DIMENSIONS = {
  width: 1760,   // Reference container width (88 cols * 20px)
  height: 1400,  // Reference container height (70 rows * 20px)
} as const;

// Scale state for proportional panel scaling
export interface ScaleState {
  containerWidth: number;
  containerHeight: number;
  scaleX: number;
  scaleY: number;
  isFullscreen: boolean;
}

// User preset for saving/loading layouts
export interface LayoutPreset {
  name: string;
  panels: Record<string, PanelLayout>;
  createdAt: number;
}

// Maximum number of presets
const MAX_PRESETS = 5;

// Panel position and size (in grid cells, not pixels)
export interface PanelLayout {
  id: string;
  x: number;           // Grid column position
  y: number;           // Grid row position
  width: number;       // Width in grid cells
  height: number;      // Height in grid cells
  zIndex: number;      // Stacking order
  locked: boolean;     // Prevent drag/resize
}

// Default layouts for each panel (position in grid cells)
// Grid is roughly 85 columns x 64 rows at 1700x1280 with 20px cells
const defaultLayouts: Record<string, Omit<PanelLayout, 'id'>> = {
  // Top row - main visualizers
  spectrum: { x: 0, y: 0, width: 46, height: 28, zIndex: 1, locked: false },
  bassDetail: { x: 46, y: 0, width: 25, height: 28, zIndex: 1, locked: false },
  debug: { x: 71, y: 0, width: 14, height: 41, zIndex: 1, locked: false },

  // Second row - meters
  vuMeters: { x: 0, y: 28, width: 24, height: 13, zIndex: 1, locked: false },
  lufsMetering: { x: 24, y: 28, width: 22, height: 13, zIndex: 1, locked: false },
  goniometer: { x: 46, y: 28, width: 12, height: 13, zIndex: 1, locked: false },
  stereoCorrelation: { x: 58, y: 28, width: 13, height: 13, zIndex: 1, locked: false },

  // Third row
  bpmTempo: { x: 0, y: 41, width: 13, height: 14, zIndex: 1, locked: false },
  oscilloscope: { x: 13, y: 41, width: 33, height: 14, zIndex: 1, locked: false },
  spotify: { x: 46, y: 41, width: 25, height: 23, zIndex: 1, locked: false },

  // Bottom row
  voiceDetection: { x: 0, y: 55, width: 46, height: 9, zIndex: 1, locked: false },
  frequencyBands: { x: 46, y: 55, width: 22, height: 13, zIndex: 1, locked: false },
};

export type PanelId = keyof typeof defaultLayouts;

export interface GridLayoutState {
  panels: Record<string, PanelLayout>;
  activePanel: string | null;      // Currently being dragged/resized
  gridVisible: boolean;            // Show grid overlay for alignment
  snapEnabled: boolean;            // Enable snap-to-grid
  scale: ScaleState;               // Scaling state for proportional layouts
  presets: LayoutPreset[];         // User-saved layout presets
}

const defaultState: GridLayoutState = {
  panels: Object.fromEntries(
    Object.entries(defaultLayouts).map(([id, layout]) => [id, { id, ...layout }])
  ),
  activePanel: null,
  gridVisible: false,
  snapEnabled: true,
  scale: {
    containerWidth: REFERENCE_DIMENSIONS.width,
    containerHeight: REFERENCE_DIMENSIONS.height,
    scaleX: 1,
    scaleY: 1,
    isFullscreen: false,
  },
  presets: [],
};

// Load from localStorage
function loadFromStorage(): GridLayoutState {
  if (typeof window !== 'undefined' && window.localStorage) {
    const stored = localStorage.getItem('audio-prime-grid-layout');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Merge with defaults to handle new panels
        // For each default panel, use stored values if they exist and have valid position
        const mergedPanels: Record<string, PanelLayout> = {};
        for (const [id, defaultPanel] of Object.entries(defaultState.panels)) {
          const storedPanel = parsed.panels?.[id];
          if (storedPanel && typeof storedPanel.x === 'number' && typeof storedPanel.width === 'number') {
            // Use stored panel but ensure it has the id
            mergedPanels[id] = { ...defaultPanel, ...storedPanel, id };
          } else {
            // New panel or invalid stored data - use defaults
            mergedPanels[id] = defaultPanel;
          }
        }
        return {
          ...defaultState,
          ...parsed,
          panels: mergedPanels,
          // Always reset scale state on load (don't persist fullscreen state)
          scale: defaultState.scale,
          // Load presets if available
          presets: Array.isArray(parsed.presets) ? parsed.presets : [],
        };
      } catch {
        return defaultState;
      }
    }
  }
  return defaultState;
}

// Save to localStorage
function saveToStorage(state: GridLayoutState) {
  if (typeof window !== 'undefined' && window.localStorage) {
    localStorage.setItem('audio-prime-grid-layout', JSON.stringify(state));
  }
}

// Create the store
function createGridLayoutStore() {
  const { subscribe, set, update } = writable<GridLayoutState>(loadFromStorage());

  return {
    subscribe,

    // Convert grid coordinates to pixel position
    gridToPixels: (gridX: number, gridY: number): { x: number; y: number } => ({
      x: gridX * GRID_CONFIG.cellSize + GRID_CONFIG.padding,
      y: gridY * GRID_CONFIG.cellSize + GRID_CONFIG.padding,
    }),

    // Convert pixel position to grid coordinates (with snap)
    pixelsToGrid: (pixelX: number, pixelY: number, snap = true): { x: number; y: number } => {
      const rawX = (pixelX - GRID_CONFIG.padding) / GRID_CONFIG.cellSize;
      const rawY = (pixelY - GRID_CONFIG.padding) / GRID_CONFIG.cellSize;

      if (snap) {
        return {
          x: Math.round(rawX),
          y: Math.round(rawY),
        };
      }
      return { x: rawX, y: rawY };
    },

    // Convert grid dimensions to pixel dimensions
    // Panels extend to grid lines; gap is handled by panel positioning, not size reduction
    sizeToPixels: (gridWidth: number, gridHeight: number): { width: number; height: number } => ({
      width: gridWidth * GRID_CONFIG.cellSize,
      height: gridHeight * GRID_CONFIG.cellSize,
    }),

    // Update panel position (during drag)
    updatePosition: (panelId: string, x: number, y: number) => {
      update(state => {
        const panel = state.panels[panelId];
        if (!panel || panel.locked) return state;

        // Always store whole numbers to prevent fractional grid positions
        const newState = {
          ...state,
          panels: {
            ...state.panels,
            [panelId]: { ...panel, x: Math.round(x), y: Math.round(y) },
          },
        };
        saveToStorage(newState);
        return newState;
      });
    },

    // Update panel size (during resize)
    updateSize: (panelId: string, width: number, height: number) => {
      update(state => {
        const panel = state.panels[panelId];
        if (!panel || panel.locked) return state;

        // Enforce minimum sizes and always store whole numbers
        const minWidthCells = Math.ceil(GRID_CONFIG.minPanelWidth / GRID_CONFIG.cellSize);
        const minHeightCells = Math.ceil(GRID_CONFIG.minPanelHeight / GRID_CONFIG.cellSize);

        const newState = {
          ...state,
          panels: {
            ...state.panels,
            [panelId]: {
              ...panel,
              width: Math.round(Math.max(minWidthCells, width)),
              height: Math.round(Math.max(minHeightCells, height)),
            },
          },
        };
        saveToStorage(newState);
        return newState;
      });
    },

    // Set active panel (being dragged/resized)
    setActivePanel: (panelId: string | null) => {
      update(state => ({ ...state, activePanel: panelId }));
    },

    // Bring panel to front
    bringToFront: (panelId: string) => {
      update(state => {
        const maxZ = Math.max(...Object.values(state.panels).map(p => p.zIndex));
        const newState = {
          ...state,
          panels: {
            ...state.panels,
            [panelId]: { ...state.panels[panelId], zIndex: maxZ + 1 },
          },
        };
        saveToStorage(newState);
        return newState;
      });
    },

    // Toggle panel lock
    toggleLock: (panelId: string) => {
      update(state => {
        const panel = state.panels[panelId];
        if (!panel) return state;

        const newState = {
          ...state,
          panels: {
            ...state.panels,
            [panelId]: { ...panel, locked: !panel.locked },
          },
        };
        saveToStorage(newState);
        return newState;
      });
    },

    // Lock all panels
    lockAll: () => {
      update(state => {
        const newPanels = { ...state.panels };
        for (const id of Object.keys(newPanels)) {
          newPanels[id] = { ...newPanels[id], locked: true };
        }
        const newState = { ...state, panels: newPanels };
        saveToStorage(newState);
        return newState;
      });
    },

    // Unlock all panels
    unlockAll: () => {
      update(state => {
        const newPanels = { ...state.panels };
        for (const id of Object.keys(newPanels)) {
          newPanels[id] = { ...newPanels[id], locked: false };
        }
        const newState = { ...state, panels: newPanels };
        saveToStorage(newState);
        return newState;
      });
    },

    // Check if all panels are locked
    areAllLocked: (): boolean => {
      const state = get({ subscribe });
      return Object.values(state.panels).every(p => p.locked);
    },

    // Toggle grid visibility
    toggleGrid: () => {
      update(state => {
        const newState = { ...state, gridVisible: !state.gridVisible };
        saveToStorage(newState);
        return newState;
      });
    },

    // Toggle snap-to-grid
    toggleSnap: () => {
      update(state => {
        const newState = { ...state, snapEnabled: !state.snapEnabled };
        saveToStorage(newState);
        return newState;
      });
    },

    // Reset to default layout
    reset: () => {
      set(defaultState);
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.removeItem('audio-prime-grid-layout');
      }
    },

    // Get panel by ID
    getPanel: (panelId: string): PanelLayout | undefined => {
      return get({ subscribe }).panels[panelId];
    },

    // Update container size and recalculate scale factors
    setContainerSize: (containerWidth: number, containerHeight: number) => {
      update(state => {
        const scaleX = containerWidth / REFERENCE_DIMENSIONS.width;
        const scaleY = containerHeight / REFERENCE_DIMENSIONS.height;

        return {
          ...state,
          scale: {
            ...state.scale,
            containerWidth,
            containerHeight,
            scaleX,
            scaleY,
          },
        };
      });
    },

    // Set fullscreen state
    setFullscreen: (isFullscreen: boolean) => {
      update(state => ({
        ...state,
        scale: {
          ...state.scale,
          isFullscreen,
        },
      }));
    },

    // Auto-arrange panels in a grid pattern
    autoArrange: (visiblePanelIds: string[]) => {
      update(state => {
        const count = visiblePanelIds.length;
        if (count === 0) return state;

        // Calculate grid dimensions in reference coordinates
        const availableWidth = Math.floor(REFERENCE_DIMENSIONS.width / GRID_CONFIG.cellSize);
        const availableHeight = Math.floor(REFERENCE_DIMENSIONS.height / GRID_CONFIG.cellSize);

        // Calculate optimal grid layout
        const cols = Math.ceil(Math.sqrt(count));
        const rows = Math.ceil(count / cols);

        // Calculate cell size in grid units (leave gap for spacing)
        const cellWidth = Math.floor((availableWidth - 2) / cols);
        const cellHeight = Math.floor((availableHeight - 2) / rows);

        // Minimum sizes in grid cells
        const minWidthCells = Math.ceil(GRID_CONFIG.minPanelWidth / GRID_CONFIG.cellSize);
        const minHeightCells = Math.ceil(GRID_CONFIG.minPanelHeight / GRID_CONFIG.cellSize);

        // Arrange panels
        const newPanels = { ...state.panels };
        visiblePanelIds.forEach((id, index) => {
          const col = index % cols;
          const row = Math.floor(index / cols);

          const panel = newPanels[id];
          if (panel) {
            newPanels[id] = {
              ...panel,
              x: col * cellWidth + 1, // +1 for padding
              y: row * cellHeight + 1,
              width: Math.max(minWidthCells, cellWidth - 1),
              height: Math.max(minHeightCells, cellHeight - 1),
              locked: false,
            };
          }
        });

        const newState = { ...state, panels: newPanels };
        saveToStorage(newState);
        return newState;
      });
    },

    // Get current scale factors
    getScale: (): ScaleState => {
      return get({ subscribe }).scale;
    },

    // Save current layout as a preset
    savePreset: (name: string) => {
      update(state => {
        // Create a deep copy of current panels
        const panelsCopy = JSON.parse(JSON.stringify(state.panels));

        const newPreset: LayoutPreset = {
          name: name.trim() || `Preset ${state.presets.length + 1}`,
          panels: panelsCopy,
          createdAt: Date.now(),
        };

        // Add new preset (limit to MAX_PRESETS)
        let presets = [...state.presets, newPreset];
        if (presets.length > MAX_PRESETS) {
          presets = presets.slice(-MAX_PRESETS);
        }

        const newState = { ...state, presets };
        saveToStorage(newState);
        return newState;
      });
    },

    // Load a preset by index
    loadPreset: (index: number) => {
      update(state => {
        const preset = state.presets[index];
        if (!preset) return state;

        // Deep copy the preset panels
        const panelsCopy = JSON.parse(JSON.stringify(preset.panels));

        const newState = { ...state, panels: panelsCopy };
        saveToStorage(newState);
        return newState;
      });
    },

    // Delete a preset by index
    deletePreset: (index: number) => {
      update(state => {
        const presets = state.presets.filter((_, i) => i !== index);
        const newState = { ...state, presets };
        saveToStorage(newState);
        return newState;
      });
    },

    // Get all presets
    getPresets: (): LayoutPreset[] => {
      return get({ subscribe }).presets;
    },
  };
}

export const gridLayout = createGridLayoutStore();

// Derived store for just the panels (for reactive updates)
export const panelLayouts = derived(gridLayout, $grid => $grid.panels);

// Derived store for scale state
export const scaleState = derived(gridLayout, $grid => $grid.scale);

// Derived store for presets
export const layoutPresets = derived(gridLayout, $grid => $grid.presets);

// Derived store for scaled panel layouts (applies scale factors for rendering)
// Positions stay fixed on grid; only SIZES scale with window
// Uses uniform scale factor to maintain panel aspect ratios
export const scaledPanelLayouts = derived(gridLayout, $grid => {
  const { scaleX, scaleY, containerWidth, containerHeight } = $grid.scale;
  const minWidthCells = Math.ceil(GRID_CONFIG.minPanelWidth / GRID_CONFIG.cellSize);
  const minHeightCells = Math.ceil(GRID_CONFIG.minPanelHeight / GRID_CONFIG.cellSize);

  // Use uniform scale (minimum) to keep panels proportional
  const uniformScale = Math.min(scaleX, scaleY);

  // Calculate available grid cells based on current container size
  const maxGridX = Math.floor((containerWidth - GRID_CONFIG.padding * 2) / GRID_CONFIG.cellSize);
  const maxGridY = Math.floor((containerHeight - GRID_CONFIG.padding * 2) / GRID_CONFIG.cellSize);

  const scaledPanels: Record<string, PanelLayout> = {};

  for (const [id, panel] of Object.entries($grid.panels)) {
    // Scale dimensions using uniform scale factor
    const scaledWidth = Math.max(minWidthCells, Math.round(panel.width * uniformScale));
    const scaledHeight = Math.max(minHeightCells, Math.round(panel.height * uniformScale));

    // Positions stay fixed (no scaling) - panels stay on their grid positions
    let x = panel.x;
    let y = panel.y;

    // Clamp positions so panels don't extend beyond visible bounds
    if (x + scaledWidth > maxGridX) {
      x = Math.max(0, maxGridX - scaledWidth);
    }
    if (y + scaledHeight > maxGridY) {
      y = Math.max(0, maxGridY - scaledHeight);
    }

    scaledPanels[id] = {
      ...panel,
      x,
      y,
      width: scaledWidth,
      height: scaledHeight,
    };
  }

  return scaledPanels;
});
