import assert from "node:assert/strict";

import { config } from "../src/config.js";

import {
  createMcaClient,
} from "../src/mca/client.js";

import {
  matchMcaCompany,
  legalNameKey,
  domainStem,
} from "../src/mca/match.js";

import {
  enrichCompanyMca,
} from "../src/mca/index.js";

import {
  query,
  closePool,
} from "../src/storage/pg.js";

const DETAIL = {
  cin: "U12345MH2020PTC123456",
  company_name: "Acme Solar Private Limited",
  status: "Active",
  registration_date: "2020-01-15",
  source_ref: "https://www.mca.gov.in/company/U12345MH2020PTC123456",
  directors: [
    { din: "DIN0001", name: "Alice Sharma", designation: "Director", appointment_date: "2020-01-15" },
    { din: "DIN0002", name: "Bob Verma", designation: "Director", appointment_date: "2021-03-10" },
  ],
};

function mockMca({ candidates = [], details = {} } = {}) {
  const calls = { search: [], detail: [] };

  return {
    name: "mca",
    calls,
    async searchCompany(name) {
      calls.search.push(name);
      return candidates;
    },
    async getCompany(cin) {
      calls.detail.push(cin);
      return details[cin] ?? null;
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
  await test("legal name normalization", () => {
    assert.equal(legalNameKey("Acme Solar Private Limited"), legalNameKey("Acme Solar"));
    assert.equal(legalNameKey("Acme Solar Pvt. Ltd."), legalNameKey("Acme Solar"));
    assert.equal(domainStem("acmesolar.in"), "acmesolar");
  });

  await test("MCA match: exact name and CIN", () => {
    assert.equal(
      matchMcaCompany({ candidate: DETAIL, companyName: "Acme Solar", domain: "acmesolar.in" }),
      0.9
    );
    assert.equal(
      matchMcaCompany({ candidate: DETAIL, companyName: "Acme Solar", cin: "U12345MH2020PTC123456" }),
      0.95
    );
  });

  await test("MCA match: weak substring stays in review band", () => {
    const score = matchMcaCompany({ candidate: { company_name: "Acme Solar Labs Private Limited" }, companyName: "Acme Solar" });
    assert.ok(score >= 0.6 && score < 0.8, `score ${score}`);
    assert.equal(matchMcaCompany({ candidate: { company_name: "Zzz Corp" }, companyName: "Acme Solar" }), 0);
  });

  await test("directors extraction (accepted match)", async () => {
    const client = mockMca({
      candidates: [{ cin: DETAIL.cin, company_name: "Acme Solar Private Limited" }],
      details: { [DETAIL.cin]: DETAIL },
    });

    const result = await enrichCompanyMca({ companyName: "Acme Solar", domain: "acmesolar.in", client, persist: false });

    assert.equal(result.accepted, true);
    assert.equal(result.detail.directors.length, 2);
    assert.equal(client.calls.search.length, 1);
    assert.equal(client.calls.detail[0], DETAIL.cin);
  });

  await test("CIN direct lookup", async () => {
    const client = mockMca({ details: { [DETAIL.cin]: DETAIL } });
    const result = await enrichCompanyMca({ cin: DETAIL.cin, client, persist: false });

    assert.equal(result.accepted, true);
    assert.equal(result.confidence, 0.95);
    assert.equal(client.calls.detail[0], DETAIL.cin);
    assert.equal(client.calls.search.length, 0);
  });

  await test("weak-match rejection goes to review (no detail fetch)", async () => {
    const client = mockMca({ candidates: [{ cin: "U-WEAK", company_name: "Acme Solar Labs Private Limited" }] });

    const result = await enrichCompanyMca({ companyName: "Acme Solar", client, persist: false });

    assert.equal(result.matched, true);
    assert.equal(result.accepted, false);
    assert.equal(result.status, "review");
    assert.equal(client.calls.detail.length, 0);
  });

  await test("no match at all", async () => {
    const client = mockMca({ candidates: [{ cin: "U-X", company_name: "Zzz Corp" }] });
    const result = await enrichCompanyMca({ companyName: "Acme Solar", client, persist: false });
    assert.equal(result.matched, false);
  });

  await test("client is gated (no live request when disabled)", async () => {
    assert.equal(config.mcaEnabled, false);
    const client = createMcaClient(config);
    const items = await client.searchCompany("acme");
    assert.deepEqual(items, []);
    assert.equal(await client.getCompany("CIN"), null);
  });

  await test("provenance + raw_records persistence (source_type=mca)", async () => {
    const client = mockMca({
      candidates: [{ cin: DETAIL.cin, company_name: "Acme Solar Private Limited" }],
      details: { [DETAIL.cin]: DETAIL },
    });

    const result = await enrichCompanyMca({ companyName: "Acme Solar", domain: "acmesolar.in", client, persist: true });

    assert.equal(result.accepted, true);
    assert.equal(result.record.source_type, "mca");
    assert.equal(result.record.source_ref, "https://www.mca.gov.in/company/U12345MH2020PTC123456");
    assert.equal(result.record.record_type, "mca");
    assert.equal(result.record.status, "pending");
    assert.equal(Number(result.record.confidence), 0.9);

    const rows = (await query("SELECT * FROM raw_records WHERE id = $1", [result.record.id])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].payload.legal_name, "Acme Solar Private Limited");
    assert.equal(rows[0].payload.cin, DETAIL.cin);
    assert.equal(rows[0].payload.directors.length, 2);
    assert.ok(rows[0].payload.observed_at);
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
