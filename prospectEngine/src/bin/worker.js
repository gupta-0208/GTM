import { config, validateConfig } from "../config.js";

import { logger } from "../lib/logger.js";

import { startWorker } from "../jobs/index.js";

const validation = validateConfig();

if (!validation.valid) {
  for (const problem of validation.problems) {
    logger.error("invalid config", {
      problem,
    });
  }

  process.exit(1);
}

logger.info("starting worker", {
  nodeEnv: config.nodeEnv,
});

const { close } = startWorker();

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  logger.info("shutting down worker", {
    signal,
  });

  await close();

  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
