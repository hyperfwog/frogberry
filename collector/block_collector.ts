/**
 * Block collector
 * Improved version with WebSocket subscription support
 */

import {
  http,
  type Block,
  type Chain,
  type PublicClient,
  type Transport,
  createPublicClient,
  webSocket,
} from 'viem';
import type { Collector, CollectorStream } from '../types';
import { logger } from '../utils/logger';

/**
 * Configuration for the BlockCollector
 */
export interface BlockCollectorConfig {
  /** Polling interval in milliseconds (for HTTP transport) */
  pollingIntervalMs?: number;
  /** Maximum queue size */
  maxQueueSize?: number;
  /** Whether to include transactions in the blocks */
  includeTransactions?: boolean;
}

/**
 * BlockCollector - collects new blocks from an Ethereum node
 */
export class BlockCollector implements Collector<Block> {
  private client: PublicClient;
  private config: BlockCollectorConfig;
  private isWebSocket: boolean;

  /**
   * Create a new BlockCollector
   * @param client The Ethereum client to use
   * @param config Configuration options
   */
  constructor(client: PublicClient, config: BlockCollectorConfig = {}) {
    this.client = client;
    this.config = {
      pollingIntervalMs: 1000,
      maxQueueSize: 100,
      includeTransactions: false,
      ...config,
    };

    // Determine if the client uses WebSocket transport
    this.isWebSocket = (this.client.transport as any)?.type === 'webSocket';
  }

  /**
   * Create a new BlockCollector with a WebSocket transport
   * @param url The WebSocket URL of the Ethereum node
   * @param chain The chain to connect to
   * @param config Configuration options
   * @returns A new BlockCollector
   */
  static withWebSocket(
    url: string,
    chain: Chain,
    config: BlockCollectorConfig = {}
  ): BlockCollector {
    const client = createPublicClient({
      transport: webSocket(url),
      chain,
    });
    return new BlockCollector(client, config);
  }

  /**
   * Create a new BlockCollector with an HTTP transport
   * @param url The HTTP URL of the Ethereum node
   * @param chain The chain to connect to
   * @param config Configuration options
   * @returns A new BlockCollector
   */
  static withHttp(url: string, chain: Chain, config: BlockCollectorConfig = {}): BlockCollector {
    const client = createPublicClient({
      transport: http(url),
      chain,
    });
    return new BlockCollector(client, config);
  }

  name(): string {
    return 'BlockCollector';
  }

  async getEventStream(): Promise<CollectorStream<Block>> {
    // Create a queue to buffer blocks
    const queue: Block[] = [];
    let resolvers: ((value: IteratorResult<Block>) => void)[] = [];
    let done = false;
    let lastBlockNumber: bigint | null = null;
    let cleanupFn: (() => void) | null = null;

    if (this.isWebSocket) {
      // Use WebSocket subscription for real-time blocks
      logger.info('Using WebSocket subscription for blocks');

      let abortController = new AbortController();

      try {
        const unwatch = await this.client.watchBlocks({
          onBlock: (block) => {
            // Check if we're done before processing the block
            if (
              done ||
              abortController.signal.aborted ||
              (global as any).__BURBERRY_FORCED_SHUTDOWN__
            ) {
              return;
            }

            // Only process if it's a new block
            if (lastBlockNumber === null || block.number! > lastBlockNumber) {
              lastBlockNumber = block.number!;

              if (resolvers.length > 0) {
                // If there are waiting resolvers, resolve one with the block
                const resolve = resolvers.shift()!;
                resolve({ done: false, value: block });
              } else {
                // Otherwise, add the block to the queue
                queue.push(block);

                // Limit queue size
                if (queue.length > this.config.maxQueueSize!) {
                  queue.shift();
                  logger.warn('BlockCollector queue overflow, dropping oldest block');
                }
              }
            }
          },
          includeTransactions: this.config.includeTransactions,
        });

        cleanupFn = () => {
          logger.debug('Cleaning up BlockCollector WebSocket resources');

          // Abort any in-flight requests
          abortController.abort();

          // Create a new abort controller for any future requests
          abortController = new AbortController();

          // Unwatch blocks
          unwatch();

          // Mark as done
          done = true;

          // Resolve any waiting resolvers with done
          for (const resolver of resolvers) {
            resolver({ done: true, value: undefined as any });
          }
          resolvers = [];

          // Clear the queue
          queue.length = 0;
        };
      } catch (error) {
        logger.error(`Failed to set up WebSocket subscription: ${error}`);
        // Fall back to polling if subscription fails
        logger.warn('Falling back to polling for blocks');
        return this.getPollingEventStream();
      }
    } else {
      // Use polling for HTTP transport
      logger.info('Using polling for blocks');
      return this.getPollingEventStream();
    }

    // Return an async iterator that yields blocks
    return {
      async next(): Promise<IteratorResult<Block>> {
        if (done) {
          return { done: true, value: undefined as any };
        }

        if (queue.length > 0) {
          // If there are blocks in the queue, return one
          return { done: false, value: queue.shift()! };
        }

        // Otherwise, wait for a block
        return new Promise<IteratorResult<Block>>((resolve) => {
          resolvers.push(resolve);
        });
      },

      // Clean up when the iterator is done
      async return(): Promise<IteratorResult<Block>> {
        if (cleanupFn) {
          cleanupFn();
        }
        return { done: true, value: undefined as any };
      },
    };
  }

