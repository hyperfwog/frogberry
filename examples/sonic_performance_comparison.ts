/**
 * Sonic Performance Comparison
 *
 * This example compares the performance between:
 * 1. HTTP polling (as fast as possible)
 * 2. WebSocket subscription
 *
 * It records and displays performance metrics for both approaches.
 */

import type { Block, Chain } from 'viem';
import { mainnet } from 'viem/chains';
import { BlockCollector, type BlockCollectorConfig } from '../collector';
import { BlockCollectorBun } from '../collector/block_collector_bun';
import { Engine, type EngineConfig } from '../engine';
import { PrinterExecutor } from '../executor';
import type { ActionSubmitter, Strategy } from '../types';
import { LogLevel, logger } from '../utils/logger';

// Set log level to info
logger.setLevel(LogLevel.INFO);

// Sonic RPC URLs
const httpUrl = 'https://rpc.soniclabs.com';
const wsUrl = 'wss://sonic.callstaticrpc.com';

// Performance metrics interface
interface PerformanceMetrics {
  blockCount: number;
  missedBlocks: number;
  elapsedSeconds: number;
  blocksPerSecond: number;
  avgProcessingTime: number;
  minProcessingTime: number;
  maxProcessingTime: number;
  avgBlockInterval: number;
  minBlockInterval: number;
  maxBlockInterval: number;
}

// Base performance tracking strategy
class PerformanceTrackingStrategy implements Strategy<Block, string> {
  protected blockCount = 0;
  protected startTime: number;
  protected lastBlockTime: number;
  protected blockTimes: number[] = [];
  protected blockIntervals: number[] = [];
  protected lastBlockNumber: bigint | null = null;
  protected missedBlocks = 0;
  protected name_: string;

  constructor(name: string) {
    this.name_ = name;
    this.startTime = performance.now();
    this.lastBlockTime = this.startTime;
  }

  name(): string {
    return this.name_;
  }

