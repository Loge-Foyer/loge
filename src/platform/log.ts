import type { LogCategory, LogFields, Logger } from '@/services/ports';

const SECRET_KEY = /authorization|token|password|passwd|secret|cookie|api.?key|pin/i;

/**
 * Removes anything that may be a secret, in one place, so no call site has to
 * remember: values under secret-looking keys, and query strings, which can
 * carry keys and tokens.
 */
export function redact(fields: LogFields): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SECRET_KEY.test(key)) clean[key] = '[redacted]';
    else if (typeof value === 'string') clean[key] = value.replace(/\?.*$/, '?…');
    else clean[key] = value;
  }
  return clean;
}

function line(category: LogCategory, message: string) {
  return `[${category}] ${message}`;
}

export const consoleLogger: Logger = {
  debug: (category, message, fields) => {
    if (__DEV__) console.debug(line(category, message), ...(fields ? [redact(fields)] : []));
  },
  warn: (category, message, fields) => console.warn(line(category, message), ...(fields ? [redact(fields)] : [])),
  error: (category, message, fields) => console.error(line(category, message), ...(fields ? [redact(fields)] : [])),
};
