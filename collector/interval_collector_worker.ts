#!/usr/bin/env bun
/**
 * Worker process for IntervalCollector
 * This runs in a separate process and sends events back to the parent
 */

// Get interval from environment variable
const intervalMs = Number.parseInt(process.env.INTERVAL_MS || '1000', 10);

// Function to send events at regular intervals
function startInterval() {
  console.error(`[Worker] Starting interval worker with ${intervalMs}ms interval`);

  // Set up interval to emit events
  const timer = setInterval(() => {
    // Send the current time as an event to the parent process
    process.send?.({ timestamp: new Date().toISOString() });
  }, intervalMs);

  // Listen for messages from the parent process
  process.on('message', (message) => {
    if (message === 'stop') {
      console.error('[Worker] Received stop message, shutting down');
      clearInterval(timer);
      process.exit(0);
    }
  });

  // Handle process signals
  process.on('SIGTERM', () => {
    console.error('[Worker] Received SIGTERM, shutting down');
    clearInterval(timer);
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.error('[Worker] Received SIGINT, shutting down');
    clearInterval(timer);
    process.exit(0);
  });
}

// Start the interval
startInterval();
