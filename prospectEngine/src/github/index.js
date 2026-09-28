import { config } from "../config.js";

import {
  createGithubClient,
} from "./client.js";

import {
  domainStem,
  matchOrganization,
  deriveTechnologyHints,
} from "./match.js";

import {
  insertRawRecord,
} from "../storage/pgStore.js";

const GITHUB_ACCEPT_THRESHOLD = 0.8;
const GITHUB_MIN_THRESHOLD = 0.6;

function buildOrgQueries({ companyName = "", domain = "" }) {
  const queries = [];
  const name = String(companyName || "").trim();

  if (name) {
    queries.push(name);
  }

  const stem = domainStem(domain);

  if (stem && !queries.includes(stem)) {
    queries.push(stem);
  }

  return queries;
}

function summarizeOrganization(org) {
  return {
    login: org?.login || "",
    name: org?.name || "",
    html_url: org?.html_url || "",
    description: org?.description || "",
  };
}

export async function searchOrganizationCandidates(
  github,
  { companyName, domain }
) {
  const seen = new Map();

  for (const query of buildOrgQueries({ companyName, domain })) {
    const items = await github.searchOrganizations(query);

    for (const org of items || []) {
      if (org?.login && !seen.has(org.login)) {
        seen.set(org.login, org);
      }
    }
  }

  return [...seen.values()];
}

export async function enrichCompanyGithub({
  companyName = "",
  domain = "",
  client,
  persist = true,
} = {}) {
  const github = client ?? createGithubClient(config);

  const orgs = await searchOrganizationCandidates(github, {
    companyName,
    domain,
  });

  const scored = orgs
    .map((org) => ({
      org,
      score: matchOrganization({ org, companyName, domain }),
    }))
    .filter((candidate) => candidate.score >= GITHUB_MIN_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];

  if (!best) {
    return {
      matched: false,
      accepted: false,
      confidence: 0,
      status: "review",
      reason: "no-organization-match",
    };
  }

  const source_ref =
    best.org.html_url ||
    `https://github.com/${best.org.login}`;

  if (best.score < GITHUB_ACCEPT_THRESHOLD) {
    const payload = {
      organization: summarizeOrganization(best.org),
      public_members: [],
      repositories: [],
      technology_hints: { languages: [], topics: [] },
    };

    let record = null;

    if (persist) {
      record = await insertRawRecord({
        source_type: "github",
        source_ref,
        record_type: "github",
        payload,
        confidence: best.score,
        status: "review",
      });
    }

    return {
      matched: true,
      accepted: false,
      confidence: best.score,
      status: "review",
      reason: "weak-match",
      org: best.org,
      record,
    };
  }

  const [members, repositories] = await Promise.all([
    github.listPublicMembers(best.org.login),
    github.listRepositories(best.org.login),
  ]);

  const technology_hints = deriveTechnologyHints(repositories);

  const payload = {
    organization: summarizeOrganization(best.org),

    public_members: (members || []).map((member) => ({
      login: member.login,
      html_url: member.html_url || "",
      avatar_url: member.avatar_url || "",
    })),

    repositories: (repositories || []).map((repo) => ({
      name: repo.name,
      full_name: repo.full_name || "",
      html_url: repo.html_url || "",
      description: repo.description || "",
      language: repo.language || "",
      topics: repo.topics || [],
      stargazers_count: repo.stargazers_count ?? null,
    })),

    technology_hints,
  };

  let record = null;

  if (persist) {
    record = await insertRawRecord({
      source_type: "github",
      source_ref,
      record_type: "github",
      payload,
      confidence: best.score,
      status: "pending",
    });
  }

  return {
    matched: true,
    accepted: true,
    confidence: best.score,
    status: "pending",
    org: best.org,
    members,
    repositories,
    technologyHints: technology_hints,
    record,
  };
}
