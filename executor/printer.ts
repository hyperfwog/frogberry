/**
 * Printer executor
 * Uses the unified printer implementation
 */

import type { Executor } from '../types';
import { printAction } from '../utils/printer';

/**
 * PrinterExecutor - prints actions to the console
 */
export class PrinterExecutor<A> implements Executor<A> {
  private readonly prefix?: string;

  /**
   * Create a new PrinterExecutor
   * @param prefix Optional prefix to add to log messages
   */
  constructor(prefix?: string) {
    this.prefix = prefix;
  }

  name(): string {
    return 'PrinterExecutor';
  }

  /**
   * Execute an action by printing it to the console
   * @param action The action to execute
   */
  async execute(action: A): Promise<void> {
    printAction(action, this.prefix);
    return Promise.resolve();
  }
}
