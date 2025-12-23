/**
 * Module visibility store - controls which panels are shown/hidden
 */
import { writable } from 'svelte/store';

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

// Create the store
function createModuleVisibilityStore() {
  const { subscribe, set, update } = writable<ModuleVisibility>(loadFromStorage());

  return {
    subscribe,
    toggle: (module: keyof ModuleVisibility) => {
      update(state => {
        const newState = { ...state, [module]: !state[module] };
        // Ensure at least one core module remains visible
        const safeState = ensureMinimumVisibility(newState);
        // Persist to localStorage
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem('audio-prime-modules', JSON.stringify(safeState));
        }
        return safeState;
      });
    },
    set: (module: keyof ModuleVisibility, visible: boolean) => {
      update(state => {
        const newState = { ...state, [module]: visible };
        // Ensure at least one core module remains visible
        const safeState = ensureMinimumVisibility(newState);
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem('audio-prime-modules', JSON.stringify(safeState));
        }
        return safeState;
      });
    },
    reset: () => {
      set(defaultVisibility);
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.removeItem('audio-prime-modules');
      }
    },
  };
}

export const moduleVisibility = createModuleVisibilityStore();
