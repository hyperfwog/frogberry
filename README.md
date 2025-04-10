# Frogberry

A TypeScript/Bun port of the [frogberry](https://github.com/paradigmxyz/artemis/) framework, which is a fork of [paradigm/artemis](https://github.com/paradigmxyz/artemis/) with modifications.

## Installation

You can install Frogberry directly from GitHub:

```bash
bun add https://github.com/username/frogberry.git
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

## Example

Here's a simple example that uses an interval collector to emit events every second, and a strategy that logs the events and submits actions:

```typescript
import { Engine } from './engine.js';
import { IntervalCollector } from './collector/interval_collector.js';
import { Dummy } from './executor/dummy.js';
import { PrinterExecutor } from './executor/printer.js';
import { Strategy, ActionSubmitter } from './types.js';
import { logger, LogLevel } from './utils/logger.js';

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

## Features

- **Modular Architecture**: Easily swap out collectors, strategies, and executors.
- **Type Safety**: Fully typed with TypeScript.
- **Async Support**: Built with async/await and promises.
- **Extensible**: Add your own collectors, strategies, and executors.

## Examples

### Simple Example

A basic example that demonstrates the core functionality of Frogberry:

```bash
bun run example
```

### HyperEVM Example

An example that demonstrates how to monitor HyperEVM events:

```bash
bun run example:hyperevm
```

## Optional Features

The following features are available:

- **Ethereum Support**: Collectors for Ethereum blocks, transactions, and logs.
- **HyperEVM Support**: Collectors for HyperEVM blocks, transactions, and logs.
- **Telegram Support**: Executors for sending messages to Telegram.
