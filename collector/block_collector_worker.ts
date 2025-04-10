#!/usr/bin/env bun
/**
 * Worker process for BlockCollector
 * This runs in a separate process and sends blocks back to the parent
 */

import {
  http,
  webSocket,
  createPublicClient,
  type Chain,
  type Block,
} from 'viem';

// Parse configuration from environment variables
const rpcUrl = process.env.RPC_URL;
const chainId = parseInt(process.env.CHAIN_ID || '1', 10);
const transportType = process.env.TRANSPORT_TYPE || 'http';
const pollingIntervalMs = parseInt(process.env.POLLING_INTERVAL_MS || '1000', 10);
const includeTransactions = process.env.INCLUDE_TRANSACTIONS === 'true';

if (!rpcUrl) {
  console.error('[Worker] Missing RPC_URL environment variable');
  process.exit(1);
}

// Track the last block number we've seen
let lastBlockNumber: bigint | null = null;

/**
 * Send a block to the parent process
 */
function sendBlock(block: Block) {
  // Only process if it's a new block
  if (block.number === undefined || block.number === null) {
    return; // Skip blocks without a number
  }

  if (lastBlockNumber === null || block.number > lastBlockNumber) {
    lastBlockNumber = block.number;
    
    // Send the block to the parent process
    // We need to serialize the block to avoid issues with bigint
    const serializedBlock = JSON.stringify(block, (_, value) => 
      typeof value === 'bigint' ? value.toString() : value
    );
    
    process.send?.({ type: 'block', data: serializedBlock });
  }
}

/**
 * Set up WebSocket subscription
 */
async function setupWebSocketSubscription() {
  console.error('[Worker] Setting up WebSocket subscription');
  
  try {
    // Create a client with WebSocket transport
    const client = createPublicClient({
      transport: webSocket(rpcUrl),
      chain: { id: chainId } as Chain,
    });
    
    // Watch for new blocks
    const unwatch = await client.watchBlocks({
      onBlock: sendBlock,
      includeTransactions,
    });
    
    // Handle cleanup
    const cleanup = () => {
      console.error('[Worker] Cleaning up WebSocket subscription');
      unwatch();
      process.exit(0);
    };
    
    // Listen for stop message from parent
    process.on('message', (message) => {
      if (message === 'stop') {
        cleanup();
      }
    });
    
    // Handle process signals
    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
    
    // Send ready message to parent
    process.send?.({ type: 'ready', transportType: 'webSocket' });
  } catch (error) {
    console.error(`[Worker] WebSocket subscription error: ${error}`);
    process.send?.({ type: 'error', message: `WebSocket subscription error: ${error}` });
    
    // Fall back to polling
    setupPolling();
  }
}

/**
 * Set up polling for blocks
 */
async function setupPolling() {
  console.error('[Worker] Setting up polling for blocks');
  
  // Create a client with HTTP transport
  const client = createPublicClient({
    transport: http(rpcUrl),
    chain: { id: chainId } as Chain,
  });
  
  // Flag to prevent concurrent polling
  let isPolling = false;
  
  // Polling function
  const pollBlock = async () => {
    // Skip if already polling
    if (isPolling) return;
    
    isPolling = true;
    
    try {
      // Get the latest block
      const block = await client.getBlock({
        includeTransactions,
      });
      
      // Send the block to the parent process
      sendBlock(block);
    } catch (error) {
      console.error(`[Worker] Polling error: ${error}`);
      process.send?.({ type: 'error', message: `Polling error: ${error}` });
    } finally {
      isPolling = false;
    }
  };
  
  // Start polling
  const intervalId = setInterval(pollBlock, pollingIntervalMs);
  
  // Handle cleanup
  const cleanup = () => {
    console.error('[Worker] Cleaning up polling');
    clearInterval(intervalId);
    process.exit(0);
  };
  
  // Listen for stop message from parent
  process.on('message', (message) => {
    if (message === 'stop') {
      cleanup();
    }
  });
  
  // Handle process signals
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
  
  // Send ready message to parent
  process.send?.({ type: 'ready', transportType: 'http' });
  
  // Poll immediately
  pollBlock();
}

// Start the appropriate transport
if (transportType === 'webSocket') {
  setupWebSocketSubscription();
} else {
  setupPolling();
}
