import assert from "node:assert/strict";

import { config } from "../src/config.js";

import {
  createGithubClient,
} from "../src/github/client.js";

import {
  matchOrganization,
  deriveTechnologyHints,
  slugify,
  domainStem,
} from "../src/github/match.js";

import {
  enrichCompanyGithub,
} from "../src/github/index.js";

import {
  query,
  closePool,
} from "../src/storage/pg.js";

const ORG = {
  login: "acmesolar",
  name: "Acme Solar Inc",
  html_url: "https://github.com/acmesolar",
  description: "Solar manufacturing and energy",
};

function mockGithub({ orgs = [], members = [], repositories = [] } = {}) {
  const calls = { search: [], members: [], repos: [] };

  return {
    name: "github",
    calls,
    async searchOrganizations(query) {
      calls.search.push(query);
      return orgs;
    },
    async listPublicMembers(login) {
      calls.members.push(login);
      return members;
    },
    async listRepositories(login) {
      calls.repos.push(login);
      return repositories;
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
  await test("slug helpers", () => {
    assert.equal(slugify("Acme Solar!"), "acmesolar");
    assert.equal(domainStem("https://www.acme.com/about"), "acme");
    assert.equal(domainStem("acmesolar.com"), "acmesolar");
  });

  await test("organization match: exact slug and domain", () => {
    assert.equal(
      matchOrganization({ org: { login: "acmesolar" }, companyName: "Acme Solar", domain: "acmesolar.com" }),
      0.95
    );
    assert.equal(
      matchOrganization({ org: { login: "acme" }, companyName: "", domain: "acme.com" }),
      0.95
    );
  });

  await test("organization match: fuzzy overlap stays in review band", () => {
    const score = matchOrganization({ org: { login: "acme-solar-labs" }, companyName: "Acme Solar" });
    assert.ok(score >= 0.6 && score < 0.8, `score ${score}`);
    assert.equal(matchOrganization({ org: { login: "zzz" }, companyName: "Acme Solar" }), 0);
  });

  await test("member extraction", async () => {
    const client = mockGithub({
      orgs: [ORG],
      members: [
        { login: "alice", html_url: "https://github.com/alice", avatar_url: "" },
        { login: "bob", html_url: "https://github.com/bob", avatar_url: "" },
      ],
    });

    const result = await enrichCompanyGithub({ companyName: "Acme Solar", domain: "acmesolar.com", client, persist: false });

    assert.equal(result.accepted, true);
    assert.equal(result.members.length, 2);
    assert.equal(client.calls.members[0], "acmesolar");
  });

  await test("repository/technology extraction", async () => {
    const client = mockGithub({
      orgs: [ORG],
      repositories: [
        { name: "api", language: "TypeScript", topics: ["solar", "energy"] },
        { name: "web", language: "TypeScript", topics: ["solar"] },
        { name: "etl", language: "Python", topics: ["data"] },
      ],
    });

    const result = await enrichCompanyGithub({ companyName: "Acme Solar", domain: "acmesolar.com", client, persist: false });

    assert.deepEqual(result.technologyHints.languages[0], { language: "TypeScript", repositories: 2 });
    assert.ok(result.technologyHints.topics.includes("solar"));
  });

  await test("weak-match rejection goes to review (no member/repo calls)", async () => {
    const client = mockGithub({ orgs: [{ login: "acme-solar-labs", html_url: "https://github.com/acme-solar-labs" }] });

    const result = await enrichCompanyGithub({ companyName: "Acme Solar", domain: "acmesolar.com", client, persist: false });

    assert.equal(result.matched, true);
    assert.equal(result.accepted, false);
    assert.equal(result.status, "review");
    assert.equal(client.calls.members.length, 0);
    assert.equal(client.calls.repos.length, 0);
  });

  await test("no match at all", async () => {
    const client = mockGithub({ orgs: [{ login: "zzz", html_url: "https://github.com/zzz" }] });
    const result = await enrichCompanyGithub({ companyName: "Acme Solar", domain: "acmesolar.com", client, persist: false });
    assert.equal(result.matched, false);
  });

  await test("client uses injected fetch and caches by path", async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      return { ok: true, json: async () => ({ items: [{ login: "acmesolar" }] }) };
    };

    const client = createGithubClient(config, { fetchImpl });
    const a = await client.searchOrganizations("acme");
    const b = await client.searchOrganizations("acme");

    assert.deepEqual(a, [{ login: "acmesolar" }]);
    assert.deepEqual(b, a);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes("api.github.com"));
    assert.ok(calls[0].includes("type:org"));
  });

  await test("provenance + raw_records persistence (source_type=github)", async () => {
    const client = mockGithub({
      orgs: [ORG],
      members: [{ login: "alice", html_url: "https://github.com/alice", avatar_url: "" }],
      repositories: [{ name: "api", language: "TypeScript", topics: [] }],
    });

    const result = await enrichCompanyGithub({ companyName: "Acme Solar", domain: "acmesolar.com", client, persist: true });

    assert.equal(result.accepted, true);
    assert.equal(result.record.source_type, "github");
    assert.equal(result.record.source_ref, "https://github.com/acmesolar");
    assert.equal(result.record.record_type, "github");
    assert.equal(result.record.status, "pending");
    assert.equal(Number(result.record.confidence), 0.95);

    const rows = (await query("SELECT * FROM raw_records WHERE id = $1", [result.record.id])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source_type, "github");
    assert.equal(rows[0].payload.organization.login, "acmesolar");
    assert.equal(rows[0].payload.public_members.length, 1);
    assert.equal(rows[0].payload.technology_hints.languages[0].language, "TypeScript");
  });

  console.log("");
  const failed = results.filter((r) => !r.ok);
  console.log(`Passed ${results.length - failed.length}/${results.length}`);

  if (failed.length) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("Test run failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
