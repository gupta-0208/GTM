// Permanent BDA ICP (ideal customer profile), independent of any single query.
// BDA Technologies is a B2B company that sells Business Operating Systems
// (BOS) / business-process automation tools to operating companies.
//
// A prospect must therefore be a real operating company that plausibly
// benefits from business-process automation. Merely mentioning SAP, ERP, AI,
// automation, software, cloud, etc. is NOT enough — the ICP requires actual
// business-process surface area (operations, manufacturing, finance, HR,
// supply chain, ...).
//
// This module does NOT encode query-specific conditions (no SAP, no solar, no
// India, no specific test query). Query-specific fit lives in
// src/qualification/qualify.js and is combined with this permanent ICP.

export const BDA_ICP = {
  b2b: true,
  offering: "Business Operating System (BOS)",
  offering_category: "business-process automation",
  target: "operating company",
};

// Surfaces that are not a real operating company and should be rejected.
// Each entry carries a readable label so the stored evidence stays legible.
const NON_COMPANY_SIGNALS = [
  {
    label: "directory/aggregator/marketplace",
    pattern: /\bdirectory\b|\baggregator\b|\bmarketplace\b/,
  },
  {
    label: "listicle/listing",
    pattern:
      /\blisticle\b|\blist(?:s)?\s+of\b|\btop\s+\d+\b|\bbest\s+\d+\b|\b\d+\s+(?:best|top|leading)\b/,
  },
  {
    label: "job board",
    pattern:
      /\bjob\s+(?:board|boards|listing|listings|openings|postings)\b|\bvacanc/,
  },
  {
    label: "review/rating site",
    pattern: /\breview\s+(?:site|platform|portal)\b|\bratings?\b|\bcomparison\b/,
  },
  {
    label: "media/news/publication",
    pattern:
      /\bnews\b|\bmagazine\b|\bpublication\b|\bnewsroom\b|\bpress\s+release\b|\bmedia\s+(?:brand|outlet|publication|coverage)\b/,
  },
  {
    label: "blog/wiki/tutorial",
    pattern: /\bblog\b|\bwiki\b|\btutorial\b/,
  },
  {
    label: "educational site",
    pattern:
      /\bacademy\b|\buniversity\b|\bcollege\b|\bcourses?\b|\btraining\s+provider\b/,
  },
  {
    label: "forum/classifieds",
    pattern: /\bforum\b|\bclassifieds?\b/,
  },
  {
    label: "membership platform",
    pattern: /\bmembership\s+platform\b/,
  },
];

// A company that sells/implements business automation to others (a vendor or
// consultancy) is not a BOS buyer. Deliberately generic: no product names.
const VENDOR_SIGNALS = [
  {
    label: "automation/ERP vendor",
    pattern:
      /\b(?:we|our)\s+(?:provide|offer|sell|deliver|implement|build|develop)\b.*\b(?:erp|crm|automation|business\s+software|business\s+operating\s+system|workflow|rpa)\b/,
  },
  {
    label: "automation/ERP services provider",
    pattern:
      /\b(?:erp|crm|automation)\s+(?:solutions?|services?|provider|partner|consulting|consultancy|implementation)\b/,
  },
  {
    label: "implementation/consulting partner",
    pattern: /\b(?:implementation|consulting)\s+partner\b/,
  },
  {
    label: "staffing/recruiting firm",
    pattern:
      /\bstaff\s+augmentation\b|\brecruit(?:ment|ing)\b|\bstaffing\b/,
  },
  {
    label: "IT services firm",
    pattern: /\bit\s+services?\b|\bmanaged\s+services\b/,
  },
];

// Business-process surface area that a BOS / business automation could
// plausibly improve. Technology mentions (SAP/ERP/CRM/AI/automation/software)
// are deliberately NOT listed here.
const AUTOMATION_BENEFIT_SIGNALS = [
  { label: "manufacturing", pattern: /\bmanufactur/ },
  { label: "operations", pattern: /\boperations?\b/ },
  { label: "business processes", pattern: /\bprocess(?:es)?\b|\bworkflow/ },
  { label: "supply chain", pattern: /\bsupply\s+chain\b/ },
  { label: "logistics", pattern: /\blogistics\b/ },
  { label: "inventory", pattern: /\binventory\b/ },
  { label: "finance/accounting/payroll", pattern: /\bfinance\b|\baccounting\b|\bpayroll\b/ },
  { label: "HR/workforce", pattern: /\bhuman\s+resources\b|\bworkforce\b/ },
  { label: "field service", pattern: /\bfield\s+service\b/ },
  { label: "asset management", pattern: /\basset\b/ },
  { label: "production", pattern: /\bproduction\b/ },
  { label: "quality/compliance", pattern: /\bquality\b|\bcompliance\b/ },
  { label: "procurement", pattern: /\bprocurement\b/ },
  { label: "distribution/wholesale/retail", pattern: /\bdistribution\b|\bwholesale\b|\bretail\b/ },
  { label: "enterprise", pattern: /\ben(?:terprise|terprise)\b/ },
];

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

function offeringTechnologies(profile) {
  return (profile?.technology_signals || []).filter(
    (signal) =>
      signal &&
      (signal.relationship === "offers" ||
        signal.relationship === "implements"),
  );
}

export function evaluateIcp(profile) {
  const evidence = [];

  if (!profile?.company_name) {
    return {
      status: "review",
      reasons: ["missing company name"],
      evidence,
    };
  }

  const text = profileText(profile);

  const nonCompany = NON_COMPANY_SIGNALS.find((signal) =>
    signal.pattern.test(text),
  );

  if (nonCompany) {
    evidence.push(nonCompany.label);

    return {
      status: "not_qualified",
      reasons: ["not a real operating company"],
      evidence,
    };
  }

  const offerings = offeringTechnologies(profile);

  if (offerings.length) {
    evidence.push(
      `offers/implements: ${offerings
        .map((signal) => signal.technology)
        .join(", ")}`,
    );

    return {
      status: "not_qualified",
      reasons: ["sells business automation"],
      evidence,
    };
  }

  const vendor = VENDOR_SIGNALS.find((signal) =>
    signal.pattern.test(text),
  );

  if (vendor) {
    evidence.push(vendor.label);

    return {
      status: "not_qualified",
      reasons: ["service/technology vendor"],
      evidence,
    };
  }

  const benefit = AUTOMATION_BENEFIT_SIGNALS.find((signal) =>
    signal.pattern.test(text),
  );

  if (!benefit) {
    return {
      status: "review",
      reasons: ["no business-process operations detected"],
      evidence,
    };
  }

  evidence.push(benefit.label);

  return {
    status: "qualified",
    reasons: [],
    evidence,
  };
}
