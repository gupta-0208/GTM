export function createChannel({ type, backends }) {
  let active = null;
  let lastProbe = null;
  let lastError = null;

  async function probe() {
    for (const backend of backends) {
      try {
        const ok = await backend.probe();

        if (ok) {
          active = backend;
          lastProbe = new Date().toISOString();
          lastError = null;

          return backend.name;
        }
      } catch (error) {
        lastError = error.message;
      }
    }

    active = null;
    lastProbe = new Date().toISOString();

    return null;
  }

  async function run(input) {
    if (!active) {
      await probe();
    }

    if (!active) {
      throw new Error(
        `${type}: no working backend`
      );
    }

    try {
      return await active.run(input);
    } catch (error) {
      lastError = error.message;

      await probe();

      if (!active) {
        throw error;
      }

      return active.run(input);
    }
  }

  function status() {
    return {
      type,
      active: active?.name || null,
      candidates: backends.map(
        (backend) => backend.name
      ),
      lastProbe,
      lastError,
    };
  }

  return {
    type,
    probe,
    run,
    status,
  };
}