import { load } from "cheerio";

export const ARCHETYPES = [
  "team_page",
  "careers_page",
  "job_posting",
  "contact_page",
  "about_page",
  "pricing_page",
  "blog_post",
  "press_release",
  "homepage",
];

const CONTACT_ARCHETYPES = new Set([
  "team_page",
  "careers_page",
  "job_posting",
  "contact_page",
]);

// Archetypes that may contain named people and are therefore eligible for
// contact extraction (team/leadership/founders map to team_page; about and
// blog/press pages can carry founders, authors and press contacts).
const CONTACT_SOURCE_ARCHETYPES = new Set([
  "team_page",
  "contact_page",
  "about_page",
  "blog_post",
  "press_release",
]);

const RULES = [
  {
    archetype: "job_posting",
    url: [
      /\/(job|jobs|careers?|position|opening|vacanc(y|ies))\/[^/?]+/i,
    ],
    text: [
      /\b(apply now|job title|job description|key responsibilities|qualifications)\b/i,
    ],
  },
  {
    archetype: "careers_page",
    url: [
      /\/(careers?|jobs?|join-us|work-with-us|openings?|vacancies?)\/?$/i,
    ],
    text: [
      /\b(careers|join our team|open positions|current openings|we are hiring|we're hiring)\b/i,
    ],
  },
  {
    archetype: "contact_page",
    url: [
      /\/(contact|contact-us|get-in-touch|reach-us|connect|contacting)\/?$/i,
    ],
    text: [
      /\b(contact us|get in touch|reach out|contact our team|send us a message)\b/i,
    ],
  },
  {
    archetype: "team_page",
    url: [
      /\/(team|people|leadership|our-team|founders?|management|executives?)\/?$/i,
      /\b(our-people|meet-the-team|our-team|leadership-team|executive-team|management-team|founding-team)\b/i,
    ],
    text: [
      /\b(our team|meet the team|leadership team|our people|management team|our founders)\b/i,
    ],
  },
  {
    archetype: "pricing_page",
    url: [
      /\/(pricing|plans?|price)\/?$/i,
    ],
    text: [
      /\b(pricing|plans & pricing|our plans|packages|pricing plans)\b/i,
    ],
  },
  {
    archetype: "about_page",
    url: [
      /\/(about|about-us|company|who-we-are|our-story|overview)\/?$/i,
    ],
    text: [
      /\b(about us|who we are|our story|our company|about the company)\b/i,
    ],
  },
  {
    archetype: "press_release",
    url: [
      /\/(press|press-releases?|media|newsroom)\//i,
      /\/(press|press-releases?|media|newsroom)\/?$/i,
    ],
    text: [
      /\b(press release|for immediate release|media contact|newsroom)\b/i,
    ],
  },
  {
    archetype: "blog_post",
    url: [
      /\/(blog|articles?|news|insights?|post)\/[^/?]+/i,
    ],
    text: [
      /\b(published on|posted on|by [a-z0-9 ]+ \||author:)\b/i,
    ],
  },
];

function scoreRule(rule, lowerUrl, lowerText) {
  let score = 0;

  for (const pattern of rule.url) {
    if (pattern.test(lowerUrl)) {
      score += 2;
    }
  }

  for (const pattern of rule.text) {
    if (pattern.test(lowerText)) {
      score += 1;
    }
  }

  return score;
}

export function classify(html, url) {
  const $ = load(html || "");

  const title = $("title").first().text();
  const h1 = $("h1").first().text();

  const text = `${title} ${h1}`
    .replace(/\s+/g, " ")
    .trim();

  const lowerUrl = String(url || "").toLowerCase();
  const lowerText = text.toLowerCase();

  let best = "homepage";
  let bestScore = 0;

  for (const rule of RULES) {
    const score = scoreRule(rule, lowerUrl, lowerText);

    if (score > bestScore) {
      bestScore = score;
      best = rule.archetype;
    }
  }

  return best;
}

export function isContactArchetype(archetype) {
  return CONTACT_ARCHETYPES.has(archetype);
}

export function isContactSourceArchetype(archetype) {
  return CONTACT_SOURCE_ARCHETYPES.has(archetype);
}

export function recordTypeFor(archetype) {
  return isContactArchetype(archetype)
    ? "contact"
    : "company";
}
