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
  debug: boolean;
  spotify: boolean;
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
  debug: true,         // Toggleable
  spotify: true,       // Spotify integration
};

// Load from localStorage if available
function loadFromStorage(): ModuleVisibility {
  if (typeof window !== 'undefined' && window.localStorage) {
    const stored = localStorage.getItem('audio-prime-modules');
    if (stored) {
      try {
        return { ...defaultVisibility, ...JSON.parse(stored) };
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
        // Persist to localStorage
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem('audio-prime-modules', JSON.stringify(newState));
        }
        return newState;
      });
    },
    set: (module: keyof ModuleVisibility, visible: boolean) => {
      update(state => {
        const newState = { ...state, [module]: visible };
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem('audio-prime-modules', JSON.stringify(newState));
        }
        return newState;
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
