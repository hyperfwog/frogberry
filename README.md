# Frogberry <img src="frogberry.png" alt="Frogberry" title="Frogberry" width="96" height="96" align="right" />

A TypeScript/Bun port of the [Burberry](https://github.com/tonyke-bot/burberry) framework, which is a fork of [Artemis](https://github.com/paradigmxyz/artemis/) with modifications.

## Installation

You can install Frogberry directly from GitHub:

```bash
bun add https://github.com/hyperfwog/frogberry.git
```

## Overview

Frogberry is a framework for building trading bots and other event-driven applications. It provides a clean architecture for collecting events, processing them with strategies, and executing actions.

## Core Components

### Collector

Collectors are responsible for gathering events from various sources, such as blockchain nodes, APIs, or time-based intervals. They implement the `Collector<E>` interface:

```typescript
interface Collector<E> {
  name(): string;
  getEventStream(): Promise<CollectorStream<E>>;
}
```

### Strategy

Strategies process events and decide what actions to take. They implement the `Strategy<E, A>` interface:

```typescript
interface Strategy<E, A> {
  name(): string;
  syncState?(submitter: ActionSubmitter<A>): Promise<void>;
  processEvent(event: E, submitter: ActionSubmitter<A>): Promise<void>;
}
```

### ActionSubmitter

Action submitters are responsible for submitting actions to be executed. They implement the `ActionSubmitter<A>` interface:

```typescript
interface ActionSubmitter<A> {
  submit(action: A): void;
}
```

### Executor

Executors are responsible for executing actions. They implement the `Executor<A>` interface:

```typescript
interface Executor<A> {
  name(): string;
  execute(action: A): Promise<void>;
}
```

### Engine

The Engine coordinates collectors, strategies, and executors. It creates channels for events and actions, and spawns tasks to run each component.

```typescript
const engine = new Engine<Event, Action>();
engine.addCollector(collector);
engine.addStrategy(strategy);
engine.addExecutor(executor);
await engine.runAndJoin();
```

## Examples

### Basic Example

Here's a simple example that uses an interval collector to emit events every second, and a strategy that logs the events and submits actions:

```typescript
import { Engine } from './engine';
import { IntervalCollector } from './collector/interval_collector';
import { Dummy } from './executor/dummy';
import { PrinterExecutor } from './executor/printer';
import { Strategy, ActionSubmitter } from './types';
import { logger, LogLevel } from './utils/logger';

// Define event and action types
type Event = Date;
type Action = string;

// Define a simple strategy
class SimpleStrategy implements Strategy<Event, Action> {
  name(): string {
    return "SimpleStrategy";
  }

  async processEvent(event: Event, submitter: ActionSubmitter<Action>): Promise<void> {
    const message = `Event received at ${event.toISOString()}`;
    logger.info(message);
    submitter.submit(message);
  }
}

// Create and run the engine
async function main() {
  const engine = new Engine<Event, Action>();
  engine.addCollector(new IntervalCollector(1000));
  engine.addStrategy(new SimpleStrategy());
  engine.addExecutor(new Dummy<Action>());
  engine.addExecutor(new PrinterExecutor<Action>());
  
  logger.info("Starting engine...");
  await engine.runAndJoin();
}

main().catch(err => {
  logger.error(`Error: ${err}`);
  process.exit(1);
});
```

### High-Performance Block Collection with WebSockets

This example demonstrates high-performance block collection from Sonic using WebSockets. Performance testing shows that WebSocket connections provide better throughput and lower latency compared to HTTP polling:

```typescript
import type { Block } from 'viem';
import { mainnet } from 'viem/chains';
import { BlockCollector, type BlockCollectorConfig } from './collector';
import { Engine, type EngineConfig } from './engine';
import { PrinterExecutor } from './executor';
import type { ActionSubmitter, Strategy } from './types';
import { LogLevel, logger } from './utils/logger';

// Set log level to info
logger.setLevel(LogLevel.INFO);

// Define a strategy for processing blocks
class BlockPerformanceStrategy implements Strategy<Block, string> {
  private blockCount = 0;
  private startTime: number;
  private lastBlockTime: number;
  private blockIntervals: number[] = [];
  
  constructor() {
    this.startTime = performance.now();
    this.lastBlockTime = this.startTime;
  }

  name(): string {
    return 'BlockPerformanceStrategy';
  }

  async syncState(submitter: ActionSubmitter<string>): Promise<void> {
    logger.info('Syncing block strategy state...');
    await submitter.submitAsync(
      `Block strategy initialized at ${new Date().toISOString()}`
    );
  }

  async processEvent(event: Block, submitter: ActionSubmitter<string>): Promise<void> {
    const now = performance.now();
    this.blockCount++;
    
    // Calculate time since last block
    const timeSinceLastBlock = now - this.lastBlockTime;
    this.blockIntervals.push(timeSinceLastBlock);
    
    // Update last block time
    this.lastBlockTime = now;
    
    // Calculate current performance metrics
    const elapsedSeconds = (now - this.startTime) / 1000;
    const blocksPerSecond = this.blockCount / elapsedSeconds;
    
    // Log block information
    const message = `Block #${event.number} with ${event.transactions.length} transactions | ` +
      `Interval: ${timeSinceLastBlock.toFixed(2)}ms | ` +
      `Blocks/sec: ${blocksPerSecond.toFixed(2)}`;
    
    logger.info(message);
    await submitter.submitAsync(message);
  }
  
  // Get performance report after running
  getPerformanceReport(): string {
    const elapsedSeconds = (performance.now() - this.startTime) / 1000;
    const blocksPerSecond = this.blockCount / elapsedSeconds;
    
    const avgBlockInterval = this.blockIntervals.length > 0 
      ? this.blockIntervals.reduce((sum, interval) => sum + interval, 0) / this.blockIntervals.length 
      : 0;
    
    return `
=== Block Collection Performance Report ===
Total blocks processed: ${this.blockCount}
Elapsed time: ${elapsedSeconds.toFixed(2)} seconds
Blocks per second: ${blocksPerSecond.toFixed(2)}
Average block interval: ${avgBlockInterval.toFixed(2)}ms
`;
  }
}

