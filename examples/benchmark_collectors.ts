/**
 * Benchmark to compare the original IntervalCollector with the new IntervalCollectorBun
 * This demonstrates the performance benefits of using Bun's native process APIs
 */

import { IntervalCollector } from '../collector';
import { IntervalCollectorBun } from '../collector/interval_collector_bun';
import { LogLevel, logger } from '../utils/logger';

// Set log level to info
logger.setLevel(LogLevel.INFO);

// Configuration
const INTERVAL_MS = 100; // 100ms interval for more frequent events
const DURATION_MS = 10000; // Run for 10 seconds
const WARMUP_MS = 1000; // Warmup period

/**
 * Run a benchmark for a collector
 * @param name Name of the collector
 * @param collector The collector to benchmark
 */
async function runBenchmark(name: string, collector: IntervalCollector | IntervalCollectorBun) {
  logger.info(`Starting benchmark for ${name}...`);
  
  // Metrics
  let eventCount = 0;
  let totalLatencyMs = 0;
  let maxLatencyMs = 0;
  let minLatencyMs = Number.MAX_SAFE_INTEGER;
  
  // Memory usage before starting
  const initialMemory = process.memoryUsage();
  
  // Get the event stream
  const stream = await collector.getEventStream();
  
  // Start time
  const startTime = performance.now();
  let warmupComplete = false;
  
  // Process events
  while (true) {
    const result = await stream.next();
    
    if (result.done) {
      break;
    }
    
    const now = performance.now();
    const elapsedMs = now - startTime;
    
    // Skip events during warmup period
    if (!warmupComplete) {
      if (elapsedMs >= WARMUP_MS) {
        warmupComplete = true;
        logger.info(`Warmup complete for ${name}, starting measurements...`);
      }
      continue;
    }
    
    // Stop after the duration
    if (elapsedMs >= WARMUP_MS + DURATION_MS) {
      break;
    }
    
    // Calculate latency (time between when the event was created and when we received it)
    const eventTime = result.value.getTime();
    const receivedTime = Date.now();
    const latencyMs = receivedTime - eventTime;
    
    // Update metrics
    eventCount++;
    totalLatencyMs += latencyMs;
    maxLatencyMs = Math.max(maxLatencyMs, latencyMs);
    minLatencyMs = Math.min(minLatencyMs, latencyMs);
  }
  
  // Memory usage after benchmark
  const finalMemory = process.memoryUsage();
  
  // Calculate metrics
  const avgLatencyMs = eventCount > 0 ? totalLatencyMs / eventCount : 0;
  const eventsPerSecond = eventCount / (DURATION_MS / 1000);
  const memoryDiffRss = (finalMemory.rss - initialMemory.rss) / (1024 * 1024); // MB
  const memoryDiffHeapTotal = (finalMemory.heapTotal - initialMemory.heapTotal) / (1024 * 1024); // MB
  const memoryDiffHeapUsed = (finalMemory.heapUsed - initialMemory.heapUsed) / (1024 * 1024); // MB
  
  // Print results
  logger.info(`\n--- ${name} Benchmark Results ---`);
  logger.info(`Events processed: ${eventCount}`);
  logger.info(`Events per second: ${eventsPerSecond.toFixed(2)}`);
  logger.info(`Average latency: ${avgLatencyMs.toFixed(2)}ms`);
  logger.info(`Min latency: ${minLatencyMs.toFixed(2)}ms`);
  logger.info(`Max latency: ${maxLatencyMs.toFixed(2)}ms`);
  logger.info(`Memory usage change (RSS): ${memoryDiffRss.toFixed(2)}MB`);
  logger.info(`Memory usage change (Heap Total): ${memoryDiffHeapTotal.toFixed(2)}MB`);
  logger.info(`Memory usage change (Heap Used): ${memoryDiffHeapUsed.toFixed(2)}MB`);
  
  // Clean up
  await (stream as any).return?.();
  
  return {
    eventCount,
    eventsPerSecond,
    avgLatencyMs,
    minLatencyMs,
    maxLatencyMs,
    memoryDiffRss,
    memoryDiffHeapTotal,
    memoryDiffHeapUsed
  };
}

/**
 * Run benchmarks for both collectors and compare results
 */
async function runComparison() {
  logger.info('Starting collector benchmark comparison...');
  
  // Run benchmark for original collector
  const originalResults = await runBenchmark('Original IntervalCollector', new IntervalCollector(INTERVAL_MS));
  
  // Wait a bit between benchmarks
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Run benchmark for Bun collector
  const bunResults = await runBenchmark('Bun IntervalCollector', new IntervalCollectorBun(INTERVAL_MS));
  
  // Calculate improvements
  const latencyImprovement = ((originalResults.avgLatencyMs - bunResults.avgLatencyMs) / originalResults.avgLatencyMs) * 100;
  const throughputImprovement = ((bunResults.eventsPerSecond - originalResults.eventsPerSecond) / originalResults.eventsPerSecond) * 100;
  const memoryImprovement = ((originalResults.memoryDiffHeapUsed - bunResults.memoryDiffHeapUsed) / originalResults.memoryDiffHeapUsed) * 100;
  
  // Print comparison
  logger.info('\n--- Performance Comparison ---');
  logger.info(`Latency: ${latencyImprovement.toFixed(2)}% improvement`);
  logger.info(`Throughput: ${throughputImprovement.toFixed(2)}% improvement`);
  logger.info(`Memory efficiency: ${memoryImprovement.toFixed(2)}% improvement`);
  
  logger.info('\nBenchmark complete!');
}

// Run the comparison
runComparison().catch(err => {
  logger.error(`Benchmark error: ${err}`);
  process.exit(1);
});
