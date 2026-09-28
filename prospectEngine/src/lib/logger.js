import { config } from "../config.js";

const LEVELS = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

function thresholdValue() {
  if (config.logLevel === "silent") {
    return Infinity;
  }

  return LEVELS[config.logLevel] ?? LEVELS.info;
}

export function createLogger(context = {}) {
  const threshold = thresholdValue();

  function emit(level, message, fields = {}) {
    if (LEVELS[level] > threshold) {
      return;
    }

    const entry = {
      ts: new Date().toISOString(),
      level,
      ...context,
      ...fields,
      msg: message,
    };

    const line = `${JSON.stringify(entry)}\n`;

    if (level === "error" || level === "fatal") {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  }

  return {
    child(fields) {
      return createLogger({
        ...context,
        ...fields,
      });
    },

    fatal(message, fields) {
      emit("fatal", message, fields);
    },

    error(message, fields) {
      emit("error", message, fields);
    },

    warn(message, fields) {
      emit("warn", message, fields);
    },

    info(message, fields) {
      emit("info", message, fields);
    },

    debug(message, fields) {
      emit("debug", message, fields);
    },

    trace(message, fields) {
      emit("trace", message, fields);
    },
  };
}

export const logger = createLogger();
