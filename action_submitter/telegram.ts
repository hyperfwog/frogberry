/**
 * Telegram action submitter
 * Uses the unified TelegramClient from utils/telegram.ts
 */

import type { ActionSubmitter, SubmitResult } from '../types';
import { logger } from '../utils/logger';
import { TelegramClient, type TelegramConfig, type TelegramMessage } from '../utils/telegram';

/**
 * TelegramSubmitter - submits messages to Telegram
 */
export class TelegramSubmitter implements ActionSubmitter<TelegramMessage> {
  private client: TelegramClient;
  private redirectConfig?: {
    botToken: string;
    chatId: string;
    threadId?: string;
  };

  /**
   * Create a new TelegramSubmitter
   * @param config The Telegram configuration
   */
  constructor(config: TelegramConfig) {
    this.client = new TelegramClient(config);
  }

  /**
   * Create a new TelegramSubmitter with redirection
   * @param config The base Telegram configuration
   * @param redirectConfig The redirection configuration
   */
  static withRedirect(
    config: TelegramConfig,
    redirectConfig: {
      botToken: string;
      chatId: string;
      threadId?: string;
    }
  ): TelegramSubmitter {
    const submitter = new TelegramSubmitter(config);
    submitter.redirectConfig = redirectConfig;
    return submitter;
  }

  /**
   * Submit a message to Telegram
   * @param message The message to submit
   */
  submit(message: TelegramMessage): void {
    let finalMessage = message;

    if (this.redirectConfig) {
      finalMessage = {
        ...message,
        botToken: this.redirectConfig.botToken,
        chatId: this.redirectConfig.chatId,
        threadId: this.redirectConfig.threadId,
      };
    }

    // Use a Promise instead of spawning a thread
    this.client.sendMessage(finalMessage).catch((e) => {
      logger.error(`Error sending message: ${e}`);
    });
  }

  /**
   * Submit a message to Telegram asynchronously
   * @param message The message to submit
   * @returns A promise that resolves to the result of the submission
   */
  async submitAsync(message: TelegramMessage): Promise<SubmitResult> {
    let finalMessage = message;

    if (this.redirectConfig) {
      finalMessage = {
        ...message,
        botToken: this.redirectConfig.botToken,
        chatId: this.redirectConfig.chatId,
        threadId: this.redirectConfig.threadId,
      };
    }

    try {
      await this.client.sendMessage(finalMessage);
      return { success: true };
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      logger.error(`Error sending message: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Try to submit a message to Telegram
   * @param message The message to submit
   * @returns Whether the message was submitted successfully
   */
  trySubmit(message: TelegramMessage): boolean {
    try {
      this.submit(message);
      return true;
    } catch (e) {
      logger.debug(`Failed to send message: ${e}`);
      return false;
    }
  }
}
