/**
 * Log collector
 * Improved version with WebSocket subscription support
 */

import {
  http,
  type Address,
  type Chain,
  type Hash,
  type Log,
  type PublicClient,
  createPublicClient,
  webSocket,
} from 'viem';
import type { Collector, CollectorStream } from '../types';
import { logger } from '../utils/logger';

/**
 * Filter for logs
 */
export interface LogFilter {
  address?: Address | Address[];
  topics?: (Hash | Hash[] | null)[];
  fromBlock?: bigint;
  toBlock?: bigint;
}

/**
 * Configuration for the LogCollector
 */
export interface LogCollectorConfig {
  /** Polling interval in milliseconds (for HTTP transport) */
  pollingIntervalMs?: number;
  /** Maximum queue size */
  maxQueueSize?: number;
  /** Block range to fetch in each poll (for HTTP transport) */
  blockRange?: number;
}

/**
 * LogCollector - collects logs from an Ethereum node
 */
export class LogCollector implements Collector<Log> {
  private client: PublicClient;
  private filter: LogFilter;
  private config: LogCollectorConfig;
  private isWebSocket: boolean;
  private lastProcessedBlock?: bigint;

  /**
   * Create a new LogCollector
   * @param client The Ethereum client to use
   * @param filter The filter to apply to logs
   * @param config Configuration options
   */
  constructor(client: PublicClient, filter: LogFilter, config: LogCollectorConfig = {}) {
    this.client = client;
    this.filter = filter;
    this.config = {
      pollingIntervalMs: 1000,
      maxQueueSize: 1000,
      blockRange: 100,
      ...config,
    };

    // Determine if the client uses WebSocket transport
    // Check if the transport is a WebSocket transport
    this.isWebSocket =
      typeof this.client.transport === 'object' &&
      this.client.transport !== null &&
      'type' in this.client.transport &&
      this.client.transport.type === 'webSocket';
  }

  /**
   * Create a new LogCollector with a WebSocket transport
   * @param url The WebSocket URL of the Ethereum node
   * @param chain The chain to connect to
   * @param filter The filter to apply to logs
   * @param config Configuration options
   * @returns A new LogCollector
   */
  static withWebSocket(
    url: string,
    chain: Chain,
    filter: LogFilter,
    config: LogCollectorConfig = {}
  ): LogCollector {
    const client = createPublicClient({
      transport: webSocket(url),
      chain,
    });
    return new LogCollector(client, filter, config);
  }

  /**
   * Create a new LogCollector with an HTTP transport
   * @param url The HTTP URL of the Ethereum node
   * @param chain The chain to connect to
   * @param filter The filter to apply to logs
   * @param config Configuration options
   * @returns A new LogCollector
   */
  static withHttp(
    url: string,
    chain: Chain,
    filter: LogFilter,
    config: LogCollectorConfig = {}
  ): LogCollector {
    const client = createPublicClient({
      transport: http(url),
      chain,
    });
    return new LogCollector(client, filter, config);
  }

  name(): string {
    return 'LogCollector';
  }