  /**
   * Get an event stream using polling (for HTTP transport)
   */
  private async getPollingEventStream(): Promise<CollectorStream<Block>> {
    // Create a queue to buffer blocks
    const queue: Block[] = [];
    let resolvers: ((value: IteratorResult<Block>) => void)[] = [];
    let done = false;
    let lastBlockNumber: bigint | null = null;
    let intervalId: NodeJS.Timeout | null = null;
    let abortController = new AbortController();
    let isPolling = false; // Flag to prevent concurrent polling

    // Create a polling mechanism for blocks with exponential backoff
    let currentInterval = this.config.pollingIntervalMs!;
    let consecutiveErrors = 0;

    const pollBlock = async () => {
      // Skip if already polling or done
      if (
        isPolling ||
        done ||
        abortController.signal.aborted ||
        (global as any).__BURBERRY_FORCED_SHUTDOWN__
      ) {
        return;
      }

      isPolling = true;

      try {
        // Check if we're done before making any API calls
        if (done || abortController.signal.aborted) {
          isPolling = false;
          return;
        }

        // Get the latest block
        const block = await this.client.getBlock({
          includeTransactions: this.config.includeTransactions,
        });

        // Reset backoff on success
        if (consecutiveErrors > 0) {
          consecutiveErrors = 0;
          currentInterval = this.config.pollingIntervalMs!;
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = setInterval(pollBlock, currentInterval);
          }
        }

        // Check if we're done before processing the block
        if (done || abortController.signal.aborted) {
          isPolling = false;
          return;
        }

        // Only process if it's a new block
        if (lastBlockNumber === null || block.number > lastBlockNumber) {
          lastBlockNumber = block.number;

          if (resolvers.length > 0) {
            // If there are waiting resolvers, resolve one with the block
            const resolve = resolvers.shift()!;
            resolve({ done: false, value: block });
          } else {
            // Otherwise, add the block to the queue
            queue.push(block);

            // Limit queue size
            if (queue.length > this.config.maxQueueSize!) {
              queue.shift();
              logger.warn('BlockCollector queue overflow, dropping oldest block');
            }
          }
        }
      } catch (error) {
        if (done || abortController.signal.aborted) {
          isPolling = false;
          return;
        }

        logger.error(`Error in BlockCollector: ${error}`);

        // Implement exponential backoff
        consecutiveErrors++;
        if (consecutiveErrors > 3) {
          const newInterval = Math.min(currentInterval * 2, 30000); // Max 30 seconds
          if (newInterval !== currentInterval) {
            currentInterval = newInterval;
            if (intervalId) {
              clearInterval(intervalId);
              intervalId = setInterval(pollBlock, currentInterval);
            }
            logger.warn(`Increasing polling interval to ${currentInterval}ms due to errors`);
          }
        }
      } finally {
        isPolling = false;
      }
    };

    // Start the polling interval
    intervalId = setInterval(pollBlock, currentInterval);

    // Function to clean up
    const cleanup = () => {
      logger.debug('Cleaning up BlockCollector polling resources');

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
        resolver({ done: true, value: undefined as any });
      }
      resolvers = [];

      // Clear the queue
      queue.length = 0;

      // Set the global forced shutdown flag to ensure any in-progress operations stop
      (global as any).__BURBERRY_FORCED_SHUTDOWN__ = true;
    };

    // Return an async iterator that yields blocks
    return {
      async next(): Promise<IteratorResult<Block>> {
        if (done) {
          return { done: true, value: undefined as any };
        }

        if (queue.length > 0) {
          // If there are blocks in the queue, return one
          return { done: false, value: queue.shift()! };
        }

        // Otherwise, wait for a block
        return new Promise<IteratorResult<Block>>((resolve) => {
          resolvers.push(resolve);
        });
      },

      // Clean up when the iterator is done
      async return(): Promise<IteratorResult<Block>> {
        cleanup();
        return { done: true, value: undefined as any };
      },
    };
  }
}
