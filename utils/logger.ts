/**
 * Logger implementation
 * A TypeScript equivalent of Rust's tracing
 */

/**
 * Log levels
 */
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4,
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  level: LogLevel;
  prefix?: string;
}

/**
 * Logger class
 */
export class Logger {
  private level: LogLevel;
  private prefix: string;

  constructor(config: LoggerConfig) {
    this.level = config.level;
    this.prefix = config.prefix || '';
  }

  /**
   * Set the log level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Set the log prefix
   */
  setPrefix(prefix: string): void {
    this.prefix = prefix;
  }

  /**
   * Log an error message
   */
  error(message: string): void {
    if (this.level >= LogLevel.ERROR) {
      console.error(`${this.prefix}[ERROR] ${message}`);
    }
  }

  /**
   * Log a warning message
   */
  warn(message: string): void {
    if (this.level >= LogLevel.WARN) {
      console.warn(`${this.prefix}[WARN] ${message}`);
    }
  }

  /**
   * Log an info message
   */
  info(message: string): void {
    if (this.level >= LogLevel.INFO) {
      console.info(`${this.prefix}[INFO] ${message}`);
    }
  }

  /**
   * Log a debug message
   */
  debug(message: string): void {
    if (this.level >= LogLevel.DEBUG) {
      console.debug(`${this.prefix}[DEBUG] ${message}`);
    }
  }

  /**
   * Log a trace message
   */
  trace(message: string): void {
    if (this.level >= LogLevel.TRACE) {
      console.trace(`${this.prefix}[TRACE] ${message}`);
    }
  }
}

/**
 * Default logger instance
 */
export const logger = new Logger({
  level: LogLevel.INFO,
  prefix: 'Frogberry: ',
});
