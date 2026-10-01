import { LINKASSIST_ICP } from "../icp/linkassist.js";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

import { config } from "../config.js";

const SearchPlanSchema = z.object({
  target_description: z.string(),
  location: z.string(),
  industry: z.string(),
  company_type: z.string(),
  product_or_technology: z.string(),

  relationship: z.enum([
    "uses",
    "needs",
    "sells",
    "offers",
    "implements",
    "related_to",
    "unknown",
  ]),

  search_queries: z
    .array(z.string())
    .min(3)
    .max(10),
});

const SEARCH_PLAN_JSON_SCHEMA = {
  type: "object",

  properties: {
    target_description: {
      type: "string",
    },

    location: {
      type: "string",
    },

    industry: {
      type: "string",
    },

    company_type: {
      type: "string",
    },

    product_or_technology: {
      type: "string",
    },

    relationship: {
      type: "string",

      enum: [
        "uses",
        "needs",
        "sells",
        "offers",
        "implements",
        "related_to",
        "unknown",
      ],
    },

    search_queries: {
      type: "array",

      items: {
        type: "string",
      },
    },
  },

  required: [
    "target_description",
    "location",
    "industry",
    "company_type",
    "product_or_technology",
    "relationship",
    "search_queries",
  ],
};

function cleanQueries(queries) {
  return [
    ...new Set(
      queries
        .map((query) =>
          String(query).trim()
        )
        .filter(Boolean)
    ),
  ].slice(
    0,
    config.maxSearchQueries
  );
}

function fallbackQueries(userQuery) {
  return {
    target_description:
      `India-based founder-led small B2B companies that could benefit from LinkedIn content and personal-brand assistance. Request: ${userQuery.trim()}`,

    location: "India",

    industry:
      "B2B SaaS, agencies, consulting, coaching, professional services, IT/software services",

    company_type:
      "founder-led small B2B company",

    product_or_technology:
      "LinkedIn content, personal branding, content creation",

    relationship: "needs",

    search_queries: cleanQueries([
      '"B2B SaaS" founder India company',
      '"software company" founder India',
      '"marketing agency" founder India',
      '"AI agency" founder India',
      '"consulting firm" founder India',
      '"business consultant" India founder',
      '"business coach" India',
      '"IT services" founder India',
    ]),
  };
}

export async function generateSearchPlan(userQuery) {
  if (!userQuery || !userQuery.trim()) {
    throw new Error("USER_QUERY cannot be empty.");
  }

  return fallbackQueries(userQuery);
}
