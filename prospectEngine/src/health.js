import { config } from "./config.js";

import { query } from "./storage/pg.js";

export function health() {
  return {
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    nodeEnv: config.nodeEnv,
  };
}

async function checkPostgres() {
  try {
    await query("SELECT 1");

    return {
      name: "postgresql",
      ok: true,
      required: true,
    };
  } catch (error) {
    return {
      name: "postgresql",
      ok: false,
      required: true,
      error: error.message,
    };
  }
}

async function checkRedis() {
  if (!config.redisEnabled) {
    return {
      name: "redis",
      ok: true,
      required: false,
      skipped: true,
    };
  }

  try {
    const { default: Redis } = await import("ioredis");

    const connection = config.redisUrl
      ? new Redis(config.redisUrl, { lazyConnect: true })
      : new Redis({
          host: config.redisHost,
          port: config.redisPort,
          lazyConnect: true,
        });

    const result = await connection.ping();

    await connection.quit();

    return {
      name: "redis",
      ok: result === "PONG",
      required: true,
    };
  } catch (error) {
    return {
      name: "redis",
      ok: false,
      required: true,
      error: error.message,
    };
  }
}

async function checkOpenai() {
  const required =
    config.openaiEnabled ||
    (config.llmEnabled &&
      config.llmProvider === "openai");

  if (!required) {
    return {
      name: "openai",
      ok: true,
      required: false,
      skipped: true,
    };
  }

  return {
    name: "openai",
    ok: Boolean(config.openaiApiKey),
    required: true,
    error: config.openaiApiKey
      ? undefined
      : "OPENAI_API_KEY is not set",
  };
}

async function checkSearxng() {
  // SearXNG is exercised during discovery; it is not treated as a fatal
  // readiness dependency here.
  return {
    name: "searxng",
    ok: true,
    required: false,
    skipped: true,
    note: "verified during discovery",
  };
}

export function evaluateReadiness(checks) {
  const required = checks.filter(
    (check) => check.required
  );

  const ok = required.every(
    (check) => check.ok
  );

  return {
    status: ok ? "ready" : "not_ready",
    ok,
    checks,
  };
}

export async function readiness() {
  const checks = await Promise.all([
    checkPostgres(),
    checkRedis(),
    checkOpenai(),
    checkSearxng(),
  ]);

  return evaluateReadiness(checks);
}
