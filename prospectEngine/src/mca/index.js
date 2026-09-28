import { config } from "../config.js";

import {
  createMcaClient,
} from "./client.js";

import {
  matchMcaCompany,
} from "./match.js";

import {
  insertRawRecord,
} from "../storage/pgStore.js";

const MCA_ACCEPT_THRESHOLD = 0.8;
const MCA_MIN_THRESHOLD = 0.6;

function observedAt() {
  return new Date().toISOString();
}

function sourceRefOf(entity) {
  return entity.source_ref ||
    (entity.cin ? `MCA:${entity.cin}` : "MCA");
}

function buildPayload(entity, { directors = true } = {}) {
  return {
    legal_name: entity.company_name || "",
    cin: entity.cin || "",
    status: entity.status || "",
    registration_date: entity.registration_date || null,
    directors: directors
      ? (entity.directors || []).map((director) => ({
          din: director.din || "",
          name: director.name || "",
          designation: director.designation || "",
          appointment_date: director.appointment_date || null,
        }))
      : [],
    source_ref: sourceRefOf(entity),
    observed_at: observedAt(),
  };
}

export async function enrichCompanyMca({
  companyName = "",
  domain = "",
  cin = "",
  client,
  persist = true,
} = {}) {
  const mca = client ?? createMcaClient(config);

  // A supplied CIN is an exact identity lookup.
  if (cin) {
    const detail = await mca.getCompany(cin);

    if (!detail) {
      return {
        matched: false,
        accepted: false,
        confidence: 0,
        status: "review",
        reason: "cin-not-found",
      };
    }

    const score = matchMcaCompany({
      candidate: detail,
      companyName,
      cin,
      domain,
    });

    const status = score >= MCA_ACCEPT_THRESHOLD
      ? "pending"
      : "review";

    const record = persist
      ? await insertRawRecord({
          source_type: "mca",
          source_ref: sourceRefOf(detail),
          record_type: "mca",
          payload: buildPayload(detail),
          confidence: score,
          status,
        })
      : null;

    return {
      matched: true,
      accepted: status === "pending",
      confidence: score,
      status,
      reason: "cin-match",
      detail,
      record,
    };
  }

  const candidates = await mca.searchCompany(companyName);

  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: matchMcaCompany({ candidate, companyName, domain }),
    }))
    .filter((item) => item.score >= MCA_MIN_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];

  if (!best) {
    return {
      matched: false,
      accepted: false,
      confidence: 0,
      status: "review",
      reason: "no-mca-match",
    };
  }

  // Weak match -> review with the candidate identity only; no directors are
  // fetched or asserted until a human confirms the match.
  if (best.score < MCA_ACCEPT_THRESHOLD) {
    const record = persist
      ? await insertRawRecord({
          source_type: "mca",
          source_ref: sourceRefOf(best.candidate),
          record_type: "mca",
          payload: buildPayload(best.candidate, { directors: false }),
          confidence: best.score,
          status: "review",
        })
      : null;

    return {
      matched: true,
      accepted: false,
      confidence: best.score,
      status: "review",
      reason: "weak-match",
      candidate: best.candidate,
      record,
    };
  }

  const detail = await mca.getCompany(best.candidate.cin);

  const entity = detail ?? best.candidate;

  const score = matchMcaCompany({
    candidate: entity,
    companyName,
    domain,
  });

  const record = persist
    ? await insertRawRecord({
        source_type: "mca",
        source_ref: sourceRefOf(entity),
        record_type: "mca",
        payload: buildPayload(entity),
        confidence: score,
        status: "pending",
      })
    : null;

  return {
    matched: true,
    accepted: true,
    confidence: score,
    status: "pending",
    detail: entity,
    record,
  };
}