  async getEventStream(): Promise<CollectorStream<Log>> {
    // Create a queue to buffer logs
    const queue: Log[] = [];
    let resolvers: ((value: IteratorResult<Log>) => void)[] = [];
    let done = false;
    let cleanupFn: (() => void) | null = null;

    if (this.isWebSocket) {
      // Use WebSocket subscription for real-time logs
      logger.info('Using WebSocket subscription for logs');

      let intervalId: NodeJS.Timeout | null = null;
      let abortController = new AbortController();
      let isPolling = false;

      try {
        // Create a filter ID for the logs
        const filterId = await this.client.createEventFilter({
          ...this.filter,
        });

        // Set up a polling mechanism for the filter
        const pollFilterChanges = async () => {
          // Skip if already polling or done
          if (isPolling || done || abortController.signal.aborted) {
            return;
          }

          isPolling = true;

          try {
            // Check if we're done before making any API calls
            if (done || abortController.signal.aborted) {
              isPolling = false;
              return;
            }

            const logs = await this.client.getFilterChanges({ filter: filterId });

            // Check if we're done before processing logs
            if (done || abortController.signal.aborted) {
              isPolling = false;
              return;
            }

            for (const log of logs as Log[]) {
              // Check if we're done before processing each log
              if (done || abortController.signal.aborted) {
                break;
              }

              if (resolvers.length > 0) {
                // If there are waiting resolvers, resolve one with the log
                const resolve = resolvers.shift();
                if (resolve) {
                  resolve({ done: false, value: log });
                }
              } else {
                // Otherwise, add the log to the queue
                queue.push(log);

                // Limit queue size
                if (queue.length > (this.config.maxQueueSize ?? 1000)) {
                  queue.shift();
                  logger.warn('LogCollector queue overflow, dropping oldest log');
                }
              }
            }
          } catch (error) {
            if (done || abortController.signal.aborted) {
              isPolling = false;
              return;
            }

            logger.error(`Error polling filter changes: ${error}`);
          } finally {
            isPolling = false;
          }
        };

        // Start the polling interval
        intervalId = setInterval(pollFilterChanges, 1000);

        // Function to clean up
        cleanupFn = () => {
          logger.debug('Cleaning up LogCollector WebSocket resources');

          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }

          // Abort any in-flight requests
          abortController.abort();

          // Create a new abort controller for any future requests
          abortController = new AbortController();

          // Uninstall the filter
          this.client.uninstallFilter({ filter: filterId }).catch((error) => {
            logger.error(`Error uninstalling filter: ${error}`);
          });

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
      } catch (error) {
        logger.error(`Failed to set up WebSocket subscription: ${error}`);
        // Fall back to polling if subscription fails
        logger.warn('Falling back to polling for logs');
        return this.getPollingEventStream();
      }
    } else {
      // Use polling for HTTP transport
      logger.info('Using polling for logs');
      return this.getPollingEventStream();
    }

    // Return an async iterator that yields logs
    return {
      async next(): Promise<IteratorResult<Log>> {
        if (done) {
          return { done: true, value: undefined as unknown };
        }

        if (queue.length > 0) {
          // If there are logs in the queue, return one
          const log = queue.shift();
          if (log === undefined) {
            // This should never happen, but we handle it just in case
            return { done: true, value: undefined as unknown };
          }
          return { done: false, value: log };
        }

        // Otherwise, wait for a log
        return new Promise<IteratorResult<Log>>((resolve) => {
          resolvers.push(resolve);
        });
      },

      // Clean up when the iterator is done
      async return(): Promise<IteratorResult<Log>> {
        if (cleanupFn) {
          cleanupFn();
        }
        return { done: true, value: undefined as unknown };
      },
    };
  }

  /**
   * Get an event stream using polling (for HTTP transport)
   */
  private async getPollingEventStream(): Promise<CollectorStream<Log>> {
    // Create a queue to buffer logs
    const queue: Log[] = [];
    let resolvers: ((value: IteratorResult<Log>) => void)[] = [];
    let done = false;
    let intervalId: NodeJS.Timeout | null = null;
    let abortController = new AbortController();

    // Initialize the last processed block
    if (!this.lastProcessedBlock) {
      try {
        const latestBlock = await this.client.getBlockNumber();
        this.lastProcessedBlock = latestBlock;
        logger.info(`Starting log collection from block ${this.lastProcessedBlock}`);
      } catch (error) {
        logger.error(`Failed to get latest block number: ${error}`);
        this.lastProcessedBlock = BigInt(0);
      }
    }

    // Create a polling mechanism for logs with exponential backoff
    let currentInterval = this.config.pollingIntervalMs ?? 1000;
    let consecutiveErrors = 0;
    let isPolling = false; // Flag to prevent concurrent polling

    const pollLogs = async () => {
      // Skip if already polling or done
      if (isPolling || done || abortController.signal.aborted) {
        return;
      }

      isPolling = true;

      try {
        // Check if we're done before making any API calls
        if (done || abortController.signal.aborted) {
          isPolling = false;
          return;
        }

        // Get the latest block number
        const latestBlock = await this.client.getBlockNumber();

        // Skip if no new blocks
        if (this.lastProcessedBlock !== undefined && latestBlock <= this.lastProcessedBlock) {
          isPolling = false;
          return;
        }

        // Calculate the range to fetch
        // Don't fetch more than blockRange blocks at once to avoid timeouts
        // At this point, we know lastProcessedBlock is defined because we checked above
        const fromBlock = (this.lastProcessedBlock ?? BigInt(0)) + BigInt(1);
        const blockRange = this.config.blockRange ?? 100;
        const toBlock =
          latestBlock < fromBlock + BigInt(blockRange)
            ? latestBlock
            : fromBlock + BigInt(blockRange - 1);

        // Check again if we're done before making the getLogs call
        if (done || abortController.signal.aborted) {
          isPolling = false;
          return;
        }

        // Get logs for the block range
        const logs = await this.client.getLogs({
          ...this.filter,
          fromBlock,
          toBlock,
        });

        // Update the last processed block
        this.lastProcessedBlock = toBlock;

        // Reset backoff on success
        if (consecutiveErrors > 0) {
          consecutiveErrors = 0;
          currentInterval = this.config.pollingIntervalMs ?? 1000;
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = setInterval(pollLogs, currentInterval);
          }
        }

        // Check again if we're done before processing logs
        if (done || abortController.signal.aborted) {
          isPolling = false;
          return;
        }

        // Check again if we're done before processing logs
        if (done || abortController.signal.aborted) {
          isPolling = false;
          return;
        }

        // Process the logs
        logger.debug(
          `Processed logs from blocks ${fromBlock} to ${toBlock}, found ${logs.length} logs`
        );

        for (const log of logs) {
          // Check if we're done before processing each log
          if (done || abortController.signal.aborted) {
            isPolling = false;
            return;
          }

          if (resolvers.length > 0) {
            // If there are waiting resolvers, resolve one with the log
            const resolve = resolvers.shift();
            if (resolve) {
              resolve({ done: false, value: log });
            }
          } else {
            // Otherwise, add the log to the queue
            queue.push(log);

            // Limit queue size
            if (queue.length > (this.config.maxQueueSize ?? 1000)) {
              queue.shift();
              logger.warn('LogCollector queue overflow, dropping oldest log');
            }
          }
        }
      } catch (error) {
        if (done || abortController.signal.aborted) {
          isPolling = false;
          return;
        }

        logger.error(`Error in LogCollector: ${error}`);

        // Implement exponential backoff
        consecutiveErrors++;
        if (consecutiveErrors > 3) {
          const newInterval = Math.min(currentInterval * 2, 30000); // Max 30 seconds
          if (newInterval !== currentInterval) {
            currentInterval = newInterval;
            if (intervalId) {
              clearInterval(intervalId);
              intervalId = setInterval(pollLogs, currentInterval);
            }
            logger.warn(`Increasing polling interval to ${currentInterval}ms due to errors`);
          }
        }
      } finally {
        isPolling = false;
      }
    };

    // Start the polling interval
    intervalId = setInterval(pollLogs, currentInterval);

    // Function to clean up
    const cleanup = () => {
      logger.debug('Cleaning up LogCollector polling resources');
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }

      // Abort any in-flight requests
      abortController.abort();

      // Create a new abort controller for any future requests
      abortController = new AbortController();

      // Mark as done
      done = true;

      // Resolve any waiting resolvers with done
      for (const resolver of resolvers) {
        resolver({ done: true, value: undefined as unknown });
      }
      resolvers = [];

      // Clear the queue
      queue.length = 0;

      // Clear any pending API calls or timeouts
      if (this.lastProcessedBlock) {
        // Reset the last processed block to prevent further processing
        this.lastProcessedBlock = undefined;
      }
    };

    // Return an async iterator that yields logs
    return {
      async next(): Promise<IteratorResult<Log>> {
        if (done) {
          return { done: true, value: undefined as unknown };
        }

        if (queue.length > 0) {
          // If there are logs in the queue, return one
          const log = queue.shift();
          if (log === undefined) {
            // This should never happen, but we handle it just in case
            return { done: true, value: undefined as unknown };
          }
          return { done: false, value: log };
        }

        // Otherwise, wait for a log
        return new Promise<IteratorResult<Log>>((resolve) => {
          resolvers.push(resolve);
        });
      },

      // Clean up when the iterator is done
      async return(): Promise<IteratorResult<Log>> {
        cleanup();
        return { done: true, value: undefined as unknown };
      },
    };
  }
}
