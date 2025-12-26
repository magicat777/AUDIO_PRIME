<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';

  // Menu item types
  export interface MenuOption {
    value: string;
    label: string;
    color?: string;  // Optional indicator color
  }

  export interface MenuGroup {
    id: string;
    label: string;
    type: 'select' | 'toggle';
    options?: MenuOption[];  // For select type
    value: string | boolean;  // Current value
  }

  // Props
  export let groups: MenuGroup[] = [];
  export let disabled = false;

  const dispatch = createEventDispatcher<{
    change: { groupId: string; value: string | boolean };
  }>();

  let isOpen = false;
  let menuRef: HTMLDivElement;
  let buttonRef: HTMLButtonElement;

  function toggleMenu() {
    if (disabled) return;
    isOpen = !isOpen;
  }

  function closeMenu() {
    isOpen = false;
  }

  function handleOptionClick(groupId: string, value: string | boolean) {
    dispatch('change', { groupId, value });
    // Don't close menu on selection - let user make multiple changes
  }

  function handleClickOutside(event: MouseEvent) {
    if (isOpen && menuRef && !menuRef.contains(event.target as Node) &&
        buttonRef && !buttonRef.contains(event.target as Node)) {
      closeMenu();
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && isOpen) {
      closeMenu();
    }
  }

  onMount(() => {
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    document.removeEventListener('click', handleClickOutside);
    document.removeEventListener('keydown', handleKeydown);
  });

  // Get display label for current value
  function getValueLabel(group: MenuGroup): string {
    if (group.type === 'toggle') {
      return group.value ? 'ON' : 'OFF';
    }
    const option = group.options?.find(o => o.value === group.value);
    return option?.label || String(group.value);
  }

  // Get indicator color for current value
  function getValueColor(group: MenuGroup): string | undefined {
    if (group.type === 'select' && group.options) {
      const option = group.options.find(o => o.value === group.value);
      return option?.color;
    }
    return undefined;
  }
</script>

<div class="gear-menu-container">
  <button
    bind:this={buttonRef}
    class="gear-button"
    class:open={isOpen}
    class:disabled={disabled || !groups || groups.length === 0}
    on:click={toggleMenu}
    title="Panel settings"
    aria-label="Panel settings"
    aria-expanded={isOpen}
  >
    <svg class="gear-icon" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22l-1.91 3.32c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
    </svg>
  </button>

  {#if isOpen}
    <div bind:this={menuRef} class="gear-dropdown">
      {#if !groups || groups.length === 0}
        <div class="menu-empty">
          <span class="empty-text">No options available</span>
        </div>
      {:else}
        {#each groups as group, i}
          {#if i > 0}
            <div class="menu-divider"></div>
          {/if}

          <div class="menu-group">
            <div class="group-header">
              <span class="group-label">{group.label}</span>
              <span class="group-value">
                {#if getValueColor(group)}
                  <span class="value-indicator" style="background: {getValueColor(group)}"></span>
                {/if}
                {getValueLabel(group)}
              </span>
            </div>

            {#if group.type === 'select' && group.options}
              <div class="options-list">
                {#each group.options as option}
                  <button
                    class="option-button"
                    class:active={group.value === option.value}
                    on:click={() => handleOptionClick(group.id, option.value)}
                  >
                    {#if option.color}
                      <span class="option-indicator" style="background: {option.color}"></span>
                    {/if}
                    <span class="option-label">{option.label}</span>
                  </button>
                {/each}
              </div>
            {:else if group.type === 'toggle'}
              <div class="options-list">
                <button
                  class="option-button"
                  class:active={group.value === true}
                  on:click={() => handleOptionClick(group.id, true)}
                >
                  <span class="option-label">ON</span>
                </button>
                <button
                  class="option-button"
                  class:active={group.value === false}
                  on:click={() => handleOptionClick(group.id, false)}
                >
                  <span class="option-label">OFF</span>
                </button>
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .gear-menu-container {
    position: relative;
    z-index: 30;
  }

  .gear-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    background: rgba(30, 35, 50, 0.9);
    border: 1px solid rgba(100, 100, 120, 0.3);
    border-radius: 4px;
    color: #808090;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .gear-button:hover:not(.disabled) {
    background: rgba(40, 50, 70, 0.95);
    border-color: rgba(100, 100, 120, 0.6);
    color: #ffffff;
  }

  .gear-button.open {
    background: rgba(50, 60, 80, 0.95);
    border-color: rgba(74, 158, 255, 0.5);
    color: #4a9eff;
  }

  .gear-button.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .gear-icon {
    width: 16px;
    height: 16px;
  }

  .gear-dropdown {
    position: absolute;
    top: 0;
    right: 100%;
    margin-right: 4px;
    min-width: 160px;
    background: rgba(25, 30, 40, 0.98);
    border: 1px solid rgba(74, 158, 255, 0.3);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }

  .menu-group {
    padding: 8px;
  }

  .menu-divider {
    height: 1px;
    background: rgba(100, 100, 120, 0.2);
    margin: 0;
  }

  .group-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
    padding: 0 4px;
  }

  .group-label {
    font-size: 9px;
    font-family: monospace;
    font-weight: 600;
    color: #606070;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .group-value {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    font-family: monospace;
    font-weight: 600;
    color: #4a9eff;
  }

  .value-indicator {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .options-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .option-button {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: rgba(40, 45, 60, 0.8);
    border: 1px solid rgba(80, 80, 100, 0.3);
    border-radius: 3px;
    color: #909090;
    font-size: 10px;
    font-family: monospace;
    cursor: pointer;
    transition: all 0.1s ease;
  }

  .option-button:hover {
    background: rgba(50, 55, 75, 0.9);
    border-color: rgba(100, 100, 120, 0.5);
    color: #c0c0c0;
  }

  .option-button.active {
    background: rgba(74, 158, 255, 0.2);
    border-color: rgba(74, 158, 255, 0.5);
    color: #4a9eff;
  }

  .option-indicator {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .option-label {
    white-space: nowrap;
  }

  .menu-empty {
    padding: 12px 16px;
  }

  .empty-text {
    font-size: 10px;
    font-family: monospace;
    color: #606070;
    font-style: italic;
  }
</style>
