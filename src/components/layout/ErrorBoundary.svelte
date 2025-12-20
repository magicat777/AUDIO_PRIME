<script lang="ts">
  import { onMount } from 'svelte';

  export let fallbackMessage = 'Something went wrong';

  let hasError = false;
  let errorMessage = '';
  let errorStack = '';

  // Handle errors from child components
  function handleError(error: Error) {
    hasError = true;
    errorMessage = error.message;
    errorStack = error.stack || '';
    console.error('ErrorBoundary caught error:', error);
  }

  // Reset error state
  function reset() {
    hasError = false;
    errorMessage = '';
    errorStack = '';
  }

  onMount(() => {
    // Listen for unhandled errors in this component tree
    const handleWindowError = (event: ErrorEvent) => {
      // Only handle if error occurred in our component tree
      if (event.error) {
        handleError(event.error);
        event.preventDefault();
      }
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (event.reason instanceof Error) {
        handleError(event.reason);
      } else {
        handleError(new Error(String(event.reason)));
      }
      event.preventDefault();
    };

    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  });
</script>

{#if hasError}
  <div class="error-boundary">
    <div class="error-content">
      <div class="error-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <h2>{fallbackMessage}</h2>
      <p class="error-message">{errorMessage}</p>
      <button class="retry-btn" on:click={reset}>
        Try Again
      </button>
      {#if errorStack}
        <details class="error-details">
          <summary>Technical Details</summary>
          <pre>{errorStack}</pre>
        </details>
      {/if}
    </div>
  </div>
{:else}
  <slot />
{/if}

<style>
  .error-boundary {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    min-height: 200px;
    background: var(--bg-secondary, #1a1a2e);
    border-radius: 8px;
    padding: 2rem;
  }

  .error-content {
    text-align: center;
    max-width: 500px;
  }

  .error-icon {
    color: var(--meter-red, #ef4444);
    margin-bottom: 1rem;
  }

  h2 {
    font-size: 1.25rem;
    font-weight: 500;
    color: var(--text-primary, #fff);
    margin: 0 0 0.5rem 0;
  }

  .error-message {
    font-size: 0.875rem;
    color: var(--text-secondary, #9ca3af);
    margin: 0 0 1.5rem 0;
    word-break: break-word;
  }

  .retry-btn {
    padding: 0.5rem 1.5rem;
    font-size: 0.875rem;
    font-weight: 500;
    background: var(--accent-color, #4a9eff);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .retry-btn:hover {
    background: var(--accent-color-hover, #3b8bef);
  }

  .error-details {
    margin-top: 1.5rem;
    text-align: left;
  }

  .error-details summary {
    font-size: 0.75rem;
    color: var(--text-muted, #6b7280);
    cursor: pointer;
    user-select: none;
  }

  .error-details pre {
    font-size: 0.65rem;
    color: var(--text-muted, #6b7280);
    background: var(--bg-tertiary, #0d0d1a);
    padding: 0.75rem;
    border-radius: 4px;
    overflow-x: auto;
    margin-top: 0.5rem;
    max-height: 150px;
    overflow-y: auto;
  }
</style>
