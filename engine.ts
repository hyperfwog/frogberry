/**
 * Core engine for the Frogberry framework
 * Improved version with better memory management and error handling
 */

import { ActionChannelSubmitter } from './action_submitter';
import type { Collector, Executor, Strategy } from './types';
import {
  BroadcastChannel,
  type BroadcastChannelConfig,
  ChannelError,
  ChannelErrorType,
} from './utils/broadcast_channel';
import { logger } from './utils/logger';

/**
 * Configuration for the Engine
 */
export interface EngineConfig {
  /** Capacity of the event channel */
  eventChannelCapacity?: number;
  /** Capacity of the action channel */
  actionChannelCapacity?: number;
  /** Configuration for the event channel */
  eventChannelConfig?: BroadcastChannelConfig;
  /** Configuration for the action channel */
  actionChannelConfig?: BroadcastChannelConfig;
  /** Maximum number of consecutive errors before backing off */
  maxConsecutiveErrors?: number;
  /** Initial backoff time in milliseconds */
  initialBackoffMs?: number;
  /** Maximum backoff time in milliseconds */
  maxBackoffMs?: number;
  /** Whether to stop the engine on critical errors */
  stopOnCriticalError?: boolean;
  /** Whether to register a SIGINT handler to stop the engine gracefully */
  registerSigintHandler?: boolean;
  /** Timeout in milliseconds for graceful shutdown when SIGINT is received */
  sigintShutdownTimeoutMs?: number;
  /** Whether to exit the process after stopping the engine on SIGINT */
  exitProcessOnSigint?: boolean;
}

/**
 * Engine class - coordinates collectors, strategies, and executors
 */
export class Engine<E, A> {
  private collectors: Array<Collector<E>> = [];
  private strategies: Array<Strategy<E, A>> = [];
  private executors: Array<Executor<A>> = [];
  private config: Required<EngineConfig>;
  private running = false;
  private tasks: Promise<void>[] = [];
  private eventChannel?: BroadcastChannel<E>;
  private actionChannel?: BroadcastChannel<A>;
  private _sigintHandlerRegistered = false;

  /**
   * Create a new Engine instance
   * @param config Configuration options
   */
  constructor(config: EngineConfig = {}) {
    this.config = {
      eventChannelCapacity: 512,
      actionChannelCapacity: 512,
      eventChannelConfig: {
        throwOnLag: false,
        lagReportInterval: 100,
      },
      actionChannelConfig: {
        throwOnLag: false,
        lagReportInterval: 100,
      },
      maxConsecutiveErrors: 5,
      initialBackoffMs: 100,
      maxBackoffMs: 30000,
      stopOnCriticalError: false,
      registerSigintHandler: false,
      sigintShutdownTimeoutMs: 5000,
      exitProcessOnSigint: false,
      ...config,
    };

    // Register SIGINT handler if configured
    if (this.config.registerSigintHandler) {
      this.registerSigintHandler();
    }
  }

