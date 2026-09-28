import assert from "node:assert/strict";

import {
  deterministicFilter,
  classifyCandidates,
  rankCandidates,
} from "../src/relevance/companyRelevance.js";

function candidate(url, extra = {}) {
  return {
    url,
    domain: extra.domain || new URL(url).hostname,
    title: extra.title || "",
    snippet: extra.snippet || "",
  };
}

function decision(url, { relevant = true, score = 0.9 } = {}) {
  return {
    url,
    relevant,
    score,
    type: relevant ? "company" : "directory",
    reason_code: relevant ? "matches_industry" : "directory_listing",
    confidence: 0.8,
  };
}

function fakeProvider(handler) {
  const calls = [];

  return {
    name: "openai",
    calls,
    async complete(input) {
      calls.push(input);

      return handler(input, calls.length);
    },
  };
}

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
  await test("deterministic filter rejects malformed/assets/excluded/dupes", () => {
    const { accepted, rejected } = deterministicFilter([
      { url: "not a url" },
      { url: "https://acme.com/report.pdf" },
      { url: "https://linkedin.com/company/acme" },
      { url: "https://acme.com/about" },
      { url: "https://acme.com/about" },
      { url: "https://acme.com/solar" },
    ]);

    assert.equal(accepted.length, 2);

    const reasons = rejected.map((r) => r.reason_code).sort();
    assert.ok(reasons.includes("malformed_url"));
    assert.ok(reasons.includes("non_html_asset"));
    assert.ok(reasons.includes("excluded_domain"));
    assert.ok(reasons.includes("duplicate_url"));
  });

  await test("classifyCandidates validates structured output", async () => {
    const valid = fakeProvider(() => ({
      attempted: true,
      ok: true,
      data: {
        decisions: [decision("https://acme.com/about")],
      },
    }));

    const ok = await classifyCandidates(
      valid,
      "solar companies",
      [candidate("https://acme.com/about")]
    );

    assert.equal(ok.ok, true);
    assert.equal(ok.decisions.length, 1);

    const invalid = fakeProvider(() => ({
      attempted: true,
      ok: true,
      data: { decisions: [{ url: "x" }] },
    }));

    const bad = await classifyCandidates(
      invalid,
      "solar companies",
      [candidate("https://acme.com/about")]
    );

    assert.equal(bad.ok, false);
    assert.match(bad.error, /invalid relevance output/);
  });

  await test("rankCandidates applies deterministic threshold", async () => {
    const provider = fakeProvider(() => ({
      attempted: true,
      ok: true,
      data: {
        decisions: [
          decision("https://acme.com/about", { score: 0.9 }),
          decision("https://acme.com/blog", { score: 0.2 }),
        ],
      },
    }));

    const result = await rankCandidates({
      userQuery: "solar companies",
      candidates: [
        candidate("https://acme.com/about"),
        candidate("https://acme.com/blog"),
      ],
      provider,
      threshold: 0.5,
    });

    assert.equal(result.relevanceStatus, "classified");
    assert.equal(result.approved.length, 1);
    assert.equal(result.approved[0].url, "https://acme.com/about");
    assert.equal(result.approved[0].relevance.status, "approved");
  });

  await test("rankCandidates falls back when provider fails", async () => {
    const provider = fakeProvider(() => ({
      attempted: true,
      ok: false,
      error: "boom",
    }));

    const result = await rankCandidates({
      userQuery: "solar companies",
      candidates: [
        candidate("https://acme.com/about"),
        candidate("https://acme.com/solar"),
      ],
      provider,
    });

    assert.equal(result.relevanceStatus, "fallback");
    assert.equal(result.approved.length, 2);
    assert.ok(
      result.approved.every(
        (c) => c.relevance.status === "fallback"
      )
    );
  });

  await test("rankCandidates batches candidates into one call", async () => {
    const candidates = Array.from(
      { length: 60 },
      (_, i) =>
        candidate(`https://acme${i}.com/about`)
    );

    const provider = fakeProvider(() => ({
      attempted: true,
      ok: true,
      data: {
        decisions: candidates.map((c) =>
          decision(c.url)
        ),
      },
    }));

    const result = await rankCandidates({
      userQuery: "solar companies",
      candidates,
      provider,
      threshold: 0.5,
    });

    assert.ok(provider.calls.length < candidates.length);
    assert.ok(provider.calls.length >= 1);
    assert.equal(result.approved.length, 60);
  });

  await test("rankCandidates preserves URL provenance", async () => {
    const provider = fakeProvider(() => ({
      attempted: true,
      ok: true,
      data: {
        decisions: [decision("https://acme.com/about")],
      },
    }));

    const result = await rankCandidates({
      userQuery: "solar companies",
      candidates: [
        candidate("https://acme.com/about", {
          title: "About Acme Solar",
          snippet: "Solar panels in India",
        }),
      ],
      provider,
    });

    const approved = result.approved[0];

    assert.equal(approved.url, "https://acme.com/about");
    assert.equal(approved.title, "About Acme Solar");
    assert.equal(approved.snippet, "Solar panels in India");
    assert.equal(approved.domain, "acme.com");
    assert.equal(approved.relevance.provider, "openai");
    assert.equal(approved.relevance.reason_code, "matches_industry");
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
