/**
 * Mempool collector
 * Improved version with WebSocket subscription support and better memory management
 */

import {
  http,
  type Chain,
  type Hash,
  type PublicClient,
  type Transaction,
  createPublicClient,
  webSocket,
} from 'viem';
import type { Collector, CollectorStream } from '../types';
import { logger } from '../utils/logger';

/**
 * Configuration for the MempoolCollector
 */
export interface MempoolCollectorConfig {
  /** Polling interval in milliseconds (for HTTP transport) */
  pollingIntervalMs?: number;
  /** Maximum queue size */
  maxQueueSize?: number;
  /** Maximum number of pending transactions to track */
  maxPendingTxs?: number;
  /** Maximum number of processed transactions to track */
  maxProcessedTxs?: number;
  /** Maximum number of concurrent transaction fetches */
  maxConcurrentFetches?: number;
}

/**
 * MempoolCollector - collects pending transactions from an Ethereum node
 */
export class MempoolCollector implements Collector<Transaction> {
  private client: PublicClient;
  private config: MempoolCollectorConfig;
  private pendingTxHashes: Set<Hash> = new Set();
  private processedTxHashes: Set<Hash> = new Set();
  private isWebSocket: boolean;

  /**
   * Create a new MempoolCollector
   * @param client The Ethereum client to use
   * @param config Configuration options
   */
  constructor(client: PublicClient, config: MempoolCollectorConfig = {}) {
    this.client = client;
    this.config = {
      pollingIntervalMs: 1000,
      maxQueueSize: 1000,
      maxPendingTxs: 5000,
      maxProcessedTxs: 10000,
      maxConcurrentFetches: 5,
      ...config,
    };

    // Determine if the client uses WebSocket transport
    this.isWebSocket = (this.client.transport as any)?.type === 'webSocket';
  }

  /**
   * Create a new MempoolCollector with a WebSocket transport
   * @param url The WebSocket URL of the Ethereum node
   * @param chain The chain to connect to
   * @param config Configuration options
   * @returns A new MempoolCollector
   */
  static withWebSocket(
    url: string,
    chain: Chain,
    config: MempoolCollectorConfig = {}
  ): MempoolCollector {
    const client = createPublicClient({
      transport: webSocket(url),
      chain,
    });
    return new MempoolCollector(client, config);
  }

  /**
   * Create a new MempoolCollector with an HTTP transport
   * @param url The HTTP URL of the Ethereum node
   * @param chain The chain to connect to
   * @param config Configuration options
   * @returns A new MempoolCollector
   */
  static withHttp(
    url: string,
    chain: Chain,
    config: MempoolCollectorConfig = {}
  ): MempoolCollector {
    const client = createPublicClient({
      transport: http(url),
      chain,
    });
    return new MempoolCollector(client, config);
  }

  name(): string {
    return 'MempoolCollector';
  }

  async getEventStream(): Promise<CollectorStream<Transaction>> {
    // Create a queue to buffer transactions
    const queue: Transaction[] = [];
    let resolvers: ((value: IteratorResult<Transaction>) => void)[] = [];
    let done = false;
    let cleanupFn: (() => void) | null = null;

    if (this.isWebSocket) {
      // Use WebSocket subscription for real-time pending transactions
      logger.info('Using WebSocket subscription for pending transactions');

      let intervalId: NodeJS.Timeout | null = null;
      let abortController = new AbortController();
      let isPolling = false;

      try {
        // Create a filter for pending transactions
        const filterId = await this.client.createPendingTransactionFilter();

        // Set up a polling mechanism for the filter
        const pollFilterChanges = async () => {
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

            const txHashes = await this.client.getFilterChanges({ filter: filterId });

            // Check if we're done before processing hashes
            if (done || abortController.signal.aborted) {
              isPolling = false;
              return;
            }

            // Process new transaction hashes
            await this.processTxHashes(txHashes as Hash[], queue, resolvers, abortController);
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
          logger.debug('Cleaning up MempoolCollector WebSocket resources');

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
            resolver({ done: true, value: undefined as any });
          }
          resolvers = [];

          // Clear the queue
          queue.length = 0;

          // Clear the pending and processed sets
          this.pendingTxHashes.clear();
          this.processedTxHashes.clear();
        };
      } catch (error) {
        logger.error(`Failed to set up WebSocket subscription: ${error}`);
        // Fall back to polling if subscription fails
        logger.warn('Falling back to polling for pending transactions');
        return this.getPollingEventStream();
      }
    } else {
      // Use polling for HTTP transport
      logger.info('Using polling for pending transactions');
      return this.getPollingEventStream();
    }

