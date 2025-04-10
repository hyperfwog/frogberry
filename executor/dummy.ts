/**
 * Dummy executor
 * Ported from Rust crate burberry/src/executor/dummy.rs
 */

import type { Executor } from '../types.js';

/**
 * Dummy executor - does nothing with actions
 */
export class Dummy<A> implements Executor<A> {
  name(): string {
    return 'Dummy';
  }

  async execute(action: A): Promise<void> {
    // Do nothing with the action
    return Promise.resolve();
  }
}
