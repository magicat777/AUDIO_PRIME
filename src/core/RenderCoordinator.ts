/**
 * RenderCoordinator - Centralized animation frame management
 *
 * Instead of each panel running its own requestAnimationFrame loop,
 * this coordinator runs a single RAF loop and dispatches to registered
 * render callbacks. This reduces CPU overhead from multiple independent loops.
 *
 * Features:
 * - Single RAF loop for all panels
 * - Visibility-based throttling (skip hidden panels)
 * - Frame rate limiting (60fps cap)
 * - Priority-based rendering (high priority panels render first)
 * - Performance metrics tracking
 */

export type RenderPriority = 'high' | 'normal' | 'low';

export interface RenderCallback {
  id: string;
  callback: (timestamp: number, deltaTime: number) => void;
  priority: RenderPriority;
  isVisible: boolean;
  lastRenderTime: number;
}

class RenderCoordinatorService {
  private callbacks: Map<string, RenderCallback> = new Map();
  private animationId: number | null = null;
  private lastFrameTime: number = 0;
  private isRunning: boolean = false;

  // PERFORMANCE: Cache sorted callbacks to avoid per-frame array allocation
  private sortedCallbacksCache: RenderCallback[] = [];
  private callbacksDirty: boolean = false;

  // Performance tracking
  private frameCount: number = 0;
  private lastFpsUpdate: number = 0;
  private currentFps: number = 60;
  private frameTimes: number[] = [];

  // Frame rate limiting (cap at 120fps max to prevent excessive CPU usage)
  private readonly MIN_FRAME_TIME = 1000 / 120;

  constructor() {
    // Auto-start when first callback is registered
  }

  /**
   * Register a render callback
   */
  register(
    id: string,
    callback: (timestamp: number, deltaTime: number) => void,
    priority: RenderPriority = 'normal'
  ): void {
    this.callbacks.set(id, {
      id,
      callback,
      priority,
      isVisible: true,
      lastRenderTime: 0,
    });

    // PERFORMANCE: Mark cache dirty when callbacks change
    this.callbacksDirty = true;

    // Start the loop if not already running
    if (!this.isRunning) {
      this.start();
    }
  }

  /**
   * Unregister a render callback
   */
  unregister(id: string): void {
    this.callbacks.delete(id);

    // PERFORMANCE: Mark cache dirty when callbacks change
    this.callbacksDirty = true;

    // Stop the loop if no callbacks remain
    if (this.callbacks.size === 0) {
      this.stop();
    }
  }

  /**
   * Update visibility for a specific callback
   */
  setVisibility(id: string, isVisible: boolean): void {
    const callback = this.callbacks.get(id);
    if (callback) {
      callback.isVisible = isVisible;
    }
  }

  /**
   * Batch update visibility for multiple callbacks
   */
  setVisibilityBatch(updates: Record<string, boolean>): void {
    for (const [id, isVisible] of Object.entries(updates)) {
      this.setVisibility(id, isVisible);
    }
  }

  /**
   * Get current FPS
   */
  getFps(): number {
    return this.currentFps;
  }

  /**
   * Get number of active (visible) callbacks
   */
  getActiveCallbackCount(): number {
    let count = 0;
    for (const cb of this.callbacks.values()) {
      if (cb.isVisible) count++;
    }
    return count;
  }

  /**
   * Get total registered callbacks
   */
  getTotalCallbackCount(): number {
    return this.callbacks.size;
  }

  /**
   * Start the render loop
   */
  private start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.lastFrameTime = performance.now();
    this.lastFpsUpdate = this.lastFrameTime;
    this.frameCount = 0;

    this.renderLoop(this.lastFrameTime);
  }

  /**
   * Stop the render loop
   */
  private stop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.isRunning = false;
  }

  /**
   * Main render loop
   */
  private renderLoop = (timestamp: number): void => {
    if (!this.isRunning) return;

    const deltaTime = timestamp - this.lastFrameTime;

    // Frame rate limiting - skip if too soon
    if (deltaTime < this.MIN_FRAME_TIME) {
      this.animationId = requestAnimationFrame(this.renderLoop);
      return;
    }

    this.lastFrameTime = timestamp;

    // Update FPS counter
    this.frameCount++;
    if (timestamp - this.lastFpsUpdate >= 1000) {
      this.currentFps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsUpdate = timestamp;
    }

    // Track frame time for performance monitoring
    this.frameTimes.push(deltaTime);
    if (this.frameTimes.length > 60) {
      this.frameTimes.shift();
    }

    // Sort callbacks by priority and call visible ones
    const sortedCallbacks = this.getSortedCallbacks();

    for (const cb of sortedCallbacks) {
      if (cb.isVisible) {
        try {
          cb.callback(timestamp, deltaTime);
          cb.lastRenderTime = timestamp;
        } catch (error) {
          console.error(`RenderCoordinator: Error in callback "${cb.id}":`, error);
        }
      }
    }

    // Schedule next frame
    this.animationId = requestAnimationFrame(this.renderLoop);
  };

  /**
   * Get callbacks sorted by priority (cached to avoid per-frame allocation)
   */
  private getSortedCallbacks(): RenderCallback[] {
    // PERFORMANCE: Only regenerate sorted array when callbacks change
    if (this.callbacksDirty) {
      const priorityOrder: Record<RenderPriority, number> = {
        high: 0,
        normal: 1,
        low: 2,
      };

      this.sortedCallbacksCache = Array.from(this.callbacks.values()).sort(
        (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
      );
      this.callbacksDirty = false;
    }

    return this.sortedCallbacksCache;
  }

  /**
   * Get average frame time (for performance monitoring)
   */
  getAverageFrameTime(): number {
    if (this.frameTimes.length === 0) return 0;
    return this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
  }

  /**
   * Check if the coordinator is running
   */
  isActive(): boolean {
    return this.isRunning;
  }
}

// Export singleton instance
export const renderCoordinator = new RenderCoordinatorService();
