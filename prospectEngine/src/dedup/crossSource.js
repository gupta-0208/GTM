import {
  isRoleEmail,
  normalizeEmail,
  normalizePhone,
  splitName,
} from "../parse/contact.js";

import {
  nameKey,
} from "../lib/names.js";

const SOURCE_ORDER = ["website", "github", "mca"];

export { nameKey };

export function normalizeProfileUrl(url) {
  return String(url || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

function tokens(name) {
  return nameKey(name)
    .split(" ")
    .filter((token) => token.length >= 2);
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;

  if (!m) {
    return n;
  }

  if (!n) {
    return m;
  }

  const prev = Array.from({ length: n + 1 }, (_, j) => j);
  const curr = new Array(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;

    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
    }

    for (let j = 0; j <= n; j++) {
      prev[j] = curr[j];
    }
  }

  return prev[n];
}

// Non-exact similarity used only to surface a review candidate. Exact name
// matches are handled separately in comparePeople.
export function fuzzyNameMatch(a, b) {
  const na = nameKey(a);
  const nb = nameKey(b);

  if (!na || !nb) {
    return false;
  }

  if (na === nb) {
    return true;
  }

  const ta = tokens(a);
  const tb = tokens(b);

  if (ta.length >= 2 && tb.length >= 2) {
    const shorter = ta.length <= tb.length ? ta : tb;
    const longer = ta.length <= tb.length ? tb : ta;

    if (shorter.every((token) => longer.includes(token))) {
      return true;
    }
  }

  const distance = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);

  return maxLen > 0 && distance / maxLen <= 0.2;
}

const SAME = "same";
const REVIEW = "review";
const DISTINCT = "distinct";

function companyDomainFromUrl(url) {
  try {
    return new URL(url).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return null;
  }
}

function identityEmail(raw) {
  const email = normalizeEmail(raw);

  return email && !isRoleEmail(email) ? email : null;
}

function sharedProfileUrl(a, b) {
  if (!a.profile_urls?.length || !b.profile_urls?.length) {
    return false;
  }

  const set = new Set(
    a.profile_urls.map(normalizeProfileUrl)
  );

  return b.profile_urls.some((url) =>
    set.has(normalizeProfileUrl(url))
  );
}

// A phone is an identity key only when it is unique within its domain. Shared
// office lines appear on many people and must not force a merge.
function buildPhoneIdentity(people) {
  const byDomainPhone = new Map();

  for (const person of people) {
    const phone = normalizePhone(person?.phone);

    if (!phone) {
      continue;
    }

    const domain = person?.company_domain || "";
    const key = `${domain}::${phone}`;

    byDomainPhone.set(
      key,
      (byDomainPhone.get(key) || 0) + 1
    );
  }

  const identityPhones = new Set();

  for (const [key, count] of byDomainPhone) {
    if (count === 1) {
      identityPhones.add(key.split("::")[1]);
    }
  }

  return identityPhones;
}

export function comparePeople(a, b, ctx = {}) {
  // Never auto-merge across company domains, even on shared name/email.
  if (
    a?.company_domain &&
    b?.company_domain &&
    a.company_domain !== b.company_domain
  ) {
    return DISTINCT;
  }

  const aEmail = identityEmail(a?.email);
  const bEmail = identityEmail(b?.email);

  const aPhoneRaw = normalizePhone(a?.phone);
  const bPhoneRaw = normalizePhone(b?.phone);
  const aPhone =
    aPhoneRaw && ctx.phoneIdentity?.has(aPhoneRaw)
      ? aPhoneRaw
      : null;
  const bPhone =
    bPhoneRaw && ctx.phoneIdentity?.has(bPhoneRaw)
      ? bPhoneRaw
      : null;

  // Conflicting identifiers prove different people and block name merging.
  if (aEmail && bEmail && aEmail !== bEmail) {
    return DISTINCT;
  }

  if (aPhone && bPhone && aPhone !== bPhone) {
    return DISTINCT;
  }

  // 1. exact normalized email
  if (aEmail && bEmail) {
    return SAME;
  }

  // 2. exact normalized phone (only when unique in its domain)
  if (aPhone && bPhone) {
    return SAME;
  }

  // 3. strong source identity (shared profile URL)
  if (sharedProfileUrl(a, b)) {
    return SAME;
  }

  // 4. exact name + same company (scope is implied by the caller)
  if (
    a.name_key &&
    b.name_key &&
    a.name_key === b.name_key
  ) {
    return SAME;
  }

  if (fuzzyNameMatch(a?.name, b?.name)) {
    return REVIEW;
  }

  return DISTINCT;
}

export function personFromContact(contact) {
  const fullName = String(contact?.full_name || "").trim();
  const sourceUrls = contact?.source_urls?.length
    ? contact.source_urls
    : contact?.source_url
      ? [contact.source_url]
      : [];

  return {
    name: fullName,
    first_name: contact?.first_name || "",
    last_name: contact?.last_name || "",
    name_key: nameKey(fullName),
    email: normalizeEmail(contact?.email),
    phone: normalizePhone(contact?.phone),
    profile_urls: (contact?.profile_urls || [])
      .filter(Boolean)
      .map(normalizeProfileUrl),
    source_urls: sourceUrls,
    page_ids: contact?.page_ids || [],
    source_refs: sourceUrls,
    evidence: contact?.evidence || [],
    titles: contact?.title ? [contact.title] : [],
    role_category: contact?.role_category || null,
    sources: ["website"],
    company_domain: sourceUrls.length
      ? companyDomainFromUrl(sourceUrls[0])
      : null,
    confidence: contact?.confidence ?? 0,
  };
}

