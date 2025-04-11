/**
 * HyperEVM Fast Polling Example
 *
 * This example demonstrates how to poll blocks from HyperEVM as fast as possible
 * using the Bun-powered block collector. It also records and displays performance metrics.
 */

import type { Block, Chain } from 'viem';
import { BlockCollectorBun } from '../collector/block_collector_bun';
import { Engine, type EngineConfig } from '../engine';
import { PrinterExecutor } from '../executor';
import type { ActionSubmitter, Strategy } from '../types';
import { LogLevel, logger } from '../utils/logger';

// Set log level to info
logger.setLevel(LogLevel.INFO);

// Define the HyperEVM chain
const hyperEvmChain: Chain = {
  id: 999,
  name: 'HyperEVM',
  nativeCurrency: {
    decimals: 18,
    name: 'HYPE',
    symbol: 'HYPE',
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.hyperliquid.xyz/evm'],
    },
    public: {
      http: ['https://rpc.hyperliquid.xyz/evm'],
    },
  },
};

// Define a strategy that processes blocks and records performance metrics
class FastBlockStrategy implements Strategy<Block, string> {
  private blockCount = 0;
  private startTime: number;
  private lastBlockTime: number;
  private blockTimes: number[] = [];
  private blockIntervals: number[] = [];
  private lastBlockNumber: bigint | null = null;
  private missedBlocks = 0;

  constructor() {
    this.startTime = performance.now();
    this.lastBlockTime = this.startTime;
  }

  name(): string {
    return 'FastBlockStrategy';
  }

  async syncState(submitter: ActionSubmitter<string>): Promise<void> {
    logger.info('Syncing fast block strategy state...');
    const result = await submitter.submitAsync(
      `Fast block strategy initialized at ${new Date().toISOString()}`
    );
    if (!result.success) {
      logger.warn(`Failed to submit initialization message: ${result.error}`);
    }
  }

  async processEvent(event: Block, submitter: ActionSubmitter<string>): Promise<void> {
    const now = performance.now();
    this.blockCount++;

    // Calculate time since last block
    const timeSinceLastBlock = now - this.lastBlockTime;
    this.blockIntervals.push(timeSinceLastBlock);

    // Calculate processing time (from block timestamp to now)
    const blockTimestamp = Number(event.timestamp) * 1000; // Convert to milliseconds
    const processingTime = Date.now() - blockTimestamp;
    this.blockTimes.push(processingTime);

    // Check for missed blocks
    if (this.lastBlockNumber !== null && event.number) {
      // Make sure both are defined and event.number is greater
      if (event.number > this.lastBlockNumber) {
        const expectedNextBlock = this.lastBlockNumber + 1n;
        if (event.number > expectedNextBlock) {
          const missed = Number(event.number - expectedNextBlock);
          this.missedBlocks += missed;
          logger.warn(
            `Missed ${missed} blocks between ${this.lastBlockNumber} and ${event.number}`
          );
        }
      }
    }

    // Update last block info
    this.lastBlockTime = now;
    this.lastBlockNumber = event.number;

    // Calculate current performance metrics
    const elapsedSeconds = (now - this.startTime) / 1000;
    const blocksPerSecond = this.blockCount / elapsedSeconds;
    const avgProcessingTime =
      this.blockTimes.reduce((sum, time) => sum + time, 0) / this.blockTimes.length;
    const avgBlockInterval =
      this.blockIntervals.reduce((sum, interval) => sum + interval, 0) / this.blockIntervals.length;

    // Log block information
    const message =
      `Block #${event.number} with ${event.transactions.length} transactions | ` +
      `Processing time: ${processingTime.toFixed(2)}ms | ` +
      `Interval: ${timeSinceLastBlock.toFixed(2)}ms | ` +
      `Blocks/sec: ${blocksPerSecond.toFixed(2)} | ` +
      `Missed blocks: ${this.missedBlocks}`;

    logger.info(message);

    // Submit the message
    const result = await submitter.submitAsync(message);
    if (!result.success) {
      logger.warn(`Failed to submit block action: ${result.error}`);
    }
  }

