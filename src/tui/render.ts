/**
 * Render Loop
 *
 * Manages efficient screen rendering with throttling
 */

import { Widgets } from 'blessed';
import { throttle } from './utils';

/**
 * Render Loop Manager
 */
export class RenderLoop {
  private screen: Widgets.Screen;
  private maxFPS: number;
  private renderFn: () => void;
  private intervalId: NodeJS.Timeout | null = null;
  private running: boolean = false;
  private renderCount: number = 0;
  private lastRenderTime: number = 0;

  constructor(screen: Widgets.Screen, maxFPS: number = 10) {
    this.screen = screen;
    this.maxFPS = maxFPS;

    // Create throttled render function
    const minInterval = 1000 / maxFPS;
    this.renderFn = throttle(() => {
      this.doRender();
    }, minInterval);
  }

  /**
   * Start render loop
   */
  start(): void {
    if (this.running) return;

    this.running = true;
    this.renderCount = 0;
    this.lastRenderTime = Date.now();

    // Initial render
    this.doRender();

    // Set up interval for periodic renders
    // This ensures we render even if no updates are triggered
    const interval = 1000 / this.maxFPS;
    this.intervalId = setInterval(() => {
      if (this.running) {
        this.requestRender();
      }
    }, interval);
  }

  /**
   * Stop render loop
   */
  stop(): void {
    if (!this.running) return;

    this.running = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Final render
    this.doRender();
  }

  /**
   * Request a render (throttled)
   */
  requestRender(): void {
    if (!this.running) return;
    this.renderFn();
  }

  /**
   * Force immediate render (bypasses throttle)
   */
  forceRender(): void {
    this.doRender();
  }

  /**
   * Perform actual render
   */
  private doRender(): void {
    const now = Date.now();
    this.screen.render();
    this.renderCount++;
    this.lastRenderTime = now;
  }

  /**
   * Get render statistics
   */
  getStats(): {
    fps: number;
    renderCount: number;
    timeSinceLastRender: number;
  } {
    const now = Date.now();
    const timeSinceLastRender = now - this.lastRenderTime;
    const fps = timeSinceLastRender > 0 ? 1000 / timeSinceLastRender : 0;

    return {
      fps,
      renderCount: this.renderCount,
      timeSinceLastRender,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.renderCount = 0;
    this.lastRenderTime = Date.now();
  }

  /**
   * Check if render loop is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Set max FPS
   */
  setMaxFPS(fps: number): void {
    this.maxFPS = fps;

    // Recreate throttled render function
    const minInterval = 1000 / fps;
    this.renderFn = throttle(() => {
      this.doRender();
    }, minInterval);

    // Restart interval if running
    if (this.running && this.intervalId) {
      clearInterval(this.intervalId);
      const interval = 1000 / fps;
      this.intervalId = setInterval(() => {
        if (this.running) {
          this.requestRender();
        }
      }, interval);
    }
  }

  /**
   * Get current max FPS
   */
  getMaxFPS(): number {
    return this.maxFPS;
  }
}
