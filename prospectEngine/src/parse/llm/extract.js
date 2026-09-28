import { getPrompt } from "../prompts.js";

import {
  computeCompanyConfidence,
} from "../company.js";

import {
  CompanySchema,
  COMPANY_JSON_SCHEMA,
} from "../../extraction/companyExtractor.js";

import {
  cacheKey,
  getCached,
  setCached,
} from "./cache.js";

export async function llmExtract({
  archetype,
  promptKey,
  markdown,
  url,
  contentHash,
  provider,
}) {
  if (!provider || provider.name === "disabled") {
    return {
      attempted: false,
      ok: false,
      confidence: null,
      payload: null,
      provider: provider?.name || "disabled",
      cached: false,
    };
  }

  const key = cacheKey({
    promptKey,
    archetype,
    contentHash,
  });

  const cached = getCached(key);

  if (cached) {
    return {
      attempted: true,
      ok: true,
      confidence: cached.confidence,
      payload: cached.payload,
      provider: cached.provider,
      cached: true,
    };
  }

  const prompt = getPrompt(promptKey, {
    url,
    markdown,
  });

  let result;

  try {
    result = await provider.complete({
      prompt,
      jsonSchema: COMPANY_JSON_SCHEMA,
      promptKey,
    });
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error.message,
      confidence: null,
      payload: null,
      provider: provider.name,
      cached: false,
    };
  }

  if (!result.attempted) {
    return {
      attempted: false,
      ok: false,
      confidence: null,
      payload: null,
      provider: provider.name,
      cached: false,
    };
  }

  if (!result.ok || !result.data) {
    return {
      attempted: true,
      ok: false,
      error: result.error,
      confidence: null,
      payload: null,
      provider: provider.name,
      cached: false,
    };
  }

  const payload = CompanySchema.parse(result.data);

  const confidence = computeCompanyConfidence(payload);

  setCached(key, {
    confidence,
    payload,
    provider: provider.name,
  });

  return {
    attempted: true,
    ok: true,
    confidence,
    payload,
    provider: provider.name,
    cached: false,
  };
}
