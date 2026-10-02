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
function asList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "").split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
}

function productTypes(icp) {
  return [...new Set([
    ...asList(icp?.company_types || icp?.companyTypes),
    ...asList(icp?.industries),
    ...asList(icp?.industry),
  ])];
}

function locationFor(icp) {
  return String(icp?.location || asList(icp?.geography)[0] || "").trim();
}

function companyWebsiteQueries(userQuery, icp) {
  const location = locationFor(icp);
  const where = location ? `"${location}"` : "";
  const types = productTypes(icp);
  const typeQueries = types.slice(0, 5).flatMap((type) => [
    `"${type}" ${where} company "about us" ${EXCLUDE_NOISE}`,
    `"${type}" ${where} official website ${EXCLUDE_NOISE}`,
  ]);

  return [
    `${userQuery} official website ${EXCLUDE_NOISE}`,
    `${userQuery} company "about us" ${EXCLUDE_NOISE}`,
    `${userQuery} customers company website ${EXCLUDE_NOISE}`,
    ...typeQueries,
    ...((icp?.name || icp?.product_name)
      ? [`"${icp.name || icp.product_name}" ${where} customers ${EXCLUDE_NOISE}`]
      : []),
  ];
}

function fallbackQueries(
  userQuery,
  icp = null,
) {
  const location = locationFor(icp);
  const types = productTypes(icp);
  const typeText = types.join(", ");
  const offering = String(icp?.product_description || icp?.offering || icp?.product || "").trim();
  const idealCustomer = String(icp?.ideal_customer || icp?.target_description || "").trim();
  const queries = companyWebsiteQueries(userQuery, icp);

  return {
    target_description: [idealCustomer, userQuery.trim(), offering && `Product: ${offering}`].filter(Boolean).join(". "),

    location,

    industry: typeText || "",

    company_type: typeText || "companies matching the requested customer profile",

    product_or_technology: String(icp?.name || icp?.product_name || offering || "").trim(),

    relationship: ["uses", "needs", "sells", "offers", "implements", "related_to", "unknown"].includes(icp?.relationship)
      ? icp.relationship
      : "needs",

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
  return cleanQueries(companyWebsiteQueries(userQuery, icp).slice(1));
}
