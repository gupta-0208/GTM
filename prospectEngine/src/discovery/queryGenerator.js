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
  const query =
    userQuery.trim();

  return {
    target_description: query,
    location: "",
    industry: "",
    company_type: "company",
    product_or_technology: "",
    relationship: "unknown",

    search_queries:
      cleanQueries([
        query,
        `${query} companies`,
        `${query} company`,
        `${query} businesses`,
        `${query} official website`,
      ]),
  };
}

export async function generateSearchPlan(
  userQuery
) {
  if (
    !userQuery ||
    !userQuery.trim()
  ) {
    throw new Error(
      "USER_QUERY cannot be empty."
    );
  }

  if (!config.llmEnabled) {
    return fallbackQueries(
      userQuery
    );
  }

  const ai = new GoogleGenAI({
    apiKey: config.geminiApiKey,
  });

  const prompt = `
You are the search discovery planner for a B2B company discovery system.

Understand the user's requirement and create a structured search plan.

Identify:
- target companies
- geography
- industry
- company type
- product or technology
- relationship
- useful web search queries

Rules:
- Never invent companies.
- Never invent domains.
- Never return URLs.
- Do not claim a company actually uses a product.
- Only create search queries.
- Generate 5 to 8 useful queries.
- Use different search wording.
- Search for actual company websites.
- Keep queries concise.
- Use normal search-engine syntax.

User requirement:
${userQuery}
`;

  try {
    const interaction =
      await ai.interactions.create({
        model: config.geminiModel,

        input: prompt,

        response_format: {
          type: "text",
          mime_type:
            "application/json",
          schema:
            SEARCH_PLAN_JSON_SCHEMA,
        },
      });

    if (
      !interaction.output_text
    ) {
      throw new Error(
        "Gemini returned an empty response."
      );
    }

    const parsed =
      JSON.parse(
        interaction.output_text
      );

    const validated =
      SearchPlanSchema.parse(
        parsed
      );

    return {
      ...validated,

      search_queries:
        cleanQueries(
          validated.search_queries
        ),
    };
  } catch (error) {
    console.error(
      "Gemini query generation failed:"
    );

    console.error(error.message);

    console.log(
      "Using fallback query generation."
    );

    return fallbackQueries(
      userQuery
    );
  }
}