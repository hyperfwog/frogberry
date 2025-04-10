/**
 * Interval collector
 * Ported from Rust crate burberry/src/collector/interval_collector.rs
 */

import type { Collector, CollectorStream } from '../types';

/**
 * IntervalCollector - emits events at regular intervals
 */
export class IntervalCollector implements Collector<Date> {
  private readonly intervalMs: number;

  constructor(intervalMs: number) {
    this.intervalMs = intervalMs;
  }

  name(): string {
    return 'IntervalCollector';
  }

  async getEventStream(): Promise<CollectorStream<Date>> {
    const intervalMs = this.intervalMs;

    // Create an async iterator that emits events at regular intervals
    return {
      async next(): Promise<IteratorResult<Date>> {
        // Wait for the interval
        await new Promise((resolve) => setTimeout(resolve, intervalMs));

        // Emit the current time
        return { done: false, value: new Date() };
      },
    };
  }
}