    // Return an async iterator that yields transactions
    return {
      async next(): Promise<IteratorResult<Transaction>> {
        if (done) {
          return { done: true, value: undefined as any };
        }

        if (queue.length > 0) {
          // If there are transactions in the queue, return one
          return { done: false, value: queue.shift()! };
        }

        // Otherwise, wait for a transaction
        return new Promise<IteratorResult<Transaction>>((resolve) => {
          resolvers.push(resolve);
        });
      },

      // Clean up when the iterator is done
      async return(): Promise<IteratorResult<Transaction>> {
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
  private async getPollingEventStream(): Promise<CollectorStream<Transaction>> {
    // Create a queue to buffer transactions
    const queue: Transaction[] = [];
    let resolvers: ((value: IteratorResult<Transaction>) => void)[] = [];
    let done = false;
    let intervalId: NodeJS.Timeout | null = null;
    let abortController = new AbortController();
    let isPolling = false; // Flag to prevent concurrent polling

    // Create a polling mechanism for pending transactions with exponential backoff
    let currentInterval = this.config.pollingIntervalMs!;
    let consecutiveErrors = 0;

    const pollTxs = async () => {
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
        const block = await this.client.getBlock();

        // Check if we're done before processing
        if (done || abortController.signal.aborted) {
          isPolling = false;
          return;
        }

        // Get transactions from the latest block
        // In a real implementation, we would use a proper mempool API
        // but for this example, we'll just use the transactions from the latest block
        const txHashes = block.transactions;

        // Process new transaction hashes
        await this.processTxHashes(txHashes, queue, resolvers, abortController);

        // Reset backoff on success
        if (consecutiveErrors > 0) {
          consecutiveErrors = 0;
          currentInterval = this.config.pollingIntervalMs!;
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = setInterval(pollTxs, currentInterval);
          }
        }
      } catch (error) {
        if (done || abortController.signal.aborted) {
          isPolling = false;
          return;
        }

        logger.error(`Error in MempoolCollector: ${error}`);

        // Implement exponential backoff
        consecutiveErrors++;
        if (consecutiveErrors > 3) {
          const newInterval = Math.min(currentInterval * 2, 30000); // Max 30 seconds
          if (newInterval !== currentInterval) {
            currentInterval = newInterval;
            if (intervalId) {
              clearInterval(intervalId);
              intervalId = setInterval(pollTxs, currentInterval);
            }
            logger.warn(`Increasing polling interval to ${currentInterval}ms due to errors`);
          }
        }
      } finally {
        isPolling = false;
      }
    };

    // Start the polling interval
    intervalId = setInterval(pollTxs, currentInterval);

    // Function to clean up
    const cleanup = () => {
      logger.debug('Cleaning up MempoolCollector polling resources');

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

      // Clear the pending and processed sets
      this.pendingTxHashes.clear();
      this.processedTxHashes.clear();

      // Set the global forced shutdown flag to ensure any in-progress operations stop
      (global as any).__BURBERRY_FORCED_SHUTDOWN__ = true;

      // Clear any pending sets to prevent further processing
      this.pendingTxHashes.clear();
      this.processedTxHashes.clear();
    };

    // Return an async iterator that yields transactions
    return {
      async next(): Promise<IteratorResult<Transaction>> {
        if (done) {
          return { done: true, value: undefined as any };
        }

        if (queue.length > 0) {
          // If there are transactions in the queue, return one
          return { done: false, value: queue.shift()! };
        }

        // Otherwise, wait for a transaction
        return new Promise<IteratorResult<Transaction>>((resolve) => {
          resolvers.push(resolve);
        });
      },

      // Clean up when the iterator is done
      async return(): Promise<IteratorResult<Transaction>> {
        cleanup();
        return { done: true, value: undefined as any };
      },
    };
  }

