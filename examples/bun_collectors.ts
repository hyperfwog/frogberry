/**
 * Example demonstrating the use of Bun-powered collectors
 * This shows how to leverage Bun's native process APIs for better performance
 */

import type { Block } from 'viem';
import { mainnet } from 'viem/chains';
import { BlockCollectorBun } from '../collector/block_collector_bun';
import { IntervalCollectorBun } from '../collector/interval_collector_bun';
import { Engine } from '../engine';
import { PrinterExecutor } from '../executor';
import type { ActionSubmitter } from '../types';
import { LogLevel, logger } from '../utils/logger';

// Set log level to info
logger.setLevel(LogLevel.INFO);

/**
 * Simple strategy that logs events
 */
class SimpleLogStrategy {
  private count = 0;

  name(): string {
    return 'SimpleLogStrategy';
  }

  async processEvent(event: Date | Block, submitter: ActionSubmitter<string>): Promise<void> {
    this.count++;

    if (event instanceof Date) {
      const message = `Interval event #${this.count} received at ${event.toISOString()}`;
      logger.info(message);
      await submitter.submitAsync(message);
    } else {
      // It's a block
      const blockNumber = event.number?.toString() || 'unknown';
      const message = `Block #${blockNumber} received with ${event.transactions?.length || 0} transactions`;
      logger.info(message);
      await submitter.submitAsync(message);
    }
  }
}

/**
 * Run the example with the IntervalCollectorBun
 */
async function runIntervalExample() {
  logger.info('=== Running IntervalCollectorBun Example ===');

  // Create a new engine
  const engine = new Engine();

  // Add a collector that emits events every second using Bun's process APIs
  engine.addCollector(new IntervalCollectorBun(1000));

  // Add a strategy to process events
  engine.addStrategy(new SimpleLogStrategy());

  // Add an executor
  engine.addExecutor(new PrinterExecutor('IntervalCollectorBun Example'));

  // Run the engine
  logger.info('Starting engine...');
  const tasks = await engine.run();

  // Run for 5 seconds
  logger.info('Running for 5 seconds...');
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Stop the engine
  logger.info('Stopping engine...');
  await engine.stop();

  // Wait for all tasks to complete
  await Promise.all(tasks).catch((err) => {
    logger.error(`Task terminated unexpectedly: ${err}`);
  });

  logger.info('Engine stopped');
}

/**
 * Run the example with the BlockCollectorBun
 */
async function runBlockExample() {
  logger.info('\n=== Running BlockCollectorBun Example ===');

  // Create a new engine
  const engine = new Engine();

  // Add a block collector using Bun's process APIs
  const ethereumNodeUrl = 'https://eth-mainnet.g.alchemy.com/v2/demo';
  engine.addCollector(
    BlockCollectorBun.withHttp(ethereumNodeUrl, mainnet, {
      pollingIntervalMs: 5000, // Poll every 5 seconds
      includeTransactions: true,
    })
  );

  // Add a strategy to process events
  engine.addStrategy(new SimpleLogStrategy());

  // Add an executor
  engine.addExecutor(new PrinterExecutor('BlockCollectorBun Example'));

  // Run the engine
  logger.info('Starting engine...');
  const tasks = await engine.run();

  // Run for 15 seconds
  logger.info('Running for 15 seconds...');
  await new Promise((resolve) => setTimeout(resolve, 15000));

  // Stop the engine
  logger.info('Stopping engine...');
  await engine.stop();

  // Wait for all tasks to complete
  await Promise.all(tasks).catch((err) => {
    logger.error(`Task terminated unexpectedly: ${err}`);
  });

  logger.info('Engine stopped');
}

/**
 * Run both examples sequentially
 */
async function main() {
  // Register global SIGINT handler
  Engine.registerGlobalSigintHandler();

  // Run the interval example
  await runIntervalExample();

  // Run the block example
  await runBlockExample();

  logger.info('\nAll examples completed successfully!');
}

// Run the examples
main().catch((err) => {
  logger.error(`Error: ${err}`);
  process.exit(1);
});
