// Code-based company qualification.
// Combines the permanent LinkAssist ICP with the query-specific searchPlan.
//
// The LLM is NOT involved in this decision.
// Qualification is deterministic and happens after company extraction.
//
// Returns:
//   "qualified"
//   "not_qualified"
//   "review"
//
// IMPORTANT:
// Unknown / insufficient evidence must never become "qualified".

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
    .filter(
      (word) =>
        word.length >= 3 &&
        !STOP_WORDS.has(word),
    );
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
      ...tokenize(
        searchPlan?.product_or_technology,
      ),
      ...tokenize(
        searchPlan?.industry,
      ),
      ...tokenize(
        searchPlan?.target_description,
      ),
    ]),
  ];
}

function offeringTechnologies(profile) {
  return (
    profile?.technology_signals || []
  )
    .filter(
      (signal) =>
        signal &&
        (
          signal.relationship ===
            "offers" ||
          signal.relationship ===
            "implements"
        ),
    )
    .map((signal) =>
      String(
        signal.technology || "",
      ).toLowerCase(),
    );
}

const USAGE_PHRASES =
  /\b(?:uses?|using|runs?\s+on|built\s+on|powered\s+by|deployed\s+on|migrated\s+to|adopted|rolled\s+out)\b/i;

function escapeRegExp(value) {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
}

function hasUseEvidence(
  profile,
  term,
) {
  const lower =
    String(term).toLowerCase();

  const signal = (
    profile?.technology_signals ||
    []
  ).some(
    (entry) =>
      entry &&
      (
        entry.relationship ===
          "uses" ||
        entry.relationship ===
          "integrates_with"
      ) &&
      String(
        entry.technology || "",
      )
        .toLowerCase()
        .includes(lower),
  );

  if (signal) {
    return true;
  }

  const text =
    profileText(
      profile,
    ).toLowerCase();

  const termPattern =
    new RegExp(
      `\\b${escapeRegExp(lower)}\\b`,
      "i",
    );

  return (
    termPattern.test(text) &&
    USAGE_PHRASES.test(text)
  );
}

function evaluateSearchPlanFit(
  profile,
  searchPlan,
) {
  const evidence = [];

  if (!searchPlan) {
    return {
      status: "review",
      reasons: [
        "missing search plan",
      ],
      evidence,
    };
  }

  const terms =
    searchPlanTerms(
      searchPlan,
    );

  if (!terms.length) {
    return {
      status: "review",
      reasons: [
        "no search plan terms",
      ],
      evidence,
    };
  }

  const hasContent =
    Boolean(
      profile?.company_description,
    ) ||
    (
      profile?.industries || []
    ).length > 0 ||
    (
      profile?.products_services || []
    ).length > 0;

  if (!hasContent) {
    return {
      status: "review",
      reasons: [
        "no profile evidence",
      ],
      evidence,
    };
  }

  const text =
    profileText(
      profile,
    ).toLowerCase();

  const matched =
    terms.filter(
      (term) =>
        text.includes(
          term,
        ),
    );

  if (!matched.length) {
    return {
      status: "not_qualified",
      reasons: [
        "does not match search plan",
      ],
      evidence,
    };
  }

  evidence.push(
    `matches: ${matched.join(", ")}`,
  );

  //
  // For "uses" queries, a vendor/implementation company
  // is not the intended prospect.
  //
  if (
    searchPlan.relationship ===
    "uses"
  ) {
    const offerings =
      offeringTechnologies(
        profile,
      );

    const vendorTerms =
      matched.filter(
        (term) =>
          offerings.some(
            (offering) =>
              offering.includes(
                term,
              ),
          ),
      );

    if (vendorTerms.length) {
      return {
        status:
          "not_qualified",

        reasons: [
          "sells the target technology",
        ],

        evidence: [
          `offers: ${vendorTerms.join(", ")}`,
        ],
      };
    }

    const usedTerms =
      matched.filter(
        (term) =>
          hasUseEvidence(
            profile,
            term,
          ),
      );

    if (usedTerms.length) {
      evidence.push(
        `uses: ${usedTerms.join(", ")}`,
      );
    } else {
      return {
        status: "review",

        reasons: [
          "mentions technology but no evidence of use",
        ],

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

export function qualifyCompany({
  profile,
  searchPlan,
  domain,
} = {}) {
  void domain;

  const reasons = [];
  const evidence = [];

  //
  // 1. Permanent LinkAssist ICP gate
  //
  const icp =
    evaluateIcp(
      profile,
    );

  reasons.push(
    ...(icp.reasons || []),
  );

  evidence.push(
    ...(icp.evidence || []),
  );

  if (
    icp.status ===
    "not_qualified"
  ) {
    return {
      status:
        "not_qualified",
      reasons,
      evidence,
    };
  }

  //
  // 2. Query-specific searchPlan gate
  //
  const plan =
    evaluateSearchPlanFit(
      profile,
      searchPlan,
    );

  reasons.push(
    ...(plan.reasons || []),
  );

  evidence.push(
    ...(plan.evidence || []),
  );

  if (
    plan.status ===
    "not_qualified"
  ) {
    return {
      status:
        "not_qualified",
      reasons,
      evidence,
    };
  }

  //
  // Any uncertainty stays review.
  //
  if (
    icp.status === "review" ||
    plan.status === "review"
  ) {
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

export function shouldDeepCrawl(
  qualification,
) {
  return (
    qualification?.status ===
    "qualified"
  );
}