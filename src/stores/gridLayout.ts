/**
 * Grid Layout Store - Manages panel positions and sizes for drag/resize
 *
 * Uses a virtual grid system where panels snap to grid cells.
 * Positions are stored as grid coordinates, converted to pixels at render time.
 */
import { writable, derived, get } from 'svelte/store';

// Grid configuration
export const GRID_CONFIG = {
  cellSize: 20,           // Base grid cell size in pixels
  snapThreshold: 10,      // Pixels before snap kicks in
  minPanelWidth: 160,     // Minimum panel width (8 cells)
  minPanelHeight: 100,    // Minimum panel height (5 cells)
  gap: 8,                 // Gap between panels in pixels
  padding: 8,             // Container padding in pixels
} as const;

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
};

export type PanelId = keyof typeof defaultLayouts;

export interface GridLayoutState {
  panels: Record<string, PanelLayout>;
  activePanel: string | null;      // Currently being dragged/resized
  gridVisible: boolean;            // Show grid overlay for alignment
  snapEnabled: boolean;            // Enable snap-to-grid
}

const defaultState: GridLayoutState = {
  panels: Object.fromEntries(
    Object.entries(defaultLayouts).map(([id, layout]) => [id, { id, ...layout }])
  ),
  activePanel: null,
  gridVisible: false,
  snapEnabled: true,
};

// Load from localStorage
function loadFromStorage(): GridLayoutState {
  if (typeof window !== 'undefined' && window.localStorage) {
    const stored = localStorage.getItem('audio-prime-grid-layout');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Merge with defaults to handle new panels
        return {
          ...defaultState,
          ...parsed,
          panels: {
            ...defaultState.panels,
            ...parsed.panels,
          },
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
    sizeToPixels: (gridWidth: number, gridHeight: number): { width: number; height: number } => ({
      width: gridWidth * GRID_CONFIG.cellSize - GRID_CONFIG.gap,
      height: gridHeight * GRID_CONFIG.cellSize - GRID_CONFIG.gap,
    }),

    // Update panel position (during drag)
    updatePosition: (panelId: string, x: number, y: number) => {
      update(state => {
        const panel = state.panels[panelId];
        if (!panel || panel.locked) return state;

        const newState = {
          ...state,
          panels: {
            ...state.panels,
            [panelId]: { ...panel, x, y },
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

        // Enforce minimum sizes
        const minWidthCells = Math.ceil(GRID_CONFIG.minPanelWidth / GRID_CONFIG.cellSize);
        const minHeightCells = Math.ceil(GRID_CONFIG.minPanelHeight / GRID_CONFIG.cellSize);

        const newState = {
          ...state,
          panels: {
            ...state.panels,
            [panelId]: {
              ...panel,
              width: Math.max(minWidthCells, width),
              height: Math.max(minHeightCells, height),
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
  };
}

export const gridLayout = createGridLayoutStore();

// Derived store for just the panels (for reactive updates)
export const panelLayouts = derived(gridLayout, $grid => $grid.panels);
