import { AiNotConnectedError } from "../../services/errors";
import type { AiProvider } from "../../services/ports";

/** Used when no AI provider is configured; manual workflows keep working. */
export const disabledAiProvider: AiProvider = {
  enabled: false,
  status: async () => ({ connected: false }),
  extract: async () => {
    throw new AiNotConnectedError();
  },
};
