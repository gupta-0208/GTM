// OpenAI provider backed by the official OpenAI JavaScript SDK.
//
// Uses the Responses API with structured outputs (strict JSON schema) when a
// `jsonSchema` is supplied, and falls back to JSON object mode otherwise.
// Retries, timeout and a per-run call budget are all driven by config, and
// errors are returned as normalized results (never thrown) so a provider
// failure can never take down the enclosing pipeline.

const TRANSIENT_STATUS = new Set([
  408,
  409,
  429,
  500,
  502,
  503,
  504,
]);

function classifyError(error) {
  const status = Number(error?.status || error?.statusCode || 0);

  if (status === 401 || status === 403) {
    return "auth";
  }

  if (
    status === 400 ||
    status === 404 ||
    status === 422
  ) {
    return "invalid_request";
  }

  if (status === 429) {
    return "rate_limit";
  }

  if (TRANSIENT_STATUS.has(status)) {
    return "server";
  }

  if (
    error?.name === "AbortError" ||
    error?.code === "ECONNABORTED" ||
    /timed?\s?out/i.test(error?.message || "")
  ) {
    return "timeout";
  }

  if (
    error?.code === "ENOTFOUND" ||
    error?.code === "ECONNREFUSED" ||
    error?.code === "ECONNRESET"
  ) {
    return "network";
  }

  return "unknown";
}

function extractOutputText(response) {
  if (
    typeof response?.output_text === "string" &&
    response.output_text
  ) {
    return response.output_text;
  }

  for (const item of response?.output || []) {
    if (item?.type !== "message") {
      continue;
    }

    const text = (item.content || [])
      .filter(
        (part) => part?.type === "output_text"
      )
      .map((part) => part.text)
      .join("");

    if (text) {
      return text;
    }
  }

  return "";
}

function normalizeUsage(response) {
  if (!response?.usage) {
    return null;
  }

  return {
    inputTokens: response.usage.input_tokens ?? 0,
    outputTokens: response.usage.output_tokens ?? 0,
    totalTokens: response.usage.total_tokens ?? 0,
  };
}

export function createOpenaiProvider(config) {
  let client = null;
  let calls = 0;

  async function getClient() {
    if (client) {
      return client;
    }

    if (!config.openaiApiKey) {
      throw new Error(
        "OPENAI_API_KEY is not set"
      );
    }

    const { default: OpenAI } = await import("openai");

    client = new OpenAI({
      apiKey: config.openaiApiKey,
      timeout: config.openaiTimeoutMs,
      maxRetries: config.openaiMaxRetries,
    });

    return client;
  }

  return {
    name: "openai",

    usage() {
      return {
        calls,
        maxCalls: config.openaiMaxCallsPerRun,
      };
    },

    async complete({
      prompt,
      jsonSchema,
    }) {
      if (calls >= config.openaiMaxCallsPerRun) {
        return {
          attempted: false,
          ok: false,
          error: "OPENAI_MAX_CALLS_PER_RUN reached",
          category: "limit",
          usage: null,
        };
      }

      try {
        const client = await getClient();

        calls += 1;

        const response =
          await client.responses.create({
            model: config.openaiModel,

            input: prompt,

            text: jsonSchema
              ? {
                  format: {
                    type: "json_schema",
                    name: "structured_output",
                    schema: jsonSchema,
                    strict: true,
                  },
                }
              : {
                  format: {
                    type: "json_object",
                  },
                },
          });

        const content =
          extractOutputText(response);

        if (!content) {
          return {
            attempted: true,
            ok: false,
            error:
              "OpenAI returned an empty response.",
            category: "empty",
            usage: normalizeUsage(response),
          };
        }

        return {
          attempted: true,
          ok: true,
          data: JSON.parse(content),
          usage: normalizeUsage(response),
        };
      } catch (error) {
        return {
          attempted: true,
          ok: false,
          error: error.message,
          category: classifyError(error),
          usage: null,
        };
      }
    },
  };
}
