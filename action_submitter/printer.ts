/**
 * Action printer
 * Uses the unified printer implementation
 */

import type { ActionSubmitter, SubmitResult } from '../types';
import { printAction } from '../utils/printer';

/**
 * ActionPrinter - prints actions to the console
 */
export class ActionPrinter<A> implements ActionSubmitter<A> {
  private readonly prefix?: string;

  /**
   * Create a new ActionPrinter
   * @param prefix Optional prefix to add to log messages
   */
  constructor(prefix?: string) {
    this.prefix = prefix;
  }

  /**
   * Submit an action by printing it to the console
   * @param action The action to submit
   */
  submit(action: A): void {
    printAction(action, this.prefix);
  }

  /**
   * Submit an action asynchronously
   * @param action The action to submit
   * @returns A promise that resolves to the result of the submission
   */
  async submitAsync(action: A): Promise<SubmitResult> {
    try {
      printAction(action, this.prefix);
      return { success: true };
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Try to submit an action
   * @param action The action to submit
   * @returns Whether the action was submitted successfully
   */
  trySubmit(action: A): boolean {
    try {
      printAction(action, this.prefix);
      return true;
    } catch (e) {
      return false;
    }
  }
}
