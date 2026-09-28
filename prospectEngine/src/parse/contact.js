const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

// Signals that a text fragment reads like a job title. Used both to bucket
// roles and to decide whether a "name — title" split is actually a title.
export const ROLE_HINT =
  /\b(ceo|cto|cfo|coo|cmo|cro|cio|founder|co[- ]?founder|president|vice president|director|manager|lead|head|chief|engineer|developer|marketing|sales|operations|revenue|growth|product|design|analyst|specialist|consultant|partner|principal|chair|executive|officer|communications|finance|people|legal|counsel|human resources)\b/i;

// Ordered most-specific-first so "co-founder" beats "founder" and a named
// C-level ("CEO") beats the generic "executive" bucket.
const ROLE_RULES = [
  ["cofounder", /\bco[- ]?founder\b/i],
  ["founder", /\bfounder\b|\bfounding\b/i],
  ["ceo", /\bceo\b|chief executive/i],
  ["technology_leader", /\bcto\b|chief technology|cio\b|chief information|engineering|engineer|software|technical|vp engineering|head of engineering/i],
  ["marketing_leader", /\bcmo\b|chief marketing|\bmarketing\b|brand|communications|public relations|growth marketing/i],
  ["revenue_leader", /\bcro\b|chief revenue|\brevenue\b|\bcommercial\b|chief growth|\bgrowth\b/i],
  ["sales_leader", /\bsales\b|business development|account executive|account manager|partnerships/i],
  ["operations_leader", /\bcoo\b|chief operating|\boperations\b|\bpeople\b|human resources|\bhr\b|\bfinance\b|cfo\b|chief financial|\blegal\b|\bcounsel\b|customer success|\bsupport\b|\boffice\b|\badministration\b/i],
  ["executive", /\bpresident\b|vice president|\bvp\b|chief|director|managing director|chair|board|\bpartner\b|\bprincipal\b|general manager|head of|\bexecutive\b|\bsvp\b|\bevp\b|\bsme\b|\bleader\b/i],
];

export function normalizeRole(title) {
  const text = String(title || "").trim();

  if (!text) {
    return null;
  }

  const lower = text.toLowerCase();

  for (const [category, pattern] of ROLE_RULES) {
    if (pattern.test(lower)) {
      return category;
    }
  }

  return "other";
}

export function normalizeEmail(raw) {
  const value = String(raw || "").trim().toLowerCase();

  return EMAIL_RE.test(value) ? value : null;
}

export function normalizePhone(raw) {
  const digits = String(raw || "").replace(/[^0-9+]/g, "");

  return digits.length >= 7 ? digits : null;
}

export function splitName(full) {
  const name = String(full || "").replace(/\s+/g, " ").trim();

  if (!name) {
    return { first_name: "", last_name: "" };
  }

  if (name.includes(",")) {
    const [last, first] = name.split(",").map((s) => s.trim());

    return {
      first_name: first || "",
      last_name: last || "",
    };
  }

  const parts = name.split(" ");

  if (parts.length === 1) {
    return { first_name: parts[0], last_name: "" };
  }

  return {
    first_name: parts.slice(0, -1).join(" "),
    last_name: parts[parts.length - 1],
  };
}

export function parseNameTitleLine(line) {
  const cleaned = String(line || "")
    .replace(/^[#>*\s•·-]+/, "")
    .trim();

  if (!cleaned) {
    return null;
  }

  const parts = cleaned.split(
    /\s+\|\s+|\s+[–—]\s+|\s*,\s*/
  );

  if (parts.length < 2) {
    return null;
  }

  const name = parts[0].trim();
  const title = parts.slice(1).join(" ").trim();

  if (!name || !title || !ROLE_HINT.test(title)) {
    return null;
  }

  return { name, title };
}

export function computeContactConfidence(contact) {
  if (!contact) {
    return 0;
  }

  let score = 0;

  if (contact.full_name) {
    score += 0.35;
  }

  if (contact.email) {
    score += 0.25;
  }

  if (contact.phone) {
    score += 0.2;
  }

  if (contact.title) {
    score += 0.2;
  }

  return Math.round(Math.min(1, score) * 100) / 100;
}

export function normalizeContact({
  full_name = "",
  title = "",
  email = "",
  phone = "",
  profile_urls = [],
  source_url = "",
  page_id = null,
  evidence = [],
}) {
  const { first_name, last_name } = splitName(full_name);

  const contact = {
    full_name: String(full_name || "").trim(),
    first_name,
    last_name,
    title: String(title || "").trim(),
    role_category: normalizeRole(title),
    email: normalizeEmail(email),
    phone: normalizePhone(phone),
    profile_urls: [...new Set((profile_urls || []).filter(Boolean))],
    source_url: String(source_url || ""),
    source_urls: [...new Set([String(source_url || "")].filter(Boolean))],
    page_ids: page_id ? [page_id] : [],
    evidence: [...new Set((evidence || []).filter(Boolean))],
  };

  contact.confidence = computeContactConfidence(contact);

  return contact;
}

function groupMatches(group, contact) {
  return group.some(
    (member) =>
      (member.email && contact.email && member.email === contact.email) ||
      (member.phone && contact.phone && member.phone === contact.phone) ||
      (member.full_name && contact.full_name &&
        member.full_name.toLowerCase() === contact.full_name.toLowerCase()) ||
      (member.profile_urls.length && contact.profile_urls.length &&
        member.profile_urls.some((u) => contact.profile_urls.includes(u)))
  );
}

function pickBest(group) {
  return [...group].sort(
    (a, b) =>
      (b.confidence ?? 0) - (a.confidence ?? 0) ||
      Number(Boolean(b.full_name)) - Number(Boolean(a.full_name))
  )[0];
}

function mergeGroup(group) {
  const base = { ...pickBest(group) };

  const source_urls = [];
  const page_ids = [];
  const evidence = [];
  const profile_urls = [];

  for (const contact of group) {
    source_urls.push(...(contact.source_urls || []).filter(Boolean));
    page_ids.push(...(contact.page_ids || []));
    evidence.push(...(contact.evidence || []));
    profile_urls.push(...(contact.profile_urls || []));

    base.full_name ||= contact.full_name;
    base.first_name ||= contact.first_name;
    base.last_name ||= contact.last_name;
    base.title ||= contact.title;
    base.role_category ||= contact.role_category;
    base.email ||= contact.email;
    base.phone ||= contact.phone;
  }

  base.source_urls = [...new Set(source_urls)];
  base.page_ids = [...new Set(page_ids)];
  base.evidence = [...new Set(evidence)];
  base.profile_urls = [...new Set(profile_urls)];
  base.confidence = computeContactConfidence(base);

  return base;
}

// Deduplicates contacts within one company, preferring identity matches in
// order: email, phone, name, then profile URL. Weak/fuzzy matches are NOT
// merged here — only exact key matches collapse into a single contact.
export function dedupeContacts(contacts) {
  const groups = [];

  for (const contact of contacts) {
    const group = groups.find((g) => groupMatches(g, contact));

    if (group) {
      group.push(contact);
    } else {
      groups.push([contact]);
    }
  }

  return groups.map(mergeGroup);
}

export function contactPayload(contact) {
  return {
    full_name: contact.full_name,
    first_name: contact.first_name,
    last_name: contact.last_name,
    title: contact.title,
    role_category: contact.role_category,
    email: contact.email,
    phone: contact.phone,
    profile_urls: contact.profile_urls,
    source_url: contact.source_url || contact.source_urls?.[0] || "",
    source_urls: contact.source_urls || [],
    page_ids: contact.page_ids || [],
    evidence: contact.evidence || [],
  };
}
