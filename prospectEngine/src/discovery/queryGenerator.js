import { z } from "zod";

import { config } from "../config.js";

const SearchPlanSchema = z.object({
  target_description:
    z.string(),

  location:
    z.string(),

  industry:
    z.string(),

  company_type:
    z.string(),

  product_or_technology:
    z.string(),

  relationship:
    z.enum([
      "uses",
      "needs",
      "sells",
      "offers",
      "implements",
      "related_to",
      "unknown",
    ]),

  search_queries:
    z
      .array(z.string())
      .min(3)
      .max(20),
});

function cleanQueries(
  queries,
) {
  return [
    ...new Set(
      queries
        .map((query) =>
          String(query).trim(),
        )
        .filter(Boolean),
    ),
  ].slice(
    0,
    config.maxSearchQueries,
  );
}

// Common noise-domain exclusions appended to most queries.
const EXCLUDE_NOISE =
  `-site:linkedin.com -site:facebook.com -site:instagram.com` +
  ` -site:clutch.co -site:goodfirms.co -site:g2.com` +
  ` -site:justdial.com -site:indiamart.com -site:naukri.com` +
  ` -site:wellfound.com -site:glassdoor.com -site:indeed.com` +
  ` -site:yourstory.com -site:inc42.com -site:reddit.com` +
  ` -site:medium.com -site:quora.com`;

//
// Company-website-intent queries.
//
// Each query is designed to surface the official website of an Indian B2B
// company rather than LinkedIn profiles, news articles, or directories.
//
// Tactics used:
//   1. inurl:about / inurl:about-us  → company "About" pages
//   2. inurl:services / inurl:solutions → company service pages
//   3. "about us" in quotes           → text that appears on company sites
//   4. site:.in                       → Indian TLD companies
//   5. -site:*                        → exclude noise domains
//   6. intitle:                       → title-based signal for company pages
//
function buildCompanyWebsiteQueries() {
  return [
    // ── B2B SaaS ──────────────────────────────────────────────────────────
    `"B2B SaaS" India inurl:about "founder" OR "CEO" OR "co-founder" ${EXCLUDE_NOISE}`,

    `"SaaS company" India inurl:about-us OR inurl:about "we help" OR "our product" ${EXCLUDE_NOISE}`,

    `site:.in "SaaS" "software" "founder" OR "CEO" "about us" ${EXCLUDE_NOISE}`,

    // ── Software / IT services ────────────────────────────────────────────
    `"software company" India inurl:about "founded" OR "we build" OR "our team" ${EXCLUDE_NOISE}`,

    `"IT services" India site:.in OR site:com inurl:about OR inurl:services "founded" OR "team" ${EXCLUDE_NOISE}`,

    `"software development" India inurl:about-us "founder" OR "CEO" ${EXCLUDE_NOISE}`,

    // ── Marketing / AI agencies ───────────────────────────────────────────
    `"digital marketing agency" India inurl:about "founder" OR "we are" ${EXCLUDE_NOISE}`,

    `"performance marketing" India site:.in OR site:com inurl:about OR inurl:services ${EXCLUDE_NOISE}`,

    `"AI agency" OR "AI marketing" India inurl:about "founder" OR "CEO" ${EXCLUDE_NOISE}`,

    // ── Consulting / professional services ────────────────────────────────
    `"consulting firm" India inurl:about "founder" OR "principal" OR "established" ${EXCLUDE_NOISE}`,

    `"business consultant" India site:.in inurl:about OR inurl:services ${EXCLUDE_NOISE}`,

    `"management consulting" India inurl:about-us "founder" OR "we help businesses" ${EXCLUDE_NOISE}`,

    // ── Business coaches ──────────────────────────────────────────────────
    `"business coach" India site:.in OR site:com inurl:about "I help" OR "we help" ${EXCLUDE_NOISE}`,

    `"executive coach" India inurl:about "founder" OR "certified" ${EXCLUDE_NOISE}`,

    // ── Recruitment / staffing ────────────────────────────────────────────
    `"recruitment agency" India inurl:about "founded" OR "our team" ${EXCLUDE_NOISE}`,

    `"staffing company" India site:.in inurl:about OR inurl:services ${EXCLUDE_NOISE}`,

    // ── Professional services (broad) ─────────────────────────────────────
    `"professional services" India inurl:about "founder" OR "CEO" site:.in ${EXCLUDE_NOISE}`,

    // ── Founder-led / small company signals ───────────────────────────────
    `India "founder-led" B2B company inurl:about OR inurl:services ${EXCLUDE_NOISE}`,

    `India "small business" OR "startup" B2B inurl:about "founder" OR "CEO" site:.in ${EXCLUDE_NOISE}`,

    // ── Generic high-signal Indian company search ─────────────────────────
    `India B2B company site:.in "about us" "founder" OR "CEO" ${EXCLUDE_NOISE}`,
  ];
}

function fallbackQueries(
  userQuery,
  icp = null,
) {
  const queries = buildCompanyWebsiteQueries();

  return {
    target_description:
      `India-based founder-led small B2B companies (SaaS, agencies, consultants, coaches, IT services) ` +
      `that could benefit from LinkedIn content and personal-brand assistance. ` +
      `Request: ${userQuery.trim()}`,

    location:
      "India",

    industry:
      "B2B SaaS, software, marketing agency, AI agency, consulting, business coaching, IT services, recruitment, professional services",

    company_type:
      "founder-led small B2B company (1–50 employees)",

    product_or_technology:
      "LinkedIn content, personal branding, content creation",

    relationship:
      "needs",

    search_queries:
      cleanQueries(queries),
  };
}

export async function generateSearchPlan(
  userQuery,
  icp = null,
) {
  if (
    !userQuery ||
    !userQuery.trim()
  ) {
    throw new Error(
      "USER_QUERY cannot be empty.",
    );
  }

  //
  // Deterministic, company-website-intent query generation.
  // Queries use search dorks (inurl:, site:, -site:) that prioritise
  // official company pages over LinkedIn profiles, directories, and articles.
  //
  const plan =
    fallbackQueries(
      userQuery,
      icp,
    );

  return SearchPlanSchema.parse(
    plan,
  );
}

//
// Returns an additional set of supplementary queries for use when the
// first round of discovery approves too few companies.
// These are shorter / more direct queries that complement the primary set.
//
export function generateSupplementaryQueries(
  userQuery,
  icp = null,
) {
  const supplementary = [
    `"SaaS startup" India "about us" site:.in OR site:com ${EXCLUDE_NOISE}`,
    `"product company" India inurl:about "CEO" OR "founder" ${EXCLUDE_NOISE}`,
    `"tech startup" India inurl:about "we are" OR "our mission" site:.in ${EXCLUDE_NOISE}`,
    `"marketing consultant" India inurl:about site:.in ${EXCLUDE_NOISE}`,
    `"growth agency" India inurl:about "founder" ${EXCLUDE_NOISE}`,
    `"content marketing" agency India inurl:about "founder" OR "CEO" ${EXCLUDE_NOISE}`,
    `"B2B agency" India site:.in inurl:services OR inurl:about ${EXCLUDE_NOISE}`,
    `"HR consulting" India inurl:about "founder" site:.in ${EXCLUDE_NOISE}`,
    `"fintech" India "founder" inurl:about "about us" ${EXCLUDE_NOISE}`,
    `"edtech" India inurl:about "founder" OR "CEO" site:.in ${EXCLUDE_NOISE}`,
  ];

  return cleanQueries(supplementary);
}