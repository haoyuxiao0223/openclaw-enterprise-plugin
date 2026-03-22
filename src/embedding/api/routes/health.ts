import { Hono } from "hono";
import type { EnterpriseModules } from "../../../registry.ts";

export function createHealthRoutes(modules: EnterpriseModules): Hono {
  const app = new Hono();

  app.get("/health", async (c) => {
    const checks: Record<string, { healthy: boolean; latencyMs: number }> = {};

    const storageHealth = await modules.kernel.storage.healthCheck();
    checks["storage"] = storageHealth;

    return c.json({
      status: storageHealth.healthy ? "healthy" : "degraded",
      version: "1.0.0",
      uptime: process.uptime(),
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/health/live", (c) => c.json({ status: "ok" }));

  app.get("/health/ready", async (c) => {
    const storageHealth = await modules.kernel.storage.healthCheck();
    if (!storageHealth.healthy) {
      return c.json({ status: "not_ready", reason: "storage unhealthy" }, 503);
    }
    return c.json({ status: "ready" });
  });

  app.get("/metrics", async (c) => {
    const metricsProvider = modules.reliability?.metricsProvider;
    if (metricsProvider && typeof metricsProvider === "object" && "serialize" in metricsProvider) {
      const serialized = (metricsProvider as { serialize(): string }).serialize();
      return c.text(serialized, 200, { "Content-Type": "text/plain; version=0.0.4" });
    }
    return c.text("# No metrics provider configured\n", 200);
  });

  return app;
}
