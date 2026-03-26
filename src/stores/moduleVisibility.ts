/**
 * Module visibility store - controls which panels are shown/hidden
 *
 * Persists to both localStorage (sync, for fast startup) and file system
 * via Electron IPC (durable across installations).
 */
import { writable, get } from 'svelte/store';

export interface ModuleVisibility {
  spectrum: boolean;
  vuMeters: boolean;
  bassDetail: boolean;
  waterfall: boolean;
  lufsMetering: boolean;
  bpmTempo: boolean;
  voiceDetection: boolean;
  stereoCorrelation: boolean;
  goniometer: boolean;
  oscilloscope: boolean;
  frequencyBands: boolean;
  debug: boolean;
  spotify: boolean;
  // 3D Visualizations (v1.2)
  cylindricalBars: boolean;
  waterfall3d: boolean;
  frequencySphere: boolean;
  stereoSpace3d: boolean;
  tunnel: boolean;
  terrain: boolean;
}

const defaultVisibility: ModuleVisibility = {
  spectrum: true,      // Core - always visible by default
  vuMeters: true,      // Core - always visible by default
  bassDetail: true,    // Toggleable
  waterfall: true,     // Toggleable (within bass detail)
  lufsMetering: true,  // Toggleable
  bpmTempo: true,      // Toggleable
  voiceDetection: true, // Toggleable
  stereoCorrelation: true, // Stereo analysis
  goniometer: true,    // Stereo field display
  oscilloscope: true,  // Waveform display
  frequencyBands: true, // Frequency band analyzer
  debug: true,         // Toggleable
  spotify: true,       // Spotify integration
  // 3D Visualizations - opt-in by default
  cylindricalBars: false,
  waterfall3d: false,
  frequencySphere: false,
  stereoSpace3d: false,
  tunnel: false,
  terrain: false,
};

// Core modules that should always have at least one visible
const CORE_MODULES: (keyof ModuleVisibility)[] = ['spectrum', 'vuMeters', 'bassDetail'];

// Ensure at least one core module is visible
function ensureMinimumVisibility(state: ModuleVisibility): ModuleVisibility {
  const hasVisibleCore = CORE_MODULES.some(m => state[m]);
  if (!hasVisibleCore) {
    // If no core modules visible, enable spectrum as fallback
    return { ...state, spectrum: true };
  }
  return state;
}

// Load from localStorage if available
function loadFromStorage(): ModuleVisibility {
  if (typeof window !== 'undefined' && window.localStorage) {
    const stored = localStorage.getItem('audio-prime-modules');
    if (stored) {
      try {
        const parsed = { ...defaultVisibility, ...JSON.parse(stored) };
        return ensureMinimumVisibility(parsed);
      } catch {
        return defaultVisibility;
      }
    }
  }
  return defaultVisibility;
}

// Save to both localStorage and file system
function saveToStorage(state: ModuleVisibility) {
  if (typeof window !== 'undefined') {
    // localStorage — immediate
    if (window.localStorage) {
      localStorage.setItem('audio-prime-modules', JSON.stringify(state));
    }
    // File system via Electron IPC — durable
    if (window.electronAPI?.visibility) {
      window.electronAPI.visibility.save(state).catch((error: unknown) => {
        console.error('Error saving visibility to file:', error);
      });
    }
  }
}

// Load from file via Electron IPC (async)
async function loadFromFile(): Promise<ModuleVisibility | null> {
  if (typeof window !== 'undefined' && window.electronAPI?.visibility) {
    try {
      const result = await window.electronAPI.visibility.load();
      if (result.success && result.data) {
        const parsed = { ...defaultVisibility, ...(result.data as Partial<ModuleVisibility>) };
        return ensureMinimumVisibility(parsed);
      }
    } catch (error) {
      console.error('Error loading visibility from file:', error);
    }
  }
  return null;
}

// Create the store
function createModuleVisibilityStore() {
  const localState = loadFromStorage();
  const { subscribe, set, update } = writable<ModuleVisibility>(localState);

  // Async load from file and merge (file wins if it has data, since it's durable)
  if (typeof window !== 'undefined') {
    loadFromFile().then((fileState) => {
      if (fileState) {
        set(fileState);
        // Sync back to localStorage
        if (window.localStorage) {
          localStorage.setItem('audio-prime-modules', JSON.stringify(fileState));
        }
        console.log('Module visibility loaded from file');
      }
    });
  }

  return {
    subscribe,
    toggle: (module: keyof ModuleVisibility) => {
      update(state => {
        const newState = { ...state, [module]: !state[module] };
        const safeState = ensureMinimumVisibility(newState);
        saveToStorage(safeState);
        return safeState;
      });
    },
    set: (module: keyof ModuleVisibility, visible: boolean) => {
      update(state => {
        const newState = { ...state, [module]: visible };
        const safeState = ensureMinimumVisibility(newState);
        saveToStorage(safeState);
        return safeState;
      });
    },
    reset: () => {
      set(defaultVisibility);
      saveToStorage(defaultVisibility);
    },
    // Get current state (for preset saving)
    getState: (): ModuleVisibility => {
      return get({ subscribe });
    },
    // Restore full state (for preset loading)
    restore: (visibility: ModuleVisibility) => {
      const merged = { ...defaultVisibility, ...visibility };
      const safeState = ensureMinimumVisibility(merged);
      set(safeState);
      saveToStorage(safeState);
    },
  };
}

export const moduleVisibility = createModuleVisibilityStore();
