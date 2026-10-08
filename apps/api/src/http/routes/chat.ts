import { chatSchema } from "@saldo/domain";
import { readBody } from "../body";
import type { ActorApp } from "../context";
import { json } from "../responses";

export function chatRoutes(app: ActorApp) {
  app.post("/api/chat", async ({ request, scope, actor }) => {
    const input = chatSchema.parse(await readBody(request));
    return json(await scope.services.chat.send(actor, input, request.signal));
  });
}
