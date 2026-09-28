import assert from "node:assert/strict";

import {
  nameKey,
  fuzzyNameMatch,
  normalizeProfileUrl,
  comparePeople,
  personFromContact,
  personFromGithubMember,
  personFromMcaDirector,
  dedupePeople,
} from "../src/dedup/crossSource.js";

const WEBSITE = {
  full_name: "Alice Sharma",
  first_name: "Alice",
  last_name: "Sharma",
  title: "Chief Technology Officer",
  role_category: "technology_leader",
  email: "alice@acmesolar.in",
  phone: null,
  profile_urls: [],
  source_url: "https://acmesolar.in/team/alice",
  source_urls: ["https://acmesolar.in/team/alice"],
  page_ids: [101],
  evidence: ["team page lists Alice Sharma, CTO"],
  confidence: 0.85,
};

const GITHUB_MEMBER = {
  login: "alice-sharma",
  name: "Alice Sharma",
  html_url: "https://github.com/alice-sharma",
};

const GITHUB_ORG = { login: "acmesolar", name: "Acme Solar" };

const MCA_DIRECTOR = {
  din: "DIN000123",
  name: "Alice Sharma",
  designation: "Director",
};

const MCA_COMPANY = { cin: "U12345MH2020PTC123456" };

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
  await test("name/profile-url helpers", () => {
    assert.equal(nameKey("Alice Sharma"), "alice sharma");
    assert.equal(nameKey("Alice-Sharma"), "alice sharma");
    assert.equal(normalizeProfileUrl("https://github.com/alice-sharma/"), "github.com/alice-sharma");
    assert.equal(fuzzyNameMatch("Alice Sharma", "Alice S. Sharma"), true);
    assert.equal(fuzzyNameMatch("Alice Sharma", "Bob Verma"), false);
  });

  await test("website + GitHub same person", () => {
    const people = [
      personFromContact(WEBSITE),
      personFromGithubMember(GITHUB_MEMBER, { organization: GITHUB_ORG, confidence: 0.95 }),
    ];

    const { merged, review } = dedupePeople(people);

    assert.equal(merged.length, 1);
    assert.equal(review.length, 0);
    assert.deepEqual(merged[0].sources, ["website", "github"]);
    assert.equal(merged[0].email, "alice@acmesolar.in");
    assert.equal(merged[0].name, "Alice Sharma");
  });

  await test("website + MCA same person", () => {
    const people = [
      personFromContact(WEBSITE),
      personFromMcaDirector(MCA_DIRECTOR, { company: MCA_COMPANY, confidence: 0.9 }),
    ];

    const { merged, review } = dedupePeople(people);

    assert.equal(merged.length, 1);
    assert.equal(review.length, 0);
    assert.deepEqual(merged[0].sources, ["website", "mca"]);
    assert.ok(merged[0].titles.includes("Director"));
  });

  await test("all three same person", () => {
    const people = [
      personFromContact(WEBSITE),
      personFromGithubMember(GITHUB_MEMBER, { organization: GITHUB_ORG, confidence: 0.95 }),
      personFromMcaDirector(MCA_DIRECTOR, { company: MCA_COMPANY, confidence: 0.9 }),
    ];

    const { merged, review } = dedupePeople(people);

    assert.equal(merged.length, 1);
    assert.equal(review.length, 0);
    assert.deepEqual(merged[0].sources, ["website", "github", "mca"]);
    assert.equal(merged[0].email, "alice@acmesolar.in");
  });

  await test("same name but different people stay separate", () => {
    const people = [
      personFromContact({ ...WEBSITE, email: "rahul@acmesolar.in", full_name: "Rahul Kumar", first_name: "Rahul", last_name: "Kumar" }),
      personFromContact({ ...WEBSITE, email: "rahul.k@acmesolar.in", full_name: "Rahul Kumar", first_name: "Rahul", last_name: "Kumar", source_url: "https://acmesolar.in/team/rahul-k", source_urls: ["https://acmesolar.in/team/rahul-k"], page_ids: [102] }),
    ];

    const { merged, review } = dedupePeople(people);

    assert.equal(merged.length, 2);
    assert.equal(review.length, 0);
  });

  await test("weak fuzzy match stays review (not merged)", () => {
    const people = [
      personFromContact(WEBSITE),
      personFromGithubMember({ ...GITHUB_MEMBER, login: "alicia-sharma", name: "Alicia Sharma", html_url: "https://github.com/alicia-sharma" }, { organization: GITHUB_ORG, confidence: 0.9 }),
    ];

    const { merged, review } = dedupePeople(people);

    assert.equal(merged.length, 2);
    assert.equal(review.length, 1);
    assert.equal(review[0].reason, "fuzzy-name");
  });

  await test("strong source identity (shared profile URL)", () => {
    const contact = {
      ...WEBSITE,
      profile_urls: ["https://github.com/alice-sharma"],
    };

    const people = [
      personFromContact(contact),
      personFromGithubMember({ ...GITHUB_MEMBER, name: "" }, { organization: GITHUB_ORG, confidence: 0.9 }),
    ];

    const { merged, review } = dedupePeople(people);

    assert.equal(merged.length, 1);
    assert.equal(review.length, 0);
    assert.deepEqual(merged[0].sources, ["website", "github"]);
  });

  await test("provenance survives merge", () => {
    const people = [
      personFromContact(WEBSITE),
      personFromGithubMember(GITHUB_MEMBER, { organization: GITHUB_ORG, confidence: 0.95 }),
      personFromMcaDirector(MCA_DIRECTOR, { company: MCA_COMPANY, confidence: 0.9 }),
    ];

    const { merged } = dedupePeople(people);
    const person = merged[0];

    assert.deepEqual(person.sources, ["website", "github", "mca"]);
    assert.ok(person.source_urls.includes("https://acmesolar.in/team/alice"));
    assert.ok(person.source_urls.includes("https://github.com/alice-sharma"));
    assert.deepEqual(person.page_ids, [101]);
    assert.ok(person.source_refs.includes("github:alice-sharma"));
    assert.ok(person.source_refs.includes("github:org:acmesolar"));
    assert.ok(person.source_refs.includes("mca:din:DIN000123"));
    assert.ok(person.source_refs.includes("mca:cin:U12345MH2020PTC123456"));
    assert.ok(person.evidence.includes("team page lists Alice Sharma, CTO"));
    assert.equal(person.confidence, 0.95);
  });

  console.log("");
  const failed = results.filter((r) => !r.ok);
  console.log(`Passed ${results.length - failed.length}/${results.length}`);

  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Test run failed:", error);
  process.exitCode = 1;
});
