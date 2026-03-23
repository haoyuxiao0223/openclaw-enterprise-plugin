import { Hono } from "hono";
import type { EnterpriseModules } from "../../../registry.ts";

export function createQueueRoutes(modules: EnterpriseModules): Hono {
  const app = new Hono();
  const queue = modules.kernel.queue;

  app.get("/:queueName/dlq", async (c) => {
    const queueName = c.req.param("queueName");
    const offset = Number(c.req.query("offset") ?? 0);
    const limit = Number(c.req.query("limit") ?? 20);

    const result = await queue.getDeadLetterMessages(queueName, { offset, limit });
    return c.json(result);
  });

  app.post("/:queueName/dlq/:messageId/replay", async (c) => {
    const queueName = c.req.param("queueName");
    const messageId = c.req.param("messageId");
    await queue.replayDeadLetter(queueName, messageId);
    return c.json({ success: true, messageId, queue: queueName });
  });

  return app;
}
