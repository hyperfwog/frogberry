/**
 * Block collector using Bun's native process APIs
 * This implementation provides better performance and resource utilization
 */

import { join } from 'node:path';
import type { Block, Chain, PublicClient } from 'viem';
import type { Collector, CollectorStream } from '../types';
import { logger } from '../utils/logger';

/**
 * Configuration for the BlockCollectorBun
 */
export interface BlockCollectorBunConfig {
  /** Polling interval in milliseconds (for HTTP transport) */
  pollingIntervalMs?: number;
  /** Maximum queue size */
  maxQueueSize?: number;
  /** Whether to include transactions in the blocks */
  includeTransactions?: boolean;
  /** Preferred transport type ('webSocket' or 'http') */
  preferredTransport?: 'webSocket' | 'http';
}

/**
 * BlockCollectorBun - collects new blocks from an Ethereum node using a separate process
 * This implementation leverages Bun's native process APIs for better performance
 */
export class BlockCollectorBun implements Collector<Block> {
  private client: PublicClient;
  private chain: Chain;
  private config: BlockCollectorBunConfig;
  private readonly workerPath: string;

  /**
   * Create a new BlockCollectorBun
   * @param client The Ethereum client to use
   * @param config Configuration options
   */
  constructor(client: PublicClient, chain: Chain, config: BlockCollectorBunConfig = {}) {
    this.client = client;
    this.chain = chain;
    this.config = {
      pollingIntervalMs: 1000,
      maxQueueSize: 100,
      includeTransactions: false,
      preferredTransport: 'webSocket',
      ...config,
    };

    // Path to the worker script, relative to the current file
    this.workerPath = join(__dirname, 'block_collector_worker.ts');
  }

  /**
   * Create a new BlockCollectorBun with a WebSocket transport
   * @param url The WebSocket URL of the Ethereum node
   * @param chain The chain to connect to
   * @param config Configuration options
   * @returns A new BlockCollectorBun
   */
  static withWebSocket(
    url: string,
    chain: Chain,
    config: BlockCollectorBunConfig = {}
  ): BlockCollectorBun {
    // Create a mock client with the URL
    const mockClient = {
      transport: { url, type: 'webSocket' },
    } as unknown as PublicClient;

    return new BlockCollectorBun(mockClient, chain, {
      ...config,
      preferredTransport: 'webSocket',
    });
  }

  /**
   * Create a new BlockCollectorBun with an HTTP transport
   * @param url The HTTP URL of the Ethereum node
   * @param chain The chain to connect to
   * @param config Configuration options
   * @returns A new BlockCollectorBun
   */
  static withHttp(
    url: string,
    chain: Chain,
    config: BlockCollectorBunConfig = {}
  ): BlockCollectorBun {
    // Create a mock client with the URL
    const mockClient = {
      transport: { url, type: 'http' },
    } as unknown as PublicClient;

    return new BlockCollectorBun(mockClient, chain, {
      ...config,
      preferredTransport: 'http',
    });
  }

  name(): string {
    return 'BlockCollectorBun';
  }

  async getEventStream(): Promise<CollectorStream<Block>> {
    logger.debug(`Starting BlockCollectorBun with chain ID ${this.chain.id}`);

    // Queue to buffer blocks
    const queue: Block[] = [];
    // Resolvers for the async iterator
    let resolvers: ((value: IteratorResult<Block>) => void)[] = [];
    // Flag to track if the collector is done
    let done = false;

    // Capture config values for use in closures
    const maxQueueSize = this.config.maxQueueSize ?? 100;

    // Get the RPC URL from the client
    const transport = this.client.transport as Record<string, unknown>;
    const rpcUrl = transport?.url as string;

    // Prepare environment variables
    const env = {
      RPC_URL: rpcUrl,
      CHAIN_ID: this.chain.id.toString(),
      TRANSPORT_TYPE: this.config.preferredTransport,
      POLLING_INTERVAL_MS: (this.config.pollingIntervalMs ?? 1000).toString(),
      INCLUDE_TRANSACTIONS: (this.config.includeTransactions ?? false).toString(),
    };

    // Spawn the worker process
    const proc = Bun.spawn({
      cmd: [process.execPath, this.workerPath],
      env,
      ipc(message) {
        if (message && typeof message === 'object') {
          // Handle ready message
          if ('type' in message && message.type === 'ready') {
            const transportType = message.transportType;
            logger.info(`BlockCollectorBun worker ready using ${transportType} transport`);
          }

          // Handle error message
          else if ('type' in message && message.type === 'error') {
            logger.error(`BlockCollectorBun worker error: ${message.message}`);
          }

          // Handle block message
          else if ('type' in message && message.type === 'block' && 'data' in message) {
            try {
              // Parse the serialized block
              const blockData = JSON.parse(message.data as string, (key, value) => {
                // Convert string representations of bigint back to bigint
                if (typeof value === 'string' && /^\d+n$/.test(value)) {
                  return BigInt(value.slice(0, -1));
                }
                return value;
              });

              // Create a Block object
              const block = blockData as Block;

              // If there are waiting resolvers, resolve one with the block
              if (resolvers.length > 0) {
                const resolve = resolvers.shift();
                if (resolve) {
                  resolve({ done: false, value: block });
                }
              } else {
                // Otherwise, add the block to the queue
                queue.push(block);

                // Limit queue size
                if (queue.length > maxQueueSize) {
                  queue.shift();
                  logger.warn('BlockCollectorBun queue overflow, dropping oldest block');
                }
              }
            } catch (error) {
              logger.error(`Error parsing block data: ${error}`);
            }
          }
        }
      },
      onExit(proc, exitCode, signalCode, error) {
        logger.debug(`BlockCollectorBun worker exited with code ${exitCode}`);

        if (error) {
          logger.error(`BlockCollectorBun worker error: ${error}`);
        }

        // Mark as done
        done = true;

        // Resolve any waiting resolvers with done
        for (const resolver of resolvers) {
          resolver({ done: true, value: undefined as unknown });
        }
        resolvers = [];
      },
    });

    // Function to clean up resources
    const cleanup = () => {
      logger.debug('Cleaning up BlockCollectorBun resources');

      // Send stop message to the worker
      proc.send('stop');

      // Kill the process if it doesn't exit within 1 second
      setTimeout(() => {
        if (!proc.killed) {
          logger.warn('BlockCollectorBun worker did not exit gracefully, killing');
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

    // Return an async iterator that yields blocks
    return {
      async next(): Promise<IteratorResult<Block>> {
        if (done) {
          return { done: true, value: undefined as unknown };
        }

        if (queue.length > 0) {
          // If there are blocks in the queue, return one
          const block = queue.shift();
          if (block === undefined) {
            // This should never happen, but we handle it just in case
            return { done: true, value: undefined as unknown };
          }
          return { done: false, value: block };
        }

        // Otherwise, wait for a block
        return new Promise<IteratorResult<Block>>((resolve) => {
          resolvers.push(resolve);
        });
      },

      // Clean up when the iterator is done
      async return(): Promise<IteratorResult<Block>> {
        cleanup();
        return { done: true, value: undefined as unknown };
      },
    };
  }
}
