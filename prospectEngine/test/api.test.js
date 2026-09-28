import assert from "node:assert/strict";

import { createServer } from "../src/api/server.js";

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

async function withServer(overrides, fn) {
  const server = createServer({
    enqueueDiscoveryFn: async (query) => ({
      id: "discovery-1",
      query,
    }),
    enqueueCrawlFn: async () => ({ id: "crawl-1" }),
    enqueueExtractionFn: async () => ({ id: "extract-1" }),
    getJobFn: async () => null,
    ...overrides,
  });

  await new Promise((resolve) => {
    server.listen(0, resolve);
  });

  const port = server.address().port;

  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  await test("GET /health returns 200 + request id", async () => {
    await withServer({}, async (base) => {
      const res = await fetch(`${base}/health`);
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.equal(body.status, "ok");
      assert.ok(res.headers.get("x-request-id"));
    });
  });

  await test("POST /discover rejects missing query", async () => {
    await withServer({}, async (base) => {
      const res = await fetch(`${base}/discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      assert.equal(res.status, 400);
      const body = await res.json();
      assert.match(body.error, /query is required/);
    });
  });

  await test("POST /discover returns 202 + jobId", async () => {
    await withServer({}, async (base) => {
      const res = await fetch(`${base}/discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "solar companies" }),
      });

      assert.equal(res.status, 202);
      const body = await res.json();
      assert.equal(body.jobId, "discovery-1");
      assert.equal(body.queue, "discovery");
    });
  });

  await test("POST /crawl and /extract return 202 + jobId", async () => {
    await withServer({}, async (base) => {
      const crawl = await fetch(`${base}/crawl`, {
        method: "POST",
      });

      assert.equal(crawl.status, 202);
      assert.equal((await crawl.json()).jobId, "crawl-1");

      const extract = await fetch(`${base}/extract`, {
        method: "POST",
      });

      assert.equal(extract.status, 202);
      assert.equal((await extract.json()).jobId, "extract-1");
    });
  });

  await test("GET /jobs/:id returns 404 when unknown", async () => {
    await withServer({}, async (base) => {
      const res = await fetch(`${base}/jobs/missing`);
      assert.equal(res.status, 404);
    });
  });

  await test("unknown route returns 404", async () => {
    await withServer({}, async (base) => {
      const res = await fetch(`${base}/nope`);
      assert.equal(res.status, 404);
    });
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
