/**
 * Interval collector using Bun's native process APIs
 * This implementation provides better performance and resource utilization
 */

import { join } from 'path';
import type { Collector, CollectorStream } from '../types';
import { logger } from '../utils/logger';

/**
 * IntervalCollectorBun - emits events at regular intervals using a separate process
 * This implementation leverages Bun's native process APIs for better performance
 */
export class IntervalCollectorBun implements Collector<Date> {
  private readonly intervalMs: number;
  private readonly workerPath: string;

  constructor(intervalMs: number) {
    this.intervalMs = intervalMs;
    // Path to the worker script, relative to the current file
    this.workerPath = join(__dirname, 'interval_collector_worker.ts');
  }

  name(): string {
    return 'IntervalCollectorBun';
  }

  async getEventStream(): Promise<CollectorStream<Date>> {
    logger.debug(`Starting IntervalCollectorBun with ${this.intervalMs}ms interval`);
    
    // Queue to buffer events
    const queue: Date[] = [];
    // Resolvers for the async iterator
    let resolvers: ((value: IteratorResult<Date>) => void)[] = [];
    // Flag to track if the collector is done
    let done = false;
    
    // Spawn the worker process
    const proc = Bun.spawn({
      cmd: [process.execPath, this.workerPath],
      env: {
        INTERVAL_MS: this.intervalMs.toString(),
      },
      ipc(message) {
        // Convert the timestamp string to a Date object
        if (message && typeof message === 'object' && 'timestamp' in message) {
          const timestamp = message.timestamp;
          if (typeof timestamp === 'string') {
            const date = new Date(timestamp);
            
            // If there are waiting resolvers, resolve one with the date
            if (resolvers.length > 0) {
              const resolve = resolvers.shift();
              if (resolve) {
                resolve({ done: false, value: date });
              }
            } else {
              // Otherwise, add the date to the queue
              queue.push(date);
              
              // Limit queue size to avoid memory leaks
              if (queue.length > 100) {
                queue.shift();
                logger.warn('IntervalCollectorBun queue overflow, dropping oldest event');
              }
            }
          }
        }
      },
      onExit(proc, exitCode, signalCode, error) {
        logger.debug(`IntervalCollectorBun worker exited with code ${exitCode}`);
        
        // Mark as done
        done = true;
        
        // Resolve any waiting resolvers with done
        for (const resolver of resolvers) {
          resolver({ done: true, value: undefined as unknown });
        }
        resolvers = [];
      }
    });
    
    // Function to clean up resources
    const cleanup = () => {
      logger.debug('Cleaning up IntervalCollectorBun resources');
      
      // Send stop message to the worker
      proc.send('stop');
      
      // Kill the process if it doesn't exit within 1 second
      setTimeout(() => {
        if (!proc.killed) {
          logger.warn('IntervalCollectorBun worker did not exit gracefully, killing');
          proc.kill();
        }
      }, 1000);
      
      // Mark as done
      done = true;
      
      // Resolve any waiting resolvers with done
      for (const resolver of resolvers) {
        resolver({ done: true, value: undefined as unknown });
      }
      resolvers = [];
      
      // Clear the queue
      queue.length = 0;
    };
    
    // Return an async iterator that yields events
    return {
      async next(): Promise<IteratorResult<Date>> {
        if (done) {
          return { done: true, value: undefined as unknown };
        }
        
        if (queue.length > 0) {
          // If there are events in the queue, return one
          const date = queue.shift();
          if (date === undefined) {
            // This should never happen, but we handle it just in case
            return { done: true, value: undefined as unknown };
          }
          return { done: false, value: date };
        }
        
        // Otherwise, wait for an event
        return new Promise<IteratorResult<Date>>((resolve) => {
          resolvers.push(resolve);
        });
      },
      
      // Clean up when the iterator is done
      async return(): Promise<IteratorResult<Date>> {
        cleanup();
        return { done: true, value: undefined as unknown };
      }
    };
  }
}
