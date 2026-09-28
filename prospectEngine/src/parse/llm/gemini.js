import { GoogleGenAI } from "@google/genai";

export function createGeminiProvider(config) {
  const ai = new GoogleGenAI({
    apiKey: config.geminiApiKey,
  });

  return {
    name: "gemini",

    async complete({ prompt, jsonSchema }) {
      const interaction = await ai.interactions.create({
        model: config.llmGeminiModel,

        input: prompt,

        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: jsonSchema,
        },
      });

      if (!interaction.output_text) {
        throw new Error(
          "Gemini returned an empty response."
        );
      }

      return {
        attempted: true,
        ok: true,
        data: JSON.parse(interaction.output_text),
      };
    },
  };
}
