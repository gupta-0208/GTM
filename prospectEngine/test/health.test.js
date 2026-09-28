import assert from "node:assert/strict";

import {
  health,
  evaluateReadiness,
} from "../src/health.js";

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
  await test("health reports process status", () => {
    const result = health();

    assert.equal(result.status, "ok");
    assert.equal(typeof result.uptime, "number");
    assert.equal(typeof result.timestamp, "string");
  });

  await test("readiness aggregates required checks", () => {
    const ready = evaluateReadiness([
      { name: "postgresql", ok: true, required: true },
      { name: "redis", ok: true, required: true },
      { name: "openai", ok: true, required: false, skipped: true },
    ]);

    assert.equal(ready.status, "ready");
    assert.equal(ready.ok, true);
  });

  await test("readiness fails when a required check fails", () => {
    const notReady = evaluateReadiness([
      { name: "postgresql", ok: false, required: true, error: "down" },
      { name: "redis", ok: false, required: true, error: "down" },
    ]);

    assert.equal(notReady.status, "not_ready");
    assert.equal(notReady.ok, false);
  });

  await test("optional (skipped) checks do not affect readiness", () => {
    const result = evaluateReadiness([
      { name: "postgresql", ok: true, required: true },
      { name: "searxng", ok: false, required: false, skipped: true },
      { name: "openai", ok: false, required: false, skipped: true },
    ]);

    assert.equal(result.status, "ready");
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
