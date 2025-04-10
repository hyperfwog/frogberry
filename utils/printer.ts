/**
 * Unified printer utilities
 * Provides common functionality for printing actions
 */

import { logger } from './logger';

/**
 * Print an action to the console
 * @param action The action to print
 * @param prefix Optional prefix to add to the log message
 */
export function printAction<A>(action: A, prefix = ''): void {
  const message = prefix
    ? `${prefix}: ${JSON.stringify(action)}`
    : `Action: ${JSON.stringify(action)}`;
  logger.info(message);
}
