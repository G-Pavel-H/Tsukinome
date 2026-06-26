/**
 * Minimal structured logger shape. Compatible with Probot's pino logger
 * (`log.info(obj, msg)`), so we can pass `probot.log` directly while keeping our
 * own modules decoupled from Probot's types.
 */
export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}