export function personFromGithubMember(
  member,
  { organization = null, confidence = 0 } = {}
) {
  const login = member?.login || "";
  const htmlUrl =
    member?.html_url ||
    (login ? `https://github.com/${login}` : "");
  const name = String(member?.name || login || "").trim();

  const refs = [];

  if (login) {
    refs.push(`github:${login}`);
  }

  if (organization?.login) {
    refs.push(`github:org:${organization.login}`);
  }

  return {
    name,
    first_name: "",
    last_name: "",
    name_key: nameKey(name),
    email: null,
    phone: null,
    profile_urls: htmlUrl ? [normalizeProfileUrl(htmlUrl)] : [],
    source_urls: htmlUrl ? [htmlUrl] : [],
    page_ids: [],
    source_refs: refs,
    evidence: [],
    titles: [],
    role_category: null,
    sources: ["github"],
    company_domain: null,
    confidence: confidence ?? 0,
  };
}

export function personFromMcaDirector(
  director,
  { company = null, confidence = 0 } = {}
) {
  const name = String(director?.name || "").trim();

  const refs = [];

  if (director?.din) {
    refs.push(`mca:din:${director.din}`);
  }

  if (company?.cin) {
    refs.push(`mca:cin:${company.cin}`);
  }

  return {
    name,
    first_name: "",
    last_name: "",
    name_key: nameKey(name),
    email: null,
    phone: null,
    profile_urls: [],
    source_urls: [],
    page_ids: [],
    source_refs: refs,
    evidence: [],
    titles: director?.designation ? [director.designation] : [],
    role_category: null,
    sources: ["mca"],
    company_domain: null,
    confidence: confidence ?? 0,
  };
}

function pickName(group) {
  return [...group]
    .sort((a, b) => {
      const scoreA =
        (a.email ? 4 : 0) +
        (a.titles?.length ? 2 : 0) +
        tokens(a.name).length;

      const scoreB =
        (b.email ? 4 : 0) +
        (b.titles?.length ? 2 : 0) +
        tokens(b.name).length;

      return scoreB - scoreA;
    })[0]?.name || "";
}

export function mergePeople(group) {
  const people = group.filter(Boolean);

  const name = pickName(people);
  const { first_name, last_name } = splitName(name);

  const merged = {
    name,
    first_name,
    last_name,
    name_key: nameKey(name),
    email: null,
    phone: null,
    profile_urls: [],
    source_urls: [],
    page_ids: [],
    source_refs: [],
    evidence: [],
    titles: [],
    role_category: null,
    sources: new Set(),
    confidence: 0,
  };

  for (const person of people) {
    merged.email ||= person.email || null;
    merged.phone ||= person.phone || null;
    merged.role_category ||= person.role_category || null;
    merged.profile_urls.push(...(person.profile_urls || []));
    merged.source_urls.push(...(person.source_urls || []));
    merged.page_ids.push(...(person.page_ids || []));
    merged.source_refs.push(...(person.source_refs || []));
    merged.evidence.push(...(person.evidence || []));
    merged.titles.push(...(person.titles || []));

    for (const source of person.sources || []) {
      merged.sources.add(source);
    }

    merged.confidence = Math.max(
      merged.confidence,
      person.confidence ?? 0
    );
  }

  merged.profile_urls = [...new Set(merged.profile_urls)];
  merged.source_urls = [...new Set(merged.source_urls)];
  merged.page_ids = [...new Set(merged.page_ids)];
  merged.source_refs = [...new Set(merged.source_refs)];
  merged.evidence = [...new Set(merged.evidence)];
  merged.titles = [...new Set(merged.titles)];
  merged.sources = SOURCE_ORDER.filter(
    (source) => merged.sources.has(source)
  );

  return merged;
}

function splitByConflicts(members, ctx) {
  const groups = [];

  for (const member of members) {
    let placed = false;

    for (const group of groups) {
      const conflict = group.some(
        (existing) =>
          comparePeople(member, existing, ctx) === DISTINCT
      );

      if (!conflict) {
        group.push(member);
        placed = true;
        break;
      }
    }

    if (!placed) {
      groups.push([member]);
    }
  }

  return groups;
}

// Cross-source dedupe with transitive (union-find) merging. Strong identity
// matches (email, unique phone, profile URL, exact name) collapse into one
// person; fuzzy name similarity only surfaces a review candidate; conflicting
// identifiers and company-domain boundaries are never crossed.
export function dedupePeople(people) {
  const list = (people || []).filter(Boolean);
  const n = list.length;

  if (!n) {
    return { merged: [], review: [] };
  }

  const ctx = {
    phoneIdentity: buildPhoneIdentity(list),
  };

  const parent = Array.from({ length: n }, (_, i) => i);

  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }

    return x;
  };

  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);

    if (ra !== rb) {
      parent[rb] = ra;
    }
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (comparePeople(list[i], list[j], ctx) === SAME) {
        union(i, j);
      }
    }
  }

  const components = new Map();

  for (let i = 0; i < n; i++) {
    const root = find(i);

    if (!components.has(root)) {
      components.set(root, []);
    }

    components.get(root).push(list[i]);
  }

  const mergedGroups = [];

  for (const members of components.values()) {
    mergedGroups.push(...splitByConflicts(members, ctx));
  }

  const review = [];

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (comparePeople(list[i], list[j], ctx) === REVIEW) {
        review.push({
          reason: "fuzzy-name",
          members: [list[i], list[j]],
        });
      }
    }
  }

  return {
    merged: mergedGroups.map((group) => mergePeople(group)),
    review,
  };
}
