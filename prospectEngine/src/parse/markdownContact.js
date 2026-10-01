import {
  dedupeContacts,
  isRoleEmail,
  normalizeContact,
  parseNameTitleLine,
} from "./contact.js";

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RE = /(?:\+?[0-9][0-9\s().-]{6,}[0-9])/;

const NAV_LINE_RE =
  /^(home|about|about us|contact|contact us|team|our team|careers|jobs|services|products|solutions|pricing|menu|news|blog|privacy|terms|faq|faqs|login|sign in|sign up|register|support|help|next|previous|back|read more|learn more|view all|follow us)$/i;

function isNavHeavyLine(line) {
  if (NAV_LINE_RE.test(line)) {
    return true;
  }

  // Nav bars collapse into many links on a single line in clean markdown.
  const linkCount = (line.match(/\[[^\]]*\]\([^)]*\)/g) || []).length;

  if (linkCount >= 2) {
    return true;
  }

  const single = line.match(/^\[([^\]]*)\]\([^)]*\)$/);

  if (single && NAV_LINE_RE.test(single[1].trim())) {
    return true;
  }

  return false;
}

function isYearRange(text) {
  const value = String(text || "").trim();

  return /^(19|20)\d{2}\s*[-–—]\s*(19|20)\d{2}$/.test(value);
}

export function markdownContactExtract(archetype, markdown, url) {
  const candidates = [];

  for (const rawLine of String(markdown || "").split("\n")) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    if (isNavHeavyLine(line)) {
      continue;
    }

    let email = line.match(EMAIL_RE)?.[0] || "";
    let phone = line.match(PHONE_RE)?.[0] || "";

    if (isYearRange(phone)) {
      phone = "";
    }

    const nameTitle = parseNameTitleLine(line);

    // Name-less email/phone entries are not people, and role mailboxes never
    // create people, so a person requires a parsed "name — title" line.
    if (!nameTitle) {
      continue;
    }

    if (isRoleEmail(email)) {
      email = "";
    }

    candidates.push({
      full_name: nameTitle.name,
      title: nameTitle.title,
      email,
      phone,
      profile_urls: [],
      source_url: url,
    });
  }

  return dedupeContacts(
    candidates.map((c) => normalizeContact(c)),
  ).filter((c) => c.full_name || c.email || c.phone);
}