  async syncState(submitter: ActionSubmitter<string>): Promise<void> {
    logger.info(`Syncing ${this.name_} state...`);
    const result = await submitter.submitAsync(
      `${this.name_} initialized at ${new Date().toISOString()}`
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

    // Check for missed blocks - only if this isn't the first block we've seen
    if (this.lastBlockNumber !== null && event.number) {
      // Only count as missed if the current block number is greater than the last one
      // and there's a gap between them
      if (event.number > this.lastBlockNumber) {
        const expectedNextBlock = this.lastBlockNumber + 1n;
        if (event.number > expectedNextBlock) {
          // Calculate how many blocks we missed (should always be positive)
          const missed = Number(event.number - expectedNextBlock);
          if (missed > 0) {
            this.missedBlocks += missed;
            logger.warn(
              `[${this.name_}] Missed ${missed} blocks between ${this.lastBlockNumber} and ${event.number}`
            );
          }
        }
      }
    }

    // Update last block info
    this.lastBlockTime = now;
    this.lastBlockNumber = event.number;

    // Calculate current performance metrics
    const elapsedSeconds = (now - this.startTime) / 1000;
    const blocksPerSecond = this.blockCount / elapsedSeconds;

    // Log block information
    const message =
      `[${this.name_}] Block #${event.number} with ${event.transactions.length} transactions | ` +
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

  // Get performance metrics
  getPerformanceMetrics(): PerformanceMetrics {
    const elapsedSeconds = (performance.now() - this.startTime) / 1000;
    const blocksPerSecond = this.blockCount / elapsedSeconds;

    // Calculate statistics
    const avgProcessingTime =
      this.blockTimes.length > 0
        ? this.blockTimes.reduce((sum, time) => sum + time, 0) / this.blockTimes.length
        : 0;
    const minProcessingTime = this.blockTimes.length > 0 ? Math.min(...this.blockTimes) : 0;
    const maxProcessingTime = this.blockTimes.length > 0 ? Math.max(...this.blockTimes) : 0;

    const avgBlockInterval =
      this.blockIntervals.length > 0
        ? this.blockIntervals.reduce((sum, interval) => sum + interval, 0) /
          this.blockIntervals.length
        : 0;
    const minBlockInterval = this.blockIntervals.length > 0 ? Math.min(...this.blockIntervals) : 0;
    const maxBlockInterval = this.blockIntervals.length > 0 ? Math.max(...this.blockIntervals) : 0;

    return {
      blockCount: this.blockCount,
      missedBlocks: this.missedBlocks,
      elapsedSeconds,
      blocksPerSecond,
      avgProcessingTime,
      minProcessingTime,
      maxProcessingTime,
      avgBlockInterval,
      minBlockInterval,
      maxBlockInterval,
    };
  }

  // Get performance report
  getPerformanceReport(): string {
    const metrics = this.getPerformanceMetrics();

    return `
=== ${this.name_} Performance Report ===
Total blocks processed: ${metrics.blockCount}
Missed blocks: ${metrics.missedBlocks}
Elapsed time: ${metrics.elapsedSeconds.toFixed(2)} seconds
Blocks per second: ${metrics.blocksPerSecond.toFixed(2)}

Block processing time (time from block creation to processing):
  Average: ${metrics.avgProcessingTime.toFixed(2)}ms
  Minimum: ${metrics.minProcessingTime.toFixed(2)}ms
  Maximum: ${metrics.maxProcessingTime.toFixed(2)}ms

Block polling interval (time between receiving blocks):
  Average: ${metrics.avgBlockInterval.toFixed(2)}ms
  Minimum: ${metrics.minBlockInterval.toFixed(2)}ms
  Maximum: ${metrics.maxBlockInterval.toFixed(2)}ms
`;
  }
}

// HTTP strategy (extends base performance tracking)
class HttpBlockStrategy extends PerformanceTrackingStrategy {
  constructor() {
    super('HTTP Block Collector');
  }
}

// WebSocket strategy (extends base performance tracking)
class WebSocketBlockStrategy extends PerformanceTrackingStrategy {
  constructor() {
    super('WebSocket Block Collector');
  }
}

// Run the HTTP block collector
async function runHttpCollector(runDurationMs: number): Promise<PerformanceMetrics> {
  logger.info('\n=== Running HTTP Block Collector ===\n');

  // Engine configuration
  const engineConfig: EngineConfig = {
    eventChannelCapacity: 1000,
    actionChannelCapacity: 1000,
    eventChannelConfig: {
      throwOnLag: false,
      lagReportInterval: 10,
    },
    maxConsecutiveErrors: 5,
    initialBackoffMs: 50,
    maxBackoffMs: 1000,
    stopOnCriticalError: true,
  };

  // Block collector configuration
  const blockCollectorConfig: BlockCollectorConfig = {
    pollingIntervalMs: 0, // Poll as fast as possible (0ms interval)
    maxQueueSize: 1000,
    includeTransactions: true,
  };

  // Create a new engine
  const engine = new Engine<Block, string>(engineConfig);

  // Create a strategy instance to access performance metrics later
  const strategy = new HttpBlockStrategy();

  // Add a block collector with HTTP transport
  engine.addCollector(BlockCollectorBun.withHttp(httpUrl, mainnet, blockCollectorConfig));

  // Add the strategy
  engine.addStrategy(strategy);

  // Add an executor
  engine.addExecutor(new PrinterExecutor<string>('HTTP'));

  // Run the engine
  logger.info('Starting HTTP block collector...');
  const tasks = await engine.run();

  logger.info(`Running for ${runDurationMs / 1000} seconds...`);
  await new Promise((resolve) => setTimeout(resolve, runDurationMs));

  // Stop the engine
  logger.info('Stopping HTTP block collector...');
  await engine.stop(5000);

  // Wait for all tasks to complete
  await Promise.all(tasks).catch((err) => {
    logger.error(`Task terminated unexpectedly: ${err}`);
  });

  // Print performance report
  const report = strategy.getPerformanceReport();
  logger.info(report);

  return strategy.getPerformanceMetrics();
}

// Run the WebSocket block collector
async function runWebSocketCollector(runDurationMs: number): Promise<PerformanceMetrics> {
  logger.info('\n=== Running WebSocket Block Collector ===\n');

  // Engine configuration
  const engineConfig: EngineConfig = {
    eventChannelCapacity: 1000,
    actionChannelCapacity: 1000,
    eventChannelConfig: {
      throwOnLag: false,
      lagReportInterval: 10,
    },
    maxConsecutiveErrors: 5,
    initialBackoffMs: 50,
    maxBackoffMs: 1000,
    stopOnCriticalError: true,
  };

  // Block collector configuration
  const blockCollectorConfig: BlockCollectorConfig = {
    pollingIntervalMs: 10, // Not used for WebSocket but required by the API
    maxQueueSize: 1000,
    includeTransactions: true,
  };

  // Create a new engine
  const engine = new Engine<Block, string>(engineConfig);

  // Create a strategy instance to access performance metrics later
  const strategy = new WebSocketBlockStrategy();

  // Add a block collector with WebSocket transport
  engine.addCollector(BlockCollector.withWebSocket(wsUrl, mainnet, blockCollectorConfig));

  // Add the strategy
  engine.addStrategy(strategy);

  // Add an executor
  engine.addExecutor(new PrinterExecutor<string>('WebSocket'));

  // Run the engine
  logger.info('Starting WebSocket block collector...');
  const tasks = await engine.run();

  logger.info(`Running for ${runDurationMs / 1000} seconds...`);
  await new Promise((resolve) => setTimeout(resolve, runDurationMs));

  // Stop the engine
  logger.info('Stopping WebSocket block collector...');
  await engine.stop(5000);

  // Wait for all tasks to complete
  await Promise.all(tasks).catch((err) => {
    logger.error(`Task terminated unexpectedly: ${err}`);
  });

  // Print performance report
  const report = strategy.getPerformanceReport();
  logger.info(report);

  return strategy.getPerformanceMetrics();
}

// Compare performance metrics and generate a comparison report
function generateComparisonReport(
  httpMetrics: PerformanceMetrics,
  wsMetrics: PerformanceMetrics
): string {
  // Calculate improvements (WebSocket compared to HTTP)
  const blockCountImprovement = wsMetrics.blockCount - httpMetrics.blockCount;
  const blockCountPercentage =
    httpMetrics.blockCount > 0 ? (blockCountImprovement / httpMetrics.blockCount) * 100 : 0;

  const throughputImprovement = wsMetrics.blocksPerSecond - httpMetrics.blocksPerSecond;
  const throughputPercentage =
    httpMetrics.blocksPerSecond > 0
      ? (throughputImprovement / httpMetrics.blocksPerSecond) * 100
      : 0;

  const latencyImprovement = httpMetrics.avgProcessingTime - wsMetrics.avgProcessingTime;
  const latencyPercentage =
    httpMetrics.avgProcessingTime > 0
      ? (latencyImprovement / httpMetrics.avgProcessingTime) * 100
      : 0;

  const intervalImprovement = httpMetrics.avgBlockInterval - wsMetrics.avgBlockInterval;
  const intervalPercentage =
    httpMetrics.avgBlockInterval > 0
      ? (intervalImprovement / httpMetrics.avgBlockInterval) * 100
      : 0;

  return `
=== Sonic Block Collector Performance Comparison ===

                          HTTP                 WebSocket           Improvement
Total blocks:             ${httpMetrics.blockCount.toString().padEnd(20)} ${wsMetrics.blockCount.toString().padEnd(20)} ${blockCountImprovement} (${blockCountPercentage.toFixed(2)}%)
Blocks per second:        ${httpMetrics.blocksPerSecond.toFixed(2).padEnd(20)} ${wsMetrics.blocksPerSecond.toFixed(2).padEnd(20)} ${throughputImprovement.toFixed(2)} (${throughputPercentage.toFixed(2)}%)
Avg processing time (ms): ${httpMetrics.avgProcessingTime.toFixed(2).padEnd(20)} ${wsMetrics.avgProcessingTime.toFixed(2).padEnd(20)} ${latencyImprovement.toFixed(2)} (${latencyPercentage.toFixed(2)}%)
Avg block interval (ms):  ${httpMetrics.avgBlockInterval.toFixed(2).padEnd(20)} ${wsMetrics.avgBlockInterval.toFixed(2).padEnd(20)} ${intervalImprovement.toFixed(2)} (${intervalPercentage.toFixed(2)}%)
Missed blocks:            ${httpMetrics.missedBlocks.toString().padEnd(20)} ${wsMetrics.missedBlocks.toString().padEnd(20)} ${httpMetrics.missedBlocks - wsMetrics.missedBlocks}

Summary:
- WebSocket ${blockCountPercentage >= 0 ? 'processed' : 'processed fewer'} ${Math.abs(blockCountPercentage).toFixed(2)}% ${blockCountPercentage >= 0 ? 'more' : 'fewer'} blocks than HTTP
- Block throughput ${throughputPercentage >= 0 ? 'improved' : 'decreased'} by ${Math.abs(throughputPercentage).toFixed(2)}% (${wsMetrics.blocksPerSecond.toFixed(2)} vs ${httpMetrics.blocksPerSecond.toFixed(2)} blocks/sec)
- Average processing time ${latencyPercentage >= 0 ? 'decreased' : 'increased'} by ${Math.abs(latencyPercentage).toFixed(2)}%
- Average interval between blocks ${intervalPercentage >= 0 ? 'decreased' : 'increased'} by ${Math.abs(intervalPercentage).toFixed(2)}%

Note: WebSocket connections provide real-time updates without polling, which can reduce latency and server load.
`;
}

// Main function to run the comparison
async function main() {
  // Register global SIGINT handler
  Engine.registerGlobalSigintHandler(5000);

  // Run duration for each collector (in milliseconds)
  const runDurationMs = 30000; // 30 seconds

  // Run the HTTP collector
  const httpMetrics = await runHttpCollector(runDurationMs);

  // Wait a bit between runs
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Run the WebSocket collector
  const wsMetrics = await runWebSocketCollector(runDurationMs);

  // Generate and print comparison report
  const comparisonReport = generateComparisonReport(httpMetrics, wsMetrics);
  logger.info(comparisonReport);

  logger.info('Sonic performance comparison completed');

  // Force exit to ensure all resources are cleaned up
  process.exit(0);
}

// Add process exit hook for logging purposes
process.on('exit', (code) => {
  logger.info(`Process exiting with code ${code}`);
});

// Run the comparison
main().catch((err) => {
  logger.error(`Error: ${err}`);
  process.exit(1);
});
