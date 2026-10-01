import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  deterministicFilter,
  decideFromFacts,
} from "../src/relevance/companyRelevance.js";

import {
  qualifyCompany,
} from "../src/qualification/qualify.js";

import {
  deterministicContactExtract,
  extractCompanyContacts,
} from "../src/parse/deterministic/contact.js";

import {
  isRoleEmail,
} from "../src/parse/contact.js";

import {
  dedupePeople,
  personFromContact,
} from "../src/dedup/crossSource.js";

function readFixture(name) {
  const url = new URL(`./fixtures/${name}`, import.meta.url);

  return JSON.parse(readFileSync(url, "utf8"));
}

const results = [];
const metrics = {
  failOpenLeaks: 0,
  companyPrecision: null,
  labelAsName: 0,
  roleEmailPeople: 0,
  duplicates: 0,
  wrongMerges: 0,
};

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
  await test("relevance: no fail-open leaks from blocklist/listicle", () => {
    const fixtures = readFixture("relevance-eval.json");
    const blocked = fixtures.filter((f) => f.expected === "blocked");
    const approved = fixtures.filter((f) => f.expected === "approved");

    for (const fixture of blocked) {
      const { accepted } = deterministicFilter([
        {
          url: `https://${fixture.domain}/page`,
          title: fixture.title,
          snippet: fixture.snippet,
        },
      ]);

      if (accepted.length > 0) {
        metrics.failOpenLeaks += 1;
      }

      assert.equal(accepted.length, 0, `${fixture.domain} should be blocked`);
    }

    for (const fixture of approved) {
      const { accepted } = deterministicFilter([
        {
          url: `https://${fixture.domain}/about`,
          title: fixture.title,
          snippet: fixture.snippet,
        },
      ]);

      assert.equal(accepted.length, 1, `${fixture.domain} should pass the filter`);
    }
  });

  await test("qualification: company precision on eval set", () => {
    const fixtures = readFixture("qualification-eval.json");
    let correct = 0;

    for (const fixture of fixtures) {
      const outcome = qualifyCompany({
        profile: fixture.profile,
        searchPlan: fixture.searchPlan,
      });

      if (outcome.status === fixture.expected) {
        correct += 1;
      } else {
        assert.equal(outcome.status, fixture.expected, fixture.name);
      }
    }

    metrics.companyPrecision = correct / fixtures.length;
    assert.equal(correct, fixtures.length);
  });

  await test("contact extraction: no label-as-name or role-email people", () => {
    const fixtures = readFixture("contact-eval.json");

    for (const fixture of fixtures) {
      const people = deterministicContactExtract(
        "team_page",
        fixture.html,
        "https://acme.com/team",
      );

      const { role_emails } = extractCompanyContacts(
        fixture.html,
        "https://acme.com/team",
      );

      const labelNames = people.filter(
        (p) => !/^[A-Z][a-z]+(\s[A-Z][a-z]+)+$/.test(p.full_name),
      );

      const roleEmailPeople = people.filter(
        (p) => p.email && isRoleEmail(p.email),
      );

      metrics.labelAsName += labelNames.length;
      metrics.roleEmailPeople += roleEmailPeople.length;

      assert.equal(
        people.length,
        fixture.expected_people,
        `${fixture.name}: people`,
      );
      assert.deepEqual(
        role_emails.sort(),
        [...fixture.expected_role_emails].sort(),
        `${fixture.name}: role emails`,
      );
      assert.equal(labelNames.length, 0, `${fixture.name}: label-as-name`);
      assert.equal(roleEmailPeople.length, 0, `${fixture.name}: role-email people`);
    }
  });

  await test("dedup: role email is not an identity key", () => {
    const a = personFromContact({
      full_name: "Alice Smith",
      email: "info@acme.com",
      source_url: "https://acme.com/team/alice",
    });
    const b = personFromContact({
      full_name: "Alice Smith",
      email: "sales@acme.com",
      source_url: "https://acme.com/team/alice-2",
    });

    const { merged } = dedupePeople([a, b]);

    // Without role-email filtering these two differing role emails would be
    // treated as a DISTINCT conflict; with it they merge by exact name.
    assert.equal(merged.length, 1);
  });

  await test("dedup: shared phone is not an identity key", () => {
    const a = personFromContact({
      full_name: "Alice Smith",
      phone: "+15551112222",
      source_url: "https://acme.com/team/alice",
    });
    const b = personFromContact({
      full_name: "Bob Jones",
      phone: "+15551112222",
      source_url: "https://acme.com/team/bob",
    });

    const { merged } = dedupePeople([a, b]);

    // Same office phone across two people in the same domain must not merge.
    assert.equal(merged.length, 2);
  });

  await test("dedup: never auto-merge across company domains", () => {
    const a = personFromContact({
      full_name: "Alice Smith",
      email: "alice@acme.com",
      source_url: "https://acme.com/team/alice",
    });
    const b = personFromContact({
      full_name: "Alice Smith",
      email: "alice@acme.com",
      source_url: "https://other.com/team/alice",
    });

    const { merged } = dedupePeople([a, b]);

    assert.equal(merged.length, 2);
  });

  await test("dedup: transitive merge across a chain", () => {
    const a = personFromContact({
      full_name: "Alice Smith",
      email: "alice@acme.com",
      source_url: "https://acme.com/team/alice",
    });
    const b = personFromContact({
      full_name: "Alice Smith",
      phone: "+15551112222",
      source_url: "https://acme.com/team/alice-2",
    });
    const c = personFromContact({
      full_name: "Alice Smith",
      email: "alice@acme.com",
      source_url: "https://acme.com/about/alice",
    });

    const { merged } = dedupePeople([a, b, c]);

    assert.equal(merged.length, 1);
  });

  console.log("");
  console.log("EVAL METRICS");
  console.log(`  fail-open leaks (relevance): ${metrics.failOpenLeaks}`);
  console.log(`  company precision (qualification): ${metrics.companyPrecision ?? "n/a"}`);
  console.log(`  label-as-name people: ${metrics.labelAsName}`);
  console.log(`  role-email people: ${metrics.roleEmailPeople}`);
  console.log(`  duplicates: ${metrics.duplicates}`);
  console.log(`  wrong merges: ${metrics.wrongMerges}`);
  console.log("");

  const failed = results.filter((r) => !r.ok);
  console.log(`Passed ${results.length - failed.length}/${results.length}`);

  if (failed.length) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Eval run failed:", error);
  process.exitCode = 1;
});
