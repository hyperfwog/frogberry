/**
 * HyperEVM example
 * Demonstrates how to use the Frogberry framework to monitor HyperEVM events
 */

import type { Block, Chain, Log, Transaction } from 'viem';
import { BlockCollector, type BlockCollectorConfig } from '../collector';
import { LogCollector, type LogCollectorConfig, type LogFilter } from '../collector';
import { Engine, type EngineConfig } from '../engine';
import { PrinterExecutor } from '../executor';
import type { ActionSubmitter, Strategy } from '../types';
import { LogLevel, logger } from '../utils/logger';

// Set log level to debug
logger.setLevel(LogLevel.DEBUG);

// Define event and action types
type Event = Block | Log | Transaction;
type Action = string;

// Define a simple strategy for WHYPE transfers
class WHYPETransferStrategy implements Strategy<Log, Action> {
  private transferCount = 0;

  name(): string {
    return 'WHYPETransferStrategy';
  }

  async syncState(submitter: ActionSubmitter<Action>): Promise<void> {
    logger.info('Syncing WHYPE transfer strategy state...');
    const result = await submitter.submitAsync(
      `WHYPE transfer strategy initialized at ${new Date().toISOString()}`
    );
    if (!result.success) {
      logger.warn(`Failed to submit initialization message: ${result.error}`);
    }
  }

  async processEvent(event: Log, submitter: ActionSubmitter<Action>): Promise<void> {
    this.transferCount++;

    // Extract transfer details from the log
    const from = `0x${event.topics[1]?.substring(26)}`;
    const to = `0x${event.topics[2]?.substring(26)}`;
    const value = BigInt(event.data);

    const message = `WHYPE Transfer #${this.transferCount}: ${value} from ${from} to ${to}`;
    logger.info(message);

    // Use the async submission method
    const result = await submitter.submitAsync(message);
    if (!result.success) {
      logger.warn(`Failed to submit transfer action: ${result.error}`);
    }
  }
}

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

// Define the HyperEVM chain
const hyperEvmChain: Chain = {
  id: 7979,
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

// Create and run the engines
async function main() {
  // HyperEVM RPC URL
  const nodeUrl = 'https://rpc.hyperliquid.xyz/evm';

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
  };

  // Block collector configuration
  const blockCollectorConfig: BlockCollectorConfig = {
    pollingIntervalMs: 2000,
    maxQueueSize: 50,
    includeTransactions: true,
  };

  // Log collector configuration for WHYPE transfers
  // WHYPE contract address (using 0x5555...5555 as an example)
  const whypeAddress = '0x5555555555555555555555555555555555555555';

  // Transfer event signature: Transfer(address indexed src, address indexed dst, uint wad)
  const transferEventSignature =
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

  const logFilter: LogFilter = {
    address: whypeAddress,
    topics: [transferEventSignature],
  };

  const logCollectorConfig: LogCollectorConfig = {
    pollingIntervalMs: 2000,
    maxQueueSize: 100,
    blockRange: 50,
  };

  // Register the global SIGINT handler
  Engine.registerGlobalSigintHandler(5000);

  // Create a block engine (no need for individual SIGINT handlers now)
  const blockEngine = new Engine<Block, Action>(engineConfig);
  blockEngine.addCollector(BlockCollector.withHttp(nodeUrl, hyperEvmChain, blockCollectorConfig));
  blockEngine.addStrategy(new BlockStrategy());
  blockEngine.addExecutor(new PrinterExecutor<Action>('Block'));

  // Create a log engine for WHYPE transfers
  const logEngine = new Engine<Log, Action>(engineConfig);
  logEngine.addCollector(
    LogCollector.withHttp(nodeUrl, hyperEvmChain, logFilter, logCollectorConfig)
  );
  logEngine.addStrategy(new WHYPETransferStrategy());
  logEngine.addExecutor(new PrinterExecutor<Action>('WHYPE'));

  // Run the engines
  logger.info('Starting engines...');

  // Run all engines
  const blockTasks = await blockEngine.run();
  logger.info('Block engine started');

  const logTasks = await logEngine.run();
  logger.info('WHYPE transfer engine started');

  // Run for 30 seconds
  logger.info('Running for 10 seconds...');
  await new Promise((resolve) => setTimeout(resolve, 10_000));

  // Stop all engines with a 5-second timeout
  logger.info('Stopping engines...');
  await Promise.all([blockEngine.stop(5000), logEngine.stop(5000)]);

  // Wait for all tasks to complete
  await Promise.all([...blockTasks, ...logTasks]).catch((err) => {
    logger.error(`Task terminated unexpectedly: ${err}`);
  });

  logger.info('All engines stopped');
  // Force exit the process to ensure all resources are cleaned up
  process.exit(0);
}

// Add process exit hook for logging purposes only
process.on('exit', (code) => {
  logger.info(`Process exiting with code ${code}`);
  // Perform any cleanup here if needed
});

// Note: We don't need to add a SIGINT handler here anymore
// The global SIGINT handler registered with Engine.registerGlobalSigintHandler()
// will handle graceful shutdown of all engines

// Run the example
main().catch((err) => {
  logger.error(`Error: ${err}`);
  process.exit(1);
});
