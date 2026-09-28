const LEGAL_SUFFIX =
  /\b(private limited|private ltd|pvt\.?\s*ltd\.?|opc private limited|limited|llp|ltd\.?)\b/gi;

export function slugify(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function domainStem(value) {
  const host = String(value || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];

  return host.replace(/\.[a-z]{2,}$/i, "");
}

// Legal name stripped of company-type suffixes ("PVT LTD", "LLP", ...) so
// "Acme Solar Private Limited" and "Acme Solar" compare equal.
export function legalNameKey(value) {
  return slugify(
    String(value || "").replace(LEGAL_SUFFIX, "")
  );
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((token) => token.length >= 3);
}

// Deterministic company <-> MCA match score in [0, 1]. Exact CIN and exact
// legal-name key reach the accept band; token/substring overlap lands in the
// review band so a weak match is never silently promoted.
export function matchMcaCompany({
  candidate,
  companyName = "",
  cin = "",
  domain = "",
}) {
  const candName = candidate?.company_name ?? "";
  const candCin = candidate?.cin ?? "";

  let score = 0;

  if (
    cin &&
    candCin &&
    cin.toLowerCase() === candCin.toLowerCase()
  ) {
    score = Math.max(score, 0.95);
  }

  const nameKey = legalNameKey(companyName);
  const candKey = legalNameKey(candName);

  if (nameKey && candKey && nameKey === candKey) {
    score = Math.max(score, 0.9);
  } else if (
    nameKey.length >= 4 &&
    candKey &&
    (nameKey.includes(candKey) || candKey.includes(nameKey))
  ) {
    score = Math.max(score, 0.7);
  }

  const stem = slugify(domainStem(domain));

  if (stem && candKey.includes(stem)) {
    score = Math.max(score, 0.7);
  }

  const nameTokens = tokenize(companyName);
  const candTokens = tokenize(candName);
  const overlap = nameTokens.filter(
    (token) => candTokens.includes(token)
  ).length;

  if (
    nameTokens.length &&
    overlap >= Math.min(2, nameTokens.length)
  ) {
    score = Math.max(score, 0.5 + overlap * 0.1);
  }

  return Math.round(Math.min(1, score) * 100) / 100;
}