  // Get performance report
  getPerformanceReport(): string {
    const elapsedSeconds = (performance.now() - this.startTime) / 1000;
    const blocksPerSecond = this.blockCount / elapsedSeconds;

    // Calculate statistics
    const avgProcessingTime =
      this.blockTimes.reduce((sum, time) => sum + time, 0) / this.blockTimes.length;
    const minProcessingTime = Math.min(...this.blockTimes);
    const maxProcessingTime = Math.max(...this.blockTimes);

    const avgBlockInterval =
      this.blockIntervals.reduce((sum, interval) => sum + interval, 0) / this.blockIntervals.length;
    const minBlockInterval = Math.min(...this.blockIntervals);
    const maxBlockInterval = Math.max(...this.blockIntervals);

    return `
=== HyperEVM Fast Polling Performance Report ===
Total blocks processed: ${this.blockCount}
Missed blocks: ${this.missedBlocks}
Elapsed time: ${elapsedSeconds.toFixed(2)} seconds
Blocks per second: ${blocksPerSecond.toFixed(2)}

Block processing time (time from block creation to processing):
  Average: ${avgProcessingTime.toFixed(2)}ms
  Minimum: ${minProcessingTime.toFixed(2)}ms
  Maximum: ${maxProcessingTime.toFixed(2)}ms

Block polling interval (time between receiving blocks):
  Average: ${avgBlockInterval.toFixed(2)}ms
  Minimum: ${minBlockInterval.toFixed(2)}ms
  Maximum: ${maxBlockInterval.toFixed(2)}ms
`;
  }
}

// Main function to run the example
async function main() {
  // HyperEVM RPC URL
  const nodeUrl = 'https://rpc.hyperliquid.xyz/evm';

  // Engine configuration
  const engineConfig: EngineConfig = {
    eventChannelCapacity: 1000, // Increased capacity for high throughput
    actionChannelCapacity: 1000,
    eventChannelConfig: {
      throwOnLag: false,
      lagReportInterval: 10,
    },
    maxConsecutiveErrors: 5,
    initialBackoffMs: 50, // Reduced backoff for faster recovery
    maxBackoffMs: 1000,
    stopOnCriticalError: true,
  };

  // Create a new engine
  const engine = new Engine<Block, string>(engineConfig);

  // Create a strategy instance to access performance metrics later
  const strategy = new FastBlockStrategy();

  // Add a block collector with minimal polling interval (10ms)
  // Note: The actual polling rate may be limited by network latency and RPC rate limits
  engine.addCollector(
    BlockCollectorBun.withHttp(nodeUrl, hyperEvmChain, {
      pollingIntervalMs: 10, // Poll as fast as possible (10ms)
      maxQueueSize: 1000, // Increased queue size
      includeTransactions: true,
    })
  );

  // Add the strategy
  engine.addStrategy(strategy);

  // Add an executor
  engine.addExecutor(new PrinterExecutor<string>('HyperEVM Fast Polling'));

  // Register global SIGINT handler
  Engine.registerGlobalSigintHandler(5000);

  // Run the engine
  logger.info('Starting HyperEVM fast polling...');
  const tasks = await engine.run();

  // Run duration (in milliseconds)
  const runDurationMs = 10000; // 10 seconds

  logger.info(`Running for ${runDurationMs / 1000} seconds...`);
  await new Promise((resolve) => setTimeout(resolve, runDurationMs));

  // Stop the engine
  logger.info('Stopping engine...');
  await engine.stop(5000);

  // Wait for all tasks to complete
  await Promise.all(tasks).catch((err) => {
    logger.error(`Task terminated unexpectedly: ${err}`);
  });

  // Print performance report
  const report = strategy.getPerformanceReport();
  logger.info(report);

  logger.info('HyperEVM fast polling example completed');

  // Force exit to ensure all resources are cleaned up
  process.exit(0);
}

// Add process exit hook for logging purposes
process.on('exit', (code) => {
  logger.info(`Process exiting with code ${code}`);
});

// Run the example
main().catch((err) => {
  logger.error(`Error: ${err}`);
  process.exit(1);
});
