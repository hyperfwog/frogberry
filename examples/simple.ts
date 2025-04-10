import { IntervalCollector } from '../collector';
/**
 * Simple example of using the Burberry framework
 * Demonstrates the improved features
 */
import { Engine, type EngineConfig } from '../engine';
import { Dummy } from '../executor';
import { PrinterExecutor } from '../executor';
import type { ActionSubmitter, Strategy } from '../types';
import { LogLevel, logger } from '../utils/logger';

// Set log level to debug
logger.setLevel(LogLevel.DEBUG);

// Define event and action types
type Event = Date;
type Action = string;

// Define a simple strategy
class SimpleStrategy implements Strategy<Event, Action> {
  private count = 0;

  name(): string {
    return 'SimpleStrategy';
  }

  /**
   * Optional method to sync state before processing events
   */
  async syncState(submitter: ActionSubmitter<Action>): Promise<void> {
    logger.info('Syncing state...');
    const result = await submitter.submitAsync(
      `Strategy initialized at ${new Date().toISOString()}`
    );
    if (!result.success) {
      logger.warn(`Failed to submit initialization message: ${result.error}`);
    }
  }

  /**
   * Process an event and submit actions
   */
  async processEvent(event: Event, submitter: ActionSubmitter<Action>): Promise<void> {
    this.count++;
    const message = `Event #${this.count} received at ${event.toISOString()}`;
    logger.info(message);

    // Use the async submission method to handle errors properly
    const result = await submitter.submitAsync(message);
    if (!result.success) {
      logger.warn(`Failed to submit action: ${result.error}`);
    }
  }
}

// Create and run the engine
async function main() {
  // Configure the engine with improved settings
  const config: EngineConfig = {
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
    // No need for individual SIGINT handlers anymore
  };

  // Register the global SIGINT handler
  Engine.registerGlobalSigintHandler(3000);

  // Create a new engine with the configuration
  const engine = new Engine<Event, Action>(config);

  // Add a collector that emits events every second
  engine.addCollector(new IntervalCollector(1000));

  // Add a strategy to process events
  engine.addStrategy(new SimpleStrategy());

  // Add executors
  engine.addExecutor(new Dummy<Action>());
  engine.addExecutor(new PrinterExecutor<Action>('Simple Example'));

  // Run the engine
  logger.info('Starting engine...');

  // Run the engine for 3 seconds
  const tasks = await engine.run();

  // Wait for 3 seconds
  logger.info('Running for 3 seconds...');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Stop the engine with a 1-second timeout
  logger.info('Stopping engine...');
  await engine.stop(1000);

  // Wait for all tasks to complete
  await Promise.all(tasks).catch((err) => {
    logger.error(`Task terminated unexpectedly: ${err}`);
  });

  logger.info('Engine stopped');
  // No need to call process.exit(0) here, as the global SIGINT handler will handle it
  // or the process will exit naturally when all tasks are complete
}

// Add process exit hook for logging purposes only
process.on('exit', (code) => {
  logger.info(`Process exiting with code ${code}`);
  // Perform any cleanup here if needed
});

// Run the example
main().catch((err) => {
  logger.error(`Error: ${err}`);
  process.exit(1);
});
