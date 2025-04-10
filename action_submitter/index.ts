/**
 * Action submitter module
 * Improved version with consistent error handling and Promise support
 */

import type { ActionSubmitter } from '../types';
import { type BroadcastChannel, ChannelError } from '../utils/broadcast_channel';
import { logger } from '../utils/logger';

/**
 * Result of submitting an action
 */
export interface SubmitResult {
  /** Whether the submission was successful */
  success: boolean;
  /** Error message if the submission failed */
  error?: string;
}

/**
 * ActionChannelSubmitter - submits actions to a broadcast channel
 */
export class ActionChannelSubmitter<A> implements ActionSubmitter<A> {
  private channel: BroadcastChannel<A>;

  /**
   * Create a new ActionChannelSubmitter
   * @param channel The broadcast channel to submit actions to
   */
  constructor(channel: BroadcastChannel<A>) {
    this.channel = channel;
  }

  /**
   * Submit an action to the channel
   * @param action The action to submit
   */
  submit(action: A): void {
    try {
      this.channel.send(action);
    } catch (e) {
      if (e instanceof ChannelError) {
        logger.error(`Channel error submitting action: ${e.message}`);
      } else {
        logger.error(`Error submitting action: ${e}`);
      }
    }
  }

  /**
   * Submit an action to the channel asynchronously
   * @param action The action to submit
   * @returns A promise that resolves to the result of the submission
   */
  async submitAsync(action: A): Promise<SubmitResult> {
    try {
      this.channel.send(action);
      return { success: true };
    } catch (e) {
      let errorMessage: string;

      if (e instanceof ChannelError) {
        errorMessage = `Channel error: ${e.message}`;
      } else if (e instanceof Error) {
        errorMessage = e.message;
      } else {
        errorMessage = String(e);
      }

      logger.error(`Error submitting action: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Try to submit an action to the channel
   * @param action The action to submit
   * @returns Whether the action was submitted successfully
   */
  trySubmit(action: A): boolean {
    try {
      return this.channel.trySend(action);
    } catch (e) {
      logger.debug(`Failed to submit action: ${e}`);
      return false;
    }
  }
}
