export enum LogLevel {
  OFF = 0,
  ERROR = 1,
  WARN = 2,
  INFO = 3,
  VERBOSE = 4,
  DEBUG = 5,
}

export class Logger {
  private logLevel = LogLevel.INFO;

  setLogLevel(logLevel: LogLevel) {
    this.logLevel = logLevel;
  }

  info(message?: any, ...optionalParams: unknown[]) {
    if (this.logLevel >= LogLevel.INFO) {
      console.info(
        `INFO: ${new Date().toISOString()} -`,
        message,
        ...optionalParams
      );
    }
  }

  debug(message?: any, ...optionalParams: unknown[]) {
    if (this.logLevel >= LogLevel.DEBUG) {
      console.debug(
        `DEBUG: ${new Date().toISOString()} -`,
        message,
        ...optionalParams
      );
    }
  }

  verbose(message?: any, ...optionalParams: unknown[]) {
    if (this.logLevel >= LogLevel.VERBOSE) {
      console.log(
        `VERBOSE: ${new Date().toISOString()} -`,
        message,
        ...optionalParams
      );
    }
  }

  warn(message?: any, ...optionalParams: unknown[]) {
    if (this.logLevel >= LogLevel.WARN) {
      console.warn(
        `WARN: ${new Date().toISOString()} -`,
        message,
        ...optionalParams
      );
    }
  }

  error(message?: any, ...optionalParams: unknown[]) {
    if (this.logLevel >= LogLevel.ERROR) {
      console.error(
        `ERROR: ${new Date().toISOString()} -`,
        message,
        ...optionalParams
      );
    }
  }
}

export const logger = new Logger();
