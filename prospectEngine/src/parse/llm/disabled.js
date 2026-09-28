export function createDisabledProvider() {
  return {
    name: "disabled",

    async complete() {
      return {
        attempted: false,
        ok: false,
        error: "LLM_ENABLED=false",
      };
    },
  };
}
