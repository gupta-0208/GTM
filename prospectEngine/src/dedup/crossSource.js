import {
  normalizeEmail,
  normalizePhone,
  splitName,
} from "../parse/contact.js";

const SOURCE_ORDER = ["website", "github", "mca"];

export function nameKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeProfileUrl(url) {
  return String(url || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
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

function sharedProfileUrl(a, b) {
  if (!a.profile_urls?.length || !b.profile_urls?.length) {
    return false;
  }

  const set = new Set(a.profile_urls);

  return b.profile_urls.some((url) => set.has(url));
}

export function comparePeople(a, b) {
  const aEmail = normalizeEmail(a?.email);
  const bEmail = normalizeEmail(b?.email);
  const aPhone = normalizePhone(a?.phone);
  const bPhone = normalizePhone(b?.phone);

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

  // 2. exact normalized phone
  if (aPhone && bPhone) {
    return SAME;
  }

  // 4. strong source identity (shared profile URL)
  if (sharedProfileUrl(a, b)) {
    return SAME;
  }

  // 3. exact name + same company (scope is implied by the caller)
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

// Cross-source dedupe: strong identity matches (email, phone, profile URL,
// exact name) collapse into a single person; fuzzy name similarity only
// surfaces a review candidate and never auto-merges.
export function dedupePeople(people) {
  const list = (people || []).filter(Boolean);
  const groups = [];

  for (const person of list) {
    const mergeTargets = [];

    for (const group of groups) {
      let same = false;
      let distinct = false;

      for (const member of group) {
        const verdict = comparePeople(member, person);

        if (verdict === SAME) {
          same = true;
        } else if (verdict === DISTINCT) {
          distinct = true;
        }
      }

      if (same && !distinct) {
        mergeTargets.push(group);
      }
    }

    if (mergeTargets.length) {
      const mergedGroup = [
        person,
        ...mergeTargets.flat(),
      ];

      for (const group of mergeTargets) {
        groups.splice(groups.indexOf(group), 1);
      }

      groups.push(mergedGroup);
    } else {
      groups.push([person]);
    }
  }

  const review = [];

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (comparePeople(list[i], list[j]) === REVIEW) {
        review.push({
          reason: "fuzzy-name",
          members: [list[i], list[j]],
        });
      }
    }
  }

  return {
    merged: groups.map((group) => mergePeople(group)),
    review,
  };
}
