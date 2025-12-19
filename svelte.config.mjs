import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    // Using Svelte 5 with runes disabled for compatibility
    runes: false,
  },
};
