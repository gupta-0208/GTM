const NON_COMPANY_PATTERNS = [
  /\bdirectory\b/i,
  /\baggregator\b/i,
  /\bmarketplace\b/i,
  /\blisticle\b/i,
  /\bjob\s*board\b/i,
  /\breview\s+(?:site|platform|portal)\b/i,
  /\bnews(?:room)?\b/i,
  /\bmagazine\b/i,
  /\bpublication\b/i,
  /\bblog\b/i,
  /\bwiki\b/i,
  /\btutorial\b/i,
  /\buniversity\b/i,
  /\bcollege\b/i,
  /\bacademy\b/i,
  /\bforum\b/i,
  /\bclassifieds?\b/i,
];

const CORE_BUSINESS_PATTERNS = [
  {
    label: "B2B SaaS/software",
    pattern:
      /\b(?:b2b\s+)?saas\b|\bsoftware\s+(?:company|platform|firm)\b/i,
  },
  {
    label: "agency",
    pattern: /\bagency\b|\bagencies\b/i,
  },
  {
    label: "consulting",
    pattern: /\bconsult(?:ing|ant|ancy)\b/i,
  },
  {
    label: "professional services",
    pattern: /\bprofessional\s+services?\b/i,
  },
  {
    label: "coaching",
    pattern: /\bcoach(?:ing)?\b/i,
  },
  {
    label: "IT/software services",
    pattern: /\bit\s+services?\b|\bsoftware\s+services?\b/i,
  },
  {
    label: "recruitment",
    pattern: /\brecruit(?:ment|ing)\b|\bstaffing\b/i,
  },
  {
    label: "marketing services",
    pattern: /\bmarketing\s+(?:agency|firm|services?)\b/i,
  },
];

const FOUNDER_EXPERT_PATTERNS = [
  {
    label: "founder-led",
    pattern: /\bfounder\b|\bco[- ]founder\b|\bceo\b|\bowner\b/i,
  },
  {
    label: "expert-led",
    pattern:
      /\bconsultant\b|\bcoach\b|\bfractional\b|\badvisor\b/i,
  },
];

function profileText(profile) {
  return [
    profile?.company_name,
    profile?.description,
    profile?.company_description,
    profile?.industry,
    ...(profile?.industries || []),
    profile?.business_type,
    profile?.company_type,
    profile?.services,
    ...(profile?.products_services || []),
    profile?.products,
    profile?.title,
    profile?.snippet,
    profile?.location,
    profile?.country,
    profile?.city,
  ]
    .filter(Boolean)
    .map((value) => String(value))
    .join(" ");
}

export const LINKASSIST_ICP = {
  name: "LinkAssist",

  geography: ["India"],

  company_types: [
    "B2B SaaS",
    "software companies",
    "marketing agencies",
    "consulting firms",
    "recruitment agencies",
    "business coaches",
    "financial consultancies",
    "legal consultancies",
    "architecture firms",
    "IT services companies",
    "B2B professional services",
  ],

  buyer_roles: [
    "Founder",
    "Co-Founder",
    "CEO",
    "Owner",
    "Consultant",
    "Coach",
    "Agency Owner",
    "Senior B2B Professional",
  ],

  company_size: {
    min: 1,
    max: 50,
  },

  discovery_terms: [
    "B2B SaaS",
    "software",
    "agency",
    "marketing agency",
    "AI agency",
    "consulting",
    "business consultant",
    "business coach",
    "professional services",
    "IT services",
    "software services",
    "recruitment",
    "staffing",
  ],
};

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

  const nonCompany = NON_COMPANY_PATTERNS.find((pattern) =>
    pattern.test(text),
  );

  if (nonCompany) {
    return {
      status: "not_qualified",
      reasons: ["not a real operating company"],
      evidence: ["non-company signal detected"],
    };
  }

  const businessMatches =
    CORE_BUSINESS_PATTERNS.filter(({ pattern }) =>
      pattern.test(text),
    );

  const founderMatches =
    FOUNDER_EXPERT_PATTERNS.filter(({ pattern }) =>
      pattern.test(text),
    );

  for (const match of businessMatches) {
    evidence.push(`business fit: ${match.label}`);
  }

  for (const match of founderMatches) {
    evidence.push(`buyer/company signal: ${match.label}`);
  }

  if (!businessMatches.length) {
    return {
      status: "review",
      reasons: ["no LinkAssist target business type detected"],
      evidence,
    };
  }

  return {
    status: "qualified",
    reasons: [],
    evidence,
  };
}
