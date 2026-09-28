import { Queue, Worker } from "bullmq";

import { config } from "../config.js";

export function getRedisConnection() {
  if (config.redisUrl) {
    return { url: config.redisUrl };
  }

  return {
    host: config.redisHost,
    port: config.redisPort,
  };
}

export function createQueue(name) {
  return new Queue(name, {
    connection: getRedisConnection(),
  });
}

export function createWorker(
  name,
  processor,
  { concurrency = 5 } = {}
) {
  return new Worker(name, processor, {
    connection: getRedisConnection(),
    concurrency,
    removeOnComplete: {
      age: 3600,
      count: 1000,
    },
    removeOnFail: {
      age: 86400,
      count: 5000,
    },
  });
}
