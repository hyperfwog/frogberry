/**
 * Ethereum example
 * Demonstrates how to use the Ethereum collectors with improved features
 */

import type { Block, Log, Transaction } from 'viem';
import { mainnet } from 'viem/chains';
import { BlockCollector, type BlockCollectorConfig } from '../collector';
import { LogCollector, type LogCollectorConfig, type LogFilter } from '../collector';
import { MempoolCollector, type MempoolCollectorConfig } from '../collector';
import { Engine, type EngineConfig } from '../engine';
import { PrinterExecutor } from '../executor';
import type { ActionSubmitter, Strategy } from '../types';
import { LogLevel, logger } from '../utils/logger';

// Set log level to debug
logger.setLevel(LogLevel.DEBUG);

// Define event and action types
type Event = Block | Log | Transaction;
type Action = string;

// Define a simple strategy for blocks
class BlockStrategy implements Strategy<Block, Action> {
  private blockCount = 0;

  name(): string {
    return 'BlockStrategy';
  }

  async syncState(submitter: ActionSubmitter<Action>): Promise<void> {
    logger.info('Syncing block strategy state...');
    const result = await submitter.submitAsync(
      `Block strategy initialized at ${new Date().toISOString()}`
    );
    if (!result.success) {
      logger.warn(`Failed to submit initialization message: ${result.error}`);
    }
  }

  async processEvent(event: Block, submitter: ActionSubmitter<Action>): Promise<void> {
    this.blockCount++;
    const message = `New block #${this.blockCount}: ${event.number} with ${event.transactions.length} transactions`;
    logger.info(message);

    // Use the async submission method
    const result = await submitter.submitAsync(message);
    if (!result.success) {
      logger.warn(`Failed to submit block action: ${result.error}`);
    }
  }
}

// Define a simple strategy for logs
class LogStrategy implements Strategy<Log, Action> {
  private logCount = 0;

  name(): string {
    return 'LogStrategy';
  }

  async syncState(submitter: ActionSubmitter<Action>): Promise<void> {
    logger.info('Syncing log strategy state...');
    const result = await submitter.submitAsync(
      `Log strategy initialized at ${new Date().toISOString()}`
    );
    if (!result.success) {
      logger.warn(`Failed to submit initialization message: ${result.error}`);
    }
  }

  async processEvent(event: Log, submitter: ActionSubmitter<Action>): Promise<void> {
    this.logCount++;
    const message = `New log #${this.logCount}: ${event.address} with topics ${event.topics.join(', ')}`;
    logger.info(message);

    // Use the async submission method
    const result = await submitter.submitAsync(message);
    if (!result.success) {
      logger.warn(`Failed to submit log action: ${result.error}`);
    }
  }
}

// Define a simple strategy for transactions
class TransactionStrategy implements Strategy<Transaction, Action> {
  private txCount = 0;

  name(): string {
    return 'TransactionStrategy';
  }

  async syncState(submitter: ActionSubmitter<Action>): Promise<void> {
    logger.info('Syncing transaction strategy state...');
    const result = await submitter.submitAsync(
      `Transaction strategy initialized at ${new Date().toISOString()}`
    );
    if (!result.success) {
      logger.warn(`Failed to submit initialization message: ${result.error}`);
    }
  }

  async processEvent(event: Transaction, submitter: ActionSubmitter<Action>): Promise<void> {
    this.txCount++;
    const message = `New transaction #${this.txCount}: ${event.hash} from ${event.from} to ${event.to || 'contract creation'}`;
    logger.info(message);

    // Use the async submission method
    const result = await submitter.submitAsync(message);
    if (!result.success) {
      logger.warn(`Failed to submit transaction action: ${result.error}`);
    }
  }
}

// Create and run the engines
async function main() {
  // Replace with your Sonic node URL
  const nodeUrl = 'https://rpc.soniclabs.com';
  const wsUri = 'wss://sonic.callstaticrpc.com';

  // Common engine configuration
  const engineConfig: EngineConfig = {
    eventChannelCapacity: 100,
    actionChannelCapacity: 100,
    eventChannelConfig: {
      throwOnLag: false,
      lagReportInterval: 10,
    },
    maxConsecutiveErrors: 3,
    initialBackoffMs: 100,
    maxBackoffMs: 5000,
    stopOnCriticalError: true,
    registerSigintHandler: true,
    sigintShutdownTimeoutMs: 10000,
    exitProcessOnSigint: true,
  };

  // Block collector configuration
  const blockCollectorConfig: BlockCollectorConfig = {
    pollingIntervalMs: 2000,
    maxQueueSize: 50,
    includeTransactions: true,
  };

  // Log collector configuration
  const logFilter: LogFilter = {
    // Filter for Transfer events from the USDC contract
    address: '0x29219dd400f2bf60e5a23d13be72b486d4038894',
    topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'],
  };

  const logCollectorConfig: LogCollectorConfig = {
    pollingIntervalMs: 2000,
    maxQueueSize: 100,
    blockRange: 50,
  };

  // Mempool collector configuration
  const mempoolCollectorConfig: MempoolCollectorConfig = {
    pollingIntervalMs: 1000,
    maxQueueSize: 200,
    maxPendingTxs: 1000,
    maxProcessedTxs: 5000,
    maxConcurrentFetches: 10,
  };

  // Create a block engine with WebSocket transport for real-time block updates
  const blockEngine = new Engine<Block, Action>(engineConfig);
  blockEngine.addCollector(BlockCollector.withWebSocket(wsUri, mainnet, blockCollectorConfig));
  blockEngine.addStrategy(new BlockStrategy());
  blockEngine.addExecutor(new PrinterExecutor<Action>('Block'));

  // Create a log engine
  const logEngine = new Engine<Log, Action>(engineConfig);
  logEngine.addCollector(LogCollector.withHttp(nodeUrl, mainnet, logFilter, logCollectorConfig));
  logEngine.addStrategy(new LogStrategy());
  logEngine.addExecutor(new PrinterExecutor<Action>('Log'));

  // Create a transaction engine
  const txEngine = new Engine<Transaction, Action>(engineConfig);
  txEngine.addCollector(MempoolCollector.withHttp(nodeUrl, mainnet, mempoolCollectorConfig));
  txEngine.addStrategy(new TransactionStrategy());
  txEngine.addExecutor(new PrinterExecutor<Action>('Transaction'));

  // Run the engines
  logger.info('Starting engines...');

  // Run all engines
  const blockTasks = await blockEngine.run();
  logger.info('Block engine started');

  const logTasks = await logEngine.run();
  logger.info('Log engine started');

  const txTasks = await txEngine.run();
  logger.info('Transaction engine started');

  // Run for 10 seconds
  logger.info('Running for 10 seconds...');
  await new Promise((resolve) => setTimeout(resolve, 10000));

  // Stop all engines with a 10-second timeout
  logger.info('Stopping engines...');
  await Promise.all([blockEngine.stop(10000), logEngine.stop(10000), txEngine.stop(10000)]);

  // Wait for all tasks to complete
  await Promise.all([...blockTasks, ...logTasks, ...txTasks]).catch((err) => {
    logger.error(`Task terminated unexpectedly: ${err}`);
  });

  logger.info('All engines stopped');

  // Force exit the process to ensure all background operations are terminated
  process.exit(0);
}

// Run the example
main().catch((err) => {
  logger.error(`Error: ${err}`);
  process.exit(1);
});
