// Code-based company qualification. Combines the permanent BDA ICP with the
// query-specific searchPlan. The LLM is not involved in the decision: this is
// deterministic filtering/validation on the extracted company profile.
//
// Returns one of: "qualified" | "not_qualified" | "review".
// Qualification requires BOTH ICP fit AND searchPlan fit.
// "Unknown/insufficient evidence" always resolves to "review", never
// "qualified".

import { evaluateIcp } from "../icp/linkassist.js";

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "for",
  "by",
  "with",
  "in",
  "on",
  "to",
  "from",
  "find",
  "companies",
  "company",
  "that",
  "use",
  "using",
  "uses",
  "industry",
]);

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

function profileText(profile) {
  return [
    profile?.company_name,
    profile?.company_description,
    ...(profile?.industries || []),
    ...(profile?.products_services || []),
  ]
    .filter(Boolean)
    .join(" ");
}

function searchPlanTerms(searchPlan) {
  return [
    ...new Set([
      ...tokenize(searchPlan?.product_or_technology),
      ...tokenize(searchPlan?.industry),
      ...tokenize(searchPlan?.target_description),
    ]),
  ];
}

function offeringTechnologies(profile) {
  return (profile?.technology_signals || [])
    .filter(
      (signal) =>
        signal &&
        (signal.relationship === "offers" ||
          signal.relationship === "implements"),
    )
    .map((signal) => String(signal.technology || "").toLowerCase());
}

const USAGE_PHRASES =
  /\b(?:uses?|using|runs?\s+on|built\s+on|powered\s+by|deployed\s+on|migrated\s+to|adopted|rolled\s+out)\b/i;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// For a "uses" search plan, a mere mention of the technology is not enough to
// prove the company uses it. True use evidence is either a technology_signal
// with relationship "uses"/"integrates_with", or an explicit usage phrase in
// the profile text.
function hasUseEvidence(profile, term) {
  const lower = term.toLowerCase();

  const signal = (profile?.technology_signals || []).some(
    (entry) =>
      entry &&
      (entry.relationship === "uses" ||
        entry.relationship === "integrates_with") &&
      String(entry.technology || "")
        .toLowerCase()
        .includes(lower),
  );

  if (signal) {
    return true;
  }

  const text = profileText(profile).toLowerCase();

  return (
    new RegExp(`\\b${escapeRegExp(lower)}\\b`, "i").test(text) &&
    USAGE_PHRASES.test(text)
  );
}

function evaluateSearchPlanFit(profile, searchPlan) {
  const evidence = [];

  if (!searchPlan) {
    return {
      status: "review",
      reasons: ["missing search plan"],
      evidence,
    };
  }

  const terms = searchPlanTerms(searchPlan);

  if (!terms.length) {
    return {
      status: "review",
      reasons: ["no search plan terms"],
      evidence,
    };
  }

  const hasContent =
    Boolean(profile?.company_description) ||
    (profile?.industries || []).length > 0 ||
    (profile?.products_services || []).length > 0;

  if (!hasContent) {
    return {
      status: "review",
      reasons: ["no profile evidence"],
      evidence,
    };
  }

  const text = profileText(profile).toLowerCase();
  const matched = terms.filter((term) => text.includes(term));

  if (!matched.length) {
    return {
      status: "not_qualified",
      reasons: ["does not match search plan"],
      evidence,
    };
  }

  evidence.push(`matches: ${matched.join(", ")}`);

  // When the query targets companies that *use* a technology, a company that
  // *offers/implements* it is a vendor, not a prospect.
  if (searchPlan.relationship === "uses") {
    const offerings = offeringTechnologies(profile);

    const vendorTerms = matched.filter((term) =>
      offerings.some((offering) => offering.includes(term)),
    );

    if (vendorTerms.length) {
      return {
        status: "not_qualified",
        reasons: ["sells the target technology"],
        evidence: [`offers: ${vendorTerms.join(", ")}`],
      };
    }

    const usedTerms = matched.filter((term) =>
      hasUseEvidence(profile, term),
    );

    if (usedTerms.length) {
      evidence.push(`uses: ${usedTerms.join(", ")}`);
    } else {
      return {
        status: "review",
        reasons: ["mentions technology but no evidence of use"],
        evidence,
      };
    }
  }

  return {
    status: "qualified",
    reasons: [],
    evidence,
  };
}

export function qualifyCompany({ profile, searchPlan, domain } = {}) {
  const reasons = [];
  const evidence = [];

  const icp = evaluateIcp(profile);
  reasons.push(...icp.reasons);
  evidence.push(...icp.evidence);

  if (icp.status === "not_qualified") {
    return {
      status: "not_qualified",
      reasons,
      evidence,
    };
  }

  const plan = evaluateSearchPlanFit(profile, searchPlan);
  reasons.push(...plan.reasons);
  evidence.push(...plan.evidence);

  if (plan.status === "not_qualified") {
    return {
      status: "not_qualified",
      reasons,
      evidence,
    };
  }

  if (icp.status === "review" || plan.status === "review") {
    return {
      status: "review",
      reasons,
      evidence,
    };
  }

  return {
    status: "qualified",
    reasons,
    evidence,
  };
}

export function shouldDeepCrawl(qualification) {
  return qualification?.status === "qualified";
}
