import assert from "node:assert/strict";

import {
  QUEUES,
  processors,
  startWorker,
} from "../src/jobs/index.js";

import { getRedisConnection } from "../src/jobs/queue.js";

const results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.error(`  FAIL  ${name}`);
    console.error(`        ${error.message}`);
  }
}

async function main() {
  await test("queues expose discovery/crawl/extraction", () => {
    assert.equal(QUEUES.discovery, "discovery");
    assert.equal(QUEUES.crawl, "crawl");
    assert.equal(QUEUES.extraction, "extraction");
  });

  await test("processors are thin wrappers (functions)", () => {
    assert.equal(typeof processors.discovery, "function");
    assert.equal(typeof processors.crawl, "function");
    assert.equal(typeof processors.extraction, "function");
  });

  await test("redis connection config is derivable without redis", () => {
    const connection = getRedisConnection();

    assert.ok(
      connection.url ||
        (connection.host && connection.port)
    );
  });

  await test("startWorker returns a graceful close contract", async () => {
    const { workers, close } = startWorker({
      queues: [],
    });

    assert.equal(workers.length, 0);
    assert.equal(typeof close, "function");

    await close();
  });

  console.log("");
  const failed = results.filter((r) => !r.ok);
  console.log(
    `Passed ${results.length - failed.length}/${results.length}`
  );

  if (failed.length) {
    process.exit(1);
  }
}

main();