  /**
   * Process transaction hashes
   * @param txHashes The transaction hashes to process
   * @param queue The queue to add transactions to
   * @param resolvers The resolvers to resolve with transactions
   * @param abortController Optional abort controller to cancel operations
   */
  private async processTxHashes(
    txHashes: Hash[],
    queue: Transaction[],
    resolvers: ((value: IteratorResult<Transaction>) => void)[],
    abortController?: AbortController
  ): Promise<void> {
    // Check if we're done before processing
    if (abortController?.signal.aborted || (global as any).__BURBERRY_FORCED_SHUTDOWN__) {
      return;
    }
    // Limit the number of pending transactions to avoid memory leaks
    if (this.pendingTxHashes.size >= this.config.maxPendingTxs!) {
      const oldestTxHashes = Array.from(this.pendingTxHashes).slice(0, txHashes.length);
      for (const txHash of oldestTxHashes) {
        this.pendingTxHashes.delete(txHash);
      }
      logger.warn(
        `MempoolCollector pending set overflow, dropping ${oldestTxHashes.length} oldest hashes`
      );
    }

    // Process new transaction hashes
    for (const txHash of txHashes) {
      // Skip if we've already processed this transaction
      if (this.processedTxHashes.has(txHash)) {
        continue;
      }

      // Add to pending set
      this.pendingTxHashes.add(txHash);
    }

    // Process pending transactions in batches to avoid too many concurrent requests
    const pendingTxHashesArray = Array.from(this.pendingTxHashes);
    const batchSize = this.config.maxConcurrentFetches!;

    for (let i = 0; i < pendingTxHashesArray.length; i += batchSize) {
      const batch = pendingTxHashesArray.slice(i, i + batchSize);

      // Fetch transactions in parallel
      const promises = batch.map(async (txHash) => {
        try {
          // Get the transaction
          const tx = await this.client.getTransaction({
            hash: txHash,
          });

          // Remove from pending set and add to processed set
          this.pendingTxHashes.delete(txHash);
          this.processedTxHashes.add(txHash);

          // Limit the size of the processed set to avoid memory leaks
          if (this.processedTxHashes.size > this.config.maxProcessedTxs!) {
            const oldestTxHashes = Array.from(this.processedTxHashes).slice(0, 100);
            for (const oldTxHash of oldestTxHashes) {
              this.processedTxHashes.delete(oldTxHash);
            }
          }

          return tx;
        } catch (error) {
          // Transaction might have been removed from the mempool
          this.pendingTxHashes.delete(txHash);
          logger.debug(`Error getting transaction ${txHash}: ${error}`);
          return null;
        }
      });

      // Wait for all transactions in the batch to be fetched
      const transactions = await Promise.all(promises);

      // Process the transactions
      for (const tx of transactions) {
        if (tx === null) continue;

        if (resolvers.length > 0) {
          // If there are waiting resolvers, resolve one with the transaction
          const resolve = resolvers.shift()!;
          resolve({ done: false, value: tx });
        } else {
          // Otherwise, add the transaction to the queue
          queue.push(tx);

          // Limit queue size
          if (queue.length > this.config.maxQueueSize!) {
            queue.shift();
            logger.warn('MempoolCollector queue overflow, dropping oldest transaction');
          }
        }
      }
    }
  }
}
