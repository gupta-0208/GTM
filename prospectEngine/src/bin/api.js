import { config, validateConfig } from "../config.js";

import { logger } from "../lib/logger.js";

import { startServer } from "../api/server.js";

const validation = validateConfig();

if (!validation.valid) {
  for (const problem of validation.problems) {
    logger.error("invalid config", {
      problem,
    });
  }

  process.exit(1);
}

const server = startServer();

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  logger.info("shutting down api", {
    signal,
  });

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => {
    process.exit(0);
  }, 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", (error) => {
  logger.error("uncaught exception", {
    error: error.message,
  });
});

process.on("unhandledRejection", (reason) => {
  logger.error("unhandled rejection", {
    error: reason?.message || String(reason),
  });
});