  /**
   * Register a SIGINT handler to stop the engine gracefully
   */
  private registerSigintHandler(): void {
    if (this._sigintHandlerRegistered) {
      return;
    }

    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, stopping engine...');
      await this.stop(this.config.sigintShutdownTimeoutMs);

      if (this.config.exitProcessOnSigint) {
        logger.info('Exiting process due to SIGINT');
        process.exit(0);
      }
    });

    this._sigintHandlerRegistered = true;
  }

  /**
   * Set the event channel capacity
   * @param capacity The capacity of the event channel
   */
  withEventChannelCapacity(capacity: number): Engine<E, A> {
    this.config.eventChannelCapacity = capacity;
    return this;
  }

  /**
   * Set the action channel capacity
   * @param capacity The capacity of the action channel
   */
  withActionChannelCapacity(capacity: number): Engine<E, A> {
    this.config.actionChannelCapacity = capacity;
    return this;
  }

  /**
   * Set the event channel configuration
   * @param config The configuration for the event channel
   */
  withEventChannelConfig(config: BroadcastChannelConfig): Engine<E, A> {
    this.config.eventChannelConfig = {
      ...this.config.eventChannelConfig,
      ...config,
    };
    return this;
  }

  /**
   * Set the action channel configuration
   * @param config The configuration for the action channel
   */
  withActionChannelConfig(config: BroadcastChannelConfig): Engine<E, A> {
    this.config.actionChannelConfig = {
      ...this.config.actionChannelConfig,
      ...config,
    };
    return this;
  }

  /**
   * Set whether to stop the engine on critical errors
   * @param stop Whether to stop the engine on critical errors
   */
  withStopOnCriticalError(stop: boolean): Engine<E, A> {
    this.config.stopOnCriticalError = stop;
    return this;
  }

  /**
   * Enable or disable the SIGINT handler
   * @param enable Whether to enable the SIGINT handler
   */
  withSigintHandler(enable = true): Engine<E, A> {
    this.config.registerSigintHandler = enable;

    // Register or unregister the handler
    if (enable && !this._sigintHandlerRegistered) {
      this.registerSigintHandler();
    }

    return this;
  }

  /**
   * Set the timeout for graceful shutdown when SIGINT is received
   * @param timeoutMs Timeout in milliseconds
   */
  withSigintShutdownTimeout(timeoutMs: number): Engine<E, A> {
    this.config.sigintShutdownTimeoutMs = timeoutMs;
    return this;
  }

  /**
   * Enable or disable process exit after stopping the engine on SIGINT
   * @param enable Whether to exit the process after stopping the engine
   */
  withExitProcessOnSigint(enable = true): Engine<E, A> {
    this.config.exitProcessOnSigint = enable;
    return this;
  }

  /**
   * Get the number of strategies
   */
  strategyCount(): number {
    return this.strategies.length;
  }

  /**
   * Get the number of executors
   */
  executorCount(): number {
    return this.executors.length;
  }

  /**
   * Get the number of collectors
   */
  collectorCount(): number {
    return this.collectors.length;
  }

  /**
   * Add a collector to the engine
   * @param collector The collector to add
   */
  addCollector(collector: Collector<E>): void {
    this.collectors.push(collector);
  }

  /**
   * Add a strategy to the engine
   * @param strategy The strategy to add
   */
  addStrategy(strategy: Strategy<E, A>): void {
    this.strategies.push(strategy);
  }

  /**
   * Add an executor to the engine
   * @param executor The executor to add
   */
  addExecutor(executor: Executor<A>): void {
    this.executors.push(executor);
  }

  /**
   * Check if the engine is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Run the engine and wait for it to complete
   */
  async runAndJoin(): Promise<void> {
    const tasks = await this.run();

    // Wait for all tasks to complete
    await Promise.all(tasks).catch((err) => {
      logger.error(`Task terminated unexpectedly: ${err}`);
    });
  }

  /**
   * Stop the engine
   * @param timeoutMs Maximum time to wait for graceful shutdown in milliseconds
   * @returns A promise that resolves when the engine has stopped
   */
  async stop(timeoutMs = 5000): Promise<void> {
    if (!this.running) {
      return;
    }

    logger.info('Stopping engine...');

    // Set running to false first to prevent new operations
    this.running = false;

    // Create a promise that resolves after the timeout
    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        logger.warn(`Engine shutdown timed out after ${timeoutMs}ms, forcing shutdown`);

        // Force cleanup of any remaining resources
        this.forceCleanup();

        resolve();
      }, timeoutMs);
    });

    // Create a promise that resolves when all tasks have completed
    const shutdownPromise = new Promise<void>(async (resolve) => {
      try {
        // Close the channels to signal tasks to stop
        if (this.eventChannel) {
          this.eventChannel.close();
        }

        if (this.actionChannel) {
          this.actionChannel.close();
        }

        // Wait a short time for tasks to notice the channels are closed
        await new Promise((r) => setTimeout(r, 100));

        // Try to wait for all tasks to complete with a shorter timeout
        const taskTimeout = Math.min(timeoutMs / 2, 2000);
        await Promise.race([
          Promise.all(
            this.tasks.map((task) => {
              // Create a timeout for each task
              return Promise.race([task, new Promise((r) => setTimeout(r, taskTimeout))]);
            })
          ),
          new Promise((r) => setTimeout(r, taskTimeout)),
        ]);

        resolve();
      } catch (e) {
        logger.error(`Error during engine shutdown: ${e}`);
        resolve();
      }
    });

    // Wait for either the shutdown to complete or the timeout to expire
    await Promise.race([shutdownPromise, timeoutPromise]);

    // Ensure all resources are cleaned up
    this.cleanupResources();
  }

  /**
   * Clean up resources
   */
  private cleanupResources(): void {
    this.eventChannel = undefined;
    this.actionChannel = undefined;
    this.tasks = [];
  }

  /**
   * Force cleanup of any remaining resources
   * This is called when the shutdown times out
   */
  private forceCleanup(): void {
    // Ensure all resources are cleaned up
    this.cleanupResources();

    // Set global state to indicate forced shutdown
    // This will be checked by collectors and other components
    (global as any).__FROGBERRY_FORCED_SHUTDOWN__ = true;

    // After a short delay, reset the forced shutdown flag
    setTimeout(() => {
      (global as any).__FROGBERRY_FORCED_SHUTDOWN__ = false;
    }, 5000);
  }

  /**
   * Run the engine and return the tasks
   */
  async run(): Promise<Promise<void>[]> {
    // Validate that we have executors, collectors, and strategies
    if (this.executors.length === 0) {
      throw new Error('No executors');
    }

    if (this.collectors.length === 0) {
      throw new Error('No collectors');
    }

    if (this.strategies.length === 0) {
      throw new Error('No strategies');
    }

    // Check if the engine is already running
    if (this.running) {
      throw new Error('Engine is already running');
    }

    this.running = true;

    // Create broadcast channels for events and actions
    this.eventChannel = new BroadcastChannel<E>(
      this.config.eventChannelCapacity,
      this.config.eventChannelConfig
    );

    this.actionChannel = new BroadcastChannel<A>(
      this.config.actionChannelCapacity,
      this.config.actionChannelConfig
    );

    this.tasks = [];

    // Spawn executors
    for (const executor of this.executors) {
      const receiver = this.actionChannel.subscribe();

      this.tasks.push(this.runExecutor(executor, receiver));
    }

    // Spawn strategies
    for (const strategy of this.strategies) {
      const eventReceiver = this.eventChannel.subscribe();
      const actionSubmitter = new ActionChannelSubmitter<A>(this.actionChannel);

      // Sync state if the strategy implements it
      if (strategy.syncState) {
        try {
          await strategy.syncState(actionSubmitter);
        } catch (e) {
          throw new Error(`Failed to sync state for ${strategy.name()}: ${e}`);
        }
      }

      this.tasks.push(this.runStrategy(strategy, eventReceiver, actionSubmitter));
    }

    // Spawn collectors
    for (const collector of this.collectors) {
      this.tasks.push(this.runCollector(collector));
    }

    return this.tasks;
  }

  /**
   * Run an executor
   * @param executor The executor to run
   * @param receiver The receiver to get actions from
   */
  private async runExecutor(executor: Executor<A>, receiver: AsyncIterator<A>): Promise<void> {
    logger.debug(`Starting executor: ${executor.name()}`);

    let consecutiveErrors = 0;
    let backoffMs = this.config.initialBackoffMs;

    try {
      while (this.running) {
        try {
          const result = await receiver.next();

          if (result.done) {
            logger.debug(`Action stream ended for ${executor.name()}`);
            break;
          }

          await executor.execute(result.value);

          // Reset backoff on success
          if (consecutiveErrors > 0) {
            consecutiveErrors = 0;
            backoffMs = this.config.initialBackoffMs;
          }
        } catch (e) {
          consecutiveErrors++;

          if (e instanceof ChannelError) {
            if (e.type === ChannelErrorType.CLOSED) {
              logger.debug(`Action channel closed for ${executor.name()}`);
              break;
            }
            if (e.type === ChannelErrorType.LAGGED) {
              logger.warn(`Action channel lagged for ${executor.name()}: ${e.message}`);
            } else {
              logger.error(`Channel error in executor ${executor.name()}: ${e.message}`);
            }
          } else {
            logger.error(`Error executing action in ${executor.name()}: ${e}`);
          }

          // Implement exponential backoff
          if (consecutiveErrors > this.config.maxConsecutiveErrors) {
            const newBackoff = Math.min(backoffMs * 2, this.config.maxBackoffMs);
            if (newBackoff !== backoffMs) {
              backoffMs = newBackoff;
              logger.warn(
                `Increasing backoff for ${executor.name()} to ${backoffMs}ms due to errors`
              );
            }

            // Sleep for backoff period
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
          }

          // Stop the engine on critical error if configured to do so
          if (
            this.config.stopOnCriticalError &&
            consecutiveErrors > this.config.maxConsecutiveErrors * 2
          ) {
            logger.error(
              `Too many consecutive errors in executor ${executor.name()}, stopping engine`
            );
            await this.stop();
            break;
          }
        }
      }
    } catch (e) {
      logger.error(`Unexpected error in executor ${executor.name()}: ${e}`);
    }

    logger.debug(`Executor ${executor.name()} stopped`);
  }

  /**
   * Run a strategy
   * @param strategy The strategy to run
   * @param eventReceiver The receiver to get events from
   * @param actionSubmitter The submitter to submit actions to
   */
  private async runStrategy(
    strategy: Strategy<E, A>,
    eventReceiver: AsyncIterator<E>,
    actionSubmitter: ActionChannelSubmitter<A>
  ): Promise<void> {
    logger.debug(`Starting strategy: ${strategy.name()}`);

    let consecutiveErrors = 0;
    let backoffMs = this.config.initialBackoffMs;

    try {
      while (this.running) {
        try {
          const result = await eventReceiver.next();

          if (result.done) {
            logger.debug(`Event stream ended for ${strategy.name()}`);
            break;
          }

          await strategy.processEvent(result.value, actionSubmitter);

          // Reset backoff on success
          if (consecutiveErrors > 0) {
            consecutiveErrors = 0;
            backoffMs = this.config.initialBackoffMs;
          }
        } catch (e) {
          consecutiveErrors++;

          if (e instanceof ChannelError) {
            if (e.type === ChannelErrorType.CLOSED) {
              logger.debug(`Event channel closed for ${strategy.name()}`);
              break;
            }
            if (e.type === ChannelErrorType.LAGGED) {
              logger.warn(`Event channel lagged for ${strategy.name()}: ${e.message}`);
            } else {
              logger.error(`Channel error in strategy ${strategy.name()}: ${e.message}`);
            }
          } else {
            logger.error(`Error processing event in ${strategy.name()}: ${e}`);
          }

          // Exponential backoff
          if (consecutiveErrors > this.config.maxConsecutiveErrors) {
            const newBackoff = Math.min(backoffMs * 2, this.config.maxBackoffMs);
            if (newBackoff !== backoffMs) {
              backoffMs = newBackoff;
              logger.warn(
                `Increasing backoff for ${strategy.name()} to ${backoffMs}ms due to errors`
              );
            }

            // Sleep for backoff period
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
          }

          // Stop the engine on critical error if configured to do so
          if (
            this.config.stopOnCriticalError &&
            consecutiveErrors > this.config.maxConsecutiveErrors * 2
          ) {
            logger.error(
              `Too many consecutive errors in strategy ${strategy.name()}, stopping engine`
            );
            await this.stop();
            break;
          }
        }
      }
    } catch (e) {
      logger.error(`Unexpected error in strategy ${strategy.name()}: ${e}`);
    }

    logger.debug(`Strategy ${strategy.name()} stopped`);
  }

  /**
   * Run a collector
   * @param collector The collector to run
   */
  private async runCollector(collector: Collector<E>): Promise<void> {
    logger.debug(`Starting collector: ${collector.name()}`);

    let consecutiveErrors = 0;
    let backoffMs = this.config.initialBackoffMs;

    try {
      const eventStream = await collector.getEventStream();

      while (this.running) {
        try {
          const result = await eventStream.next();

          if (result.done) {
            logger.debug(`Event stream ended for ${collector.name()}`);
            break;
          }

          if (this.eventChannel) {
            this.eventChannel.send(result.value);
          }

          // Reset backoff on success
          if (consecutiveErrors > 0) {
            consecutiveErrors = 0;
            backoffMs = this.config.initialBackoffMs;
          }
        } catch (e) {
          consecutiveErrors++;

          if (e instanceof ChannelError) {
            if (e.type === ChannelErrorType.CLOSED) {
              logger.debug(`Event channel closed for ${collector.name()}`);
              break;
            }
            logger.error(`Channel error in collector ${collector.name()}: ${e.message}`);
          } else {
            logger.error(`Error in collector ${collector.name()}: ${e}`);
          }

          // Implement exponential backoff
          if (consecutiveErrors > this.config.maxConsecutiveErrors) {
            const newBackoff = Math.min(backoffMs * 2, this.config.maxBackoffMs);
            if (newBackoff !== backoffMs) {
              backoffMs = newBackoff;
              logger.warn(
                `Increasing backoff for ${collector.name()} to ${backoffMs}ms due to errors`
              );
            }

            // Sleep for backoff period
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
          }

          // Stop the engine on critical error if configured to do so
          if (
            this.config.stopOnCriticalError &&
            consecutiveErrors > this.config.maxConsecutiveErrors * 2
          ) {
            logger.error(
              `Too many consecutive errors in collector ${collector.name()}, stopping engine`
            );
            await this.stop();
            break;
          }
        }
      }
    } catch (e) {
      logger.error(`Error in collector ${collector.name()}: ${e}`);
    }

    logger.debug(`Collector ${collector.name()} stopped`);
  }
}
