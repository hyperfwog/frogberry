/**
 * BroadcastChannel implementation
 * A TypeScript equivalent of Tokio's broadcast channel with improved error handling
 */

import { logger } from './logger';

/**
 * Error types for the broadcast channel
 */
export enum ChannelErrorType {
  CLOSED = 'closed',
  LAGGED = 'lagged',
  FULL = 'full',
}

/**
 * Error class for channel operations
 */
export class ChannelError extends Error {
  readonly type: ChannelErrorType;
  readonly context?: unknown;

  constructor(type: ChannelErrorType, message: string, context?: unknown) {
    super(message);
    this.name = 'ChannelError';
    this.type = type;
    this.context = context;
  }

  /**
   * Create a closed channel error
   */
  static closed(): ChannelError {
    return new ChannelError(ChannelErrorType.CLOSED, 'Channel closed');
  }

  /**
   * Create a lagged channel error
   * @param lagCount The number of messages lagged
   */
  static lagged(lagCount: number): ChannelError {
    return new ChannelError(ChannelErrorType.LAGGED, `Channel lagged by ${lagCount} messages`, {
      lagCount,
    });
  }

  /**
   * Create a full channel error
   */
  static full(): ChannelError {
    return new ChannelError(ChannelErrorType.FULL, 'Channel full');
  }
}

/**
 * Configuration for the broadcast channel
 */
export interface BroadcastChannelConfig {
  /** Maximum number of messages to buffer per receiver */
  maxLag?: number;
  /** Whether to throw errors on lag (true) or just log warnings (false) */
  throwOnLag?: boolean;
  /** How often to report lag (in number of messages) */
  lagReportInterval?: number;
}

/**
 * Receiver for a broadcast channel
 */
export class BroadcastReceiver<T> implements AsyncIterator<T> {
  private channel: BroadcastChannel<T>;
  private buffer: T[] = [];
  private closed = false;
  private resolvers: ((value: IteratorResult<T>) => void)[] = [];
  private lagCount = 0;
  private readonly maxLag: number;
  private readonly throwOnLag: boolean;
  private readonly lagReportInterval: number;

  constructor(
    channel: BroadcastChannel<T>,
    maxLag: number,
    throwOnLag: boolean,
    lagReportInterval: number
  ) {
    this.channel = channel;
    this.maxLag = maxLag;
    this.throwOnLag = throwOnLag;
    this.lagReportInterval = lagReportInterval;

    // Register this receiver with the channel
    channel.addReceiver(this);
  }

  /**
   * Receive a value from the channel
   */
  receive(value: T): void {
    if (this.closed) return;

    // If we have waiting resolvers, resolve them immediately
    if (this.resolvers.length > 0) {
      const resolver = this.resolvers.shift();
      if (resolver) {
        resolver({ done: false, value });
      }
      return;
    }

    // Otherwise, add to buffer, potentially dropping old messages
    this.buffer.push(value);
    if (this.buffer.length > this.maxLag) {
      this.buffer.shift();
      this.lagCount++;

      // Report lag at specified intervals
      if (this.lagCount % this.lagReportInterval === 0) {
        const error = ChannelError.lagged(this.lagCount);

        if (this.throwOnLag) {
          throw error;
        }
        logger.warn(`Receiver lagging: ${error.message}`);
      }
    }
  }

  /**
   * Close the receiver
   */
  close(): void {
    if (this.closed) return;

    this.closed = true;

    // Resolve any waiting resolvers with done
    for (const resolver of this.resolvers) {
      resolver({ done: true, value: undefined as unknown });
    }
    this.resolvers = [];

    // Remove this receiver from the channel
    this.channel.removeReceiver(this);
  }

  /**
   * AsyncIterator next method
   */
  async next(): Promise<IteratorResult<T>> {
    if (this.closed) {
      return { done: true, value: undefined as unknown };
    }

    // If we have buffered values, return one immediately
    if (this.buffer.length > 0) {
      const value = this.buffer.shift();
      if (value === undefined) {
        // This should never happen, but we handle it just in case
        return this.next();
      }
      return { done: false, value };
    }

    // Otherwise, wait for a value
    return new Promise<IteratorResult<T>>((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  /**
   * Get the current lag count
   */
  getLagCount(): number {
    return this.lagCount;
  }

  /**
   * Make the receiver iterable with for-await-of
   */
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this;
  }
}

/**
 * BroadcastChannel - a multi-producer, multi-consumer channel
 */
export class BroadcastChannel<T> {
  private receivers: Set<BroadcastReceiver<T>> = new Set();
  private config: Required<BroadcastChannelConfig>;
  private closed = false;

  /**
   * Create a new BroadcastChannel
   * @param capacity The capacity of the channel (maximum buffer size per receiver)
   * @param config Additional configuration options
   */
  constructor(capacity = 512, config: BroadcastChannelConfig = {}) {
    this.config = {
      maxLag: capacity,
      throwOnLag: false,
      lagReportInterval: 100,
      ...config,
    };
  }

  /**
   * Send a value to all receivers
   * @param value The value to send
   * @throws {ChannelError} If the channel is closed
   */
  send(value: T): void {
    if (this.closed) {
      throw ChannelError.closed();
    }

    for (const receiver of this.receivers) {
      receiver.receive(value);
    }
  }

  /**
   * Try to send a value to all receivers, returning false if the channel is closed
   * @param value The value to send
   * @returns true if the value was sent, false if the channel is closed
   */
  trySend(value: T): boolean {
    if (this.closed) {
      return false;
    }

    this.send(value);
    return true;
  }

  /**
   * Subscribe to the channel
   * @returns A new receiver
   * @throws {ChannelError} If the channel is closed
   */
  subscribe(): BroadcastReceiver<T> {
    if (this.closed) {
      throw ChannelError.closed();
    }

    return new BroadcastReceiver<T>(
      this,
      this.config.maxLag,
      this.config.throwOnLag,
      this.config.lagReportInterval
    );
  }

  /**
   * Try to subscribe to the channel, returning null if the channel is closed
   * @returns A new receiver, or null if the channel is closed
   */
  trySubscribe(): BroadcastReceiver<T> | null {
    if (this.closed) {
      return null;
    }

    return this.subscribe();
  }

  /**
   * Close the channel
   */
  close(): void {
    if (this.closed) return;

    this.closed = true;

    for (const receiver of this.receivers) {
      receiver.close();
    }

    this.receivers.clear();
  }

  /**
   * Check if the channel is closed
   */
  isClosed(): boolean {
    return this.closed;
  }

  /**
   * Get the number of receivers
   */
  receiverCount(): number {
    return this.receivers.size;
  }

  /**
   * Add a receiver to the channel (internal use)
   */
  addReceiver(receiver: BroadcastReceiver<T>): void {
    this.receivers.add(receiver);
  }

  /**
   * Remove a receiver from the channel (internal use)
   */
  removeReceiver(receiver: BroadcastReceiver<T>): void {
    this.receivers.delete(receiver);
  }
}
