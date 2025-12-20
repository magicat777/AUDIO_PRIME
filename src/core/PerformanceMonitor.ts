/**
 * PerformanceMonitor - FPS and latency tracking for AUDIO_PRIME
 */

import { writable } from 'svelte/store';
import type { Writable } from 'svelte/store';

export interface PerformanceStats {
  fps: number;
  frameTime: number;
  avgFrameTime: number;
  minFrameTime: number;
  maxFrameTime: number;
  audioLatency: number;
  memoryUsage: number;
  cpuPercent: number;
  gpuPercent: number;
}

class PerformanceMonitorClass {
  public stats: Writable<PerformanceStats>;

  private running = false;
  private frameCount = 0;
  private lastTime = 0;
  private lastFPSUpdate = 0;
  private frameTimes: number[] = [];
  private animationFrame: number | null = null;

  constructor() {
    this.stats = writable<PerformanceStats>({
      fps: 0,
      frameTime: 0,
      avgFrameTime: 0,
      minFrameTime: 0,
      maxFrameTime: 0,
      audioLatency: 0,
      memoryUsage: 0,
      cpuPercent: 0,
      gpuPercent: 0,
    });
  }

  start(): void {
    if (this.running) return;

    this.running = true;
    this.lastTime = performance.now();
    this.lastFPSUpdate = this.lastTime;
    this.frameCount = 0;
    this.frameTimes = [];

    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  private tick = async (): Promise<void> => {
    if (!this.running) return;

    const now = performance.now();
    const frameTime = now - this.lastTime;
    this.lastTime = now;

    this.frameCount++;
    this.frameTimes.push(frameTime);

    // Keep last 60 frame times
    if (this.frameTimes.length > 60) {
      this.frameTimes.shift();
    }

    // Update stats every second
    if (now - this.lastFPSUpdate >= 1000) {
      const fps = this.frameCount;
      this.frameCount = 0;
      this.lastFPSUpdate = now;

      const avgFrameTime =
        this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      const minFrameTime = Math.min(...this.frameTimes);
      const maxFrameTime = Math.max(...this.frameTimes);

      // Get memory usage if available
      let memoryUsage = 0;
      if ((performance as any).memory) {
        memoryUsage = (performance as any).memory.usedJSHeapSize / (1024 * 1024);
      }

      // Get CPU/GPU metrics from Electron
      let cpuPercent = 0;
      let gpuPercent = 0;
      if (window.electronAPI?.system?.getMetrics) {
        try {
          const metrics = await window.electronAPI.system.getMetrics();
          cpuPercent = metrics.cpuPercent;
          gpuPercent = metrics.gpuPercent;
        } catch {
          // Electron API not available
        }
      }

      this.stats.set({
        fps,
        frameTime,
        avgFrameTime,
        minFrameTime,
        maxFrameTime,
        audioLatency: 0, // TODO: Calculate actual audio latency
        memoryUsage,
        cpuPercent,
        gpuPercent,
      });
    }

    this.animationFrame = requestAnimationFrame(this.tick);
  };

  // Call this to record audio processing latency
  recordAudioLatency(latencyMs: number): void {
    this.stats.update((s) => ({
      ...s,
      audioLatency: latencyMs,
    }));
  }
}

export const performanceMonitor = new PerformanceMonitorClass();