// Main function to run the high-performance block collector
async function main() {
  // Sonic WebSocket URL
  const wsUrl = 'wss://sonic.callstaticrpc.com';
  
  // Engine configuration optimized for performance
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
  
  // Block collector configuration
  const blockCollectorConfig: BlockCollectorConfig = {
    pollingIntervalMs: 10, // Not used for WebSocket but required by the API
    maxQueueSize: 1000,    // Increased queue size for high throughput
    includeTransactions: true,
  };
  
  // Create a new engine
  const engine = new Engine<Block, string>(engineConfig);
  
  // Create a strategy instance to track performance
  const strategy = new BlockPerformanceStrategy();
  
  // Add a block collector with WebSocket transport for optimal performance
  engine.addCollector(
    BlockCollector.withWebSocket(wsUrl, mainnet, blockCollectorConfig)
  );
  
  // Add the strategy
  engine.addStrategy(strategy);
  
  // Add an executor
  engine.addExecutor(new PrinterExecutor<string>('Block'));
  
  // Register global SIGINT handler
  Engine.registerGlobalSigintHandler(5000);
  
  // Run the engine
  logger.info('Starting high-performance block collector...');
  const tasks = await engine.run();
  
  // Run for 30 seconds
  logger.info('Running for 30 seconds...');
  await new Promise((resolve) => setTimeout(resolve, 30000));
  
  // Stop the engine
  logger.info('Stopping engine...');
  await engine.stop(5000);
  
  // Wait for all tasks to complete
  await Promise.all(tasks);
  
  // Print performance report
  logger.info(strategy.getPerformanceReport());
  
  logger.info('High-performance block collection completed');
}

// Run the example
main().catch((err) => {
  logger.error(`Error: ${err}`);
  process.exit(1);
});
```

### Ultra-Fast Block Collection from HyperEVM

This example demonstrates how to collect blocks from HyperEVM as fast as possible using HTTP polling with the Bun-powered block collector:

```typescript
import type { Block, Chain } from 'viem';
import { BlockCollectorBun } from './collector/block_collector_bun';
import { Engine, type EngineConfig } from './engine';
import { PrinterExecutor } from './executor';
import type { ActionSubmitter, Strategy } from './types';
import { LogLevel, logger } from './utils/logger';

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
          if (missed > 0) {
            this.missedBlocks += missed;
            logger.warn(`Missed ${missed} blocks between ${this.lastBlockNumber} and ${event.number}`);
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
    const message = `Block #${event.number} with ${event.transactions.length} transactions | ` +
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
    const avgProcessingTime = this.blockTimes.length > 0 
      ? this.blockTimes.reduce((sum, time) => sum + time, 0) / this.blockTimes.length 
      : 0;
    const minProcessingTime = this.blockTimes.length > 0 
      ? Math.min(...this.blockTimes) 
      : 0;
    const maxProcessingTime = this.blockTimes.length > 0 
      ? Math.max(...this.blockTimes) 
      : 0;
    
    const avgBlockInterval = this.blockIntervals.length > 0 
      ? this.blockIntervals.reduce((sum, interval) => sum + interval, 0) / this.blockIntervals.length 
      : 0;
    const minBlockInterval = this.blockIntervals.length > 0 
      ? Math.min(...this.blockIntervals) 
      : 0;
    const maxBlockInterval = this.blockIntervals.length > 0 
      ? Math.max(...this.blockIntervals) 
      : 0;
    
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
  
  // Add a block collector with minimal polling interval (0ms)
  // Note: The actual polling rate may be limited by network latency and RPC rate limits
  engine.addCollector(
    BlockCollectorBun.withHttp(nodeUrl, hyperEvmChain, {
      pollingIntervalMs: 0, // Poll as fast as possible (0ms)
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
  const runDurationMs = 30000; // 30 seconds
  
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
}

// Run the example
main().catch((err) => {
  logger.error(`Error: ${err}`);
  process.exit(1);
});
```

## Features

- **Modular Architecture**: Easily swap out collectors, strategies, and executors.
- **Type Safety**: Fully typed with TypeScript.
- **Async Support**: Built with async/await and promises.
- **Extensible**: Add your own collectors, strategies, and executors.

## Optional Features

The following features are available:
- **EVM Support**: Collectors for EVM blocks, transactions, and logs.
- **Telegram Support**: Executors for sending messages to Telegram.
