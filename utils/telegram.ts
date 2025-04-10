/**
 * Unified Telegram utilities
 * Combines functionality from action_submitter/telegram.ts and executor/telegram.ts
 */

import { logger } from './logger';

/**
 * Message to be sent to Telegram
 */
export interface TelegramMessage {
  botToken: string;
  chatId: string;
  threadId?: string;
  text: string;
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  disableNotification?: boolean;
  protectContent?: boolean;
  disableLinkPreview?: boolean;
}

/**
 * Configuration for Telegram
 */
export interface TelegramConfig {
  botToken: string;
  chatId: string;
  threadId?: string;
  errorReporting?: {
    botToken: string;
    chatId: string;
    threadId?: string;
  };
}

/**
 * TelegramClient - handles sending messages to Telegram
 */
export class TelegramClient {
  private readonly config: TelegramConfig;

  /**
   * Create a new TelegramClient
   * @param config The Telegram configuration
   */
  constructor(config: TelegramConfig) {
    this.config = config;
  }

  /**
   * Get the URL for sending a message
   * @param botToken The bot token
   * @returns The URL
   */
  private getUrl(botToken: string): string {
    return `https://api.telegram.org/bot${botToken}/sendMessage`;
  }

  /**
   * Send a message to Telegram
   * @param message The message to send
   */
  async sendMessage(message: TelegramMessage): Promise<void> {
    const url = this.getUrl(message.botToken);

    const data: Record<string, any> = {
      chat_id: message.chatId,
      text: message.text,
      parse_mode: message.parseMode || 'MarkdownV2',
    };

    if (message.threadId) {
      data.message_thread_id = message.threadId;
    }

    if (message.disableNotification !== undefined) {
      data.disable_notification = message.disableNotification;
    }

    if (message.protectContent !== undefined) {
      data.protect_content = message.protectContent;
    }

    if (message.disableLinkPreview !== undefined) {
      data.link_preview_options = {
        is_disabled: message.disableLinkPreview,
      };
    }

    logger.debug(`Sending message to Telegram: ${JSON.stringify(data)}`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Response status: ${response.status}, body: ${body}`);
      }

      const responseData = await response.json();
      logger.debug(`Response: ${JSON.stringify(responseData)}`);
    } catch (e) {
      logger.error(`Failed to send message to Telegram: ${e}`);
      await this.reportError(message, `${e}`);
    }
  }

  /**
   * Report an error to Telegram
   * @param originalMessage The original message
   * @param errorMessage The error message
   */
  async reportError(originalMessage: TelegramMessage, errorMessage: string): Promise<void> {
    if (!this.config.errorReporting) {
      logger.warn('Telegram message fails to send but error reporting is disabled');
      return;
    }

    const url = this.getUrl(this.config.errorReporting.botToken);

    const data: Record<string, any> = {
      chat_id: this.config.errorReporting.chatId,
      link_preview_options: {
        is_disabled: true,
      },
      text: `❌ Fail to send message\n\nOriginal message: ${JSON.stringify(originalMessage.text)}\nError: ${errorMessage}`,
    };

    if (this.config.errorReporting.threadId) {
      data.message_thread_id = this.config.errorReporting.threadId;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const body = await response.text();
        logger.error(
          `Failed to send error report to Telegram: Response status: ${response.status}, body: ${body}`
        );
      }
    } catch (e) {
      logger.error(`Failed to send error report to Telegram: ${e}`);
    }
  }

  /**
   * Create a message from text
   * @param text The text to send
   * @returns A message object
   */
  createMessage(
    text: string,
    options: Partial<Omit<TelegramMessage, 'botToken' | 'chatId' | 'text'>> = {}
  ): TelegramMessage {
    return {
      botToken: this.config.botToken,
      chatId: this.config.chatId,
      threadId: this.config.threadId,
      text,
      ...options,
    };
  }
}

/**
 * Escape special characters in a string for Telegram MarkdownV2
 * @param raw The raw string
 * @returns The escaped string
 */
export function escapeMarkdown(raw: string): string {
  const escapedCharacters = '\\*_[]~`>#-|{}.!+()=';
  return raw
    .split('')
    .map((c) => (escapedCharacters.includes(c) ? `\\${c}` : c))
    .join('');
}
