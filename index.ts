/**
 * OpenClaw Enterprise Plugin Entry — registers the enterprise subsystem
 * as a standard OpenClaw plugin using the existing plugin API.
 *
 * Uses:
 *   - registerService: lifecycle (bootstrap on start, teardown on stop)
 *   - registerHttpRoute: mount enterprise REST API at /api/v1/*
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import {
  bootstrapEnterprise,
  shutdownEnterprise,
  getEnterpriseModules,
} from "./bootstrap.ts";
import { buildRestApi } from "./src/embedding/api/rest-api-builder.ts";

export default definePluginEntry({
  id: "enterprise",
  name: "Enterprise Mode",
  description:
    "Multi-tenant governance, audit, isolation, collaboration, and reliability for enterprise deployments",

  register(api) {
    api.registerService({
      id: "enterprise",

      async start(ctx) {
        const enterpriseConfig =
          (ctx.config as Record<string, unknown>)["enterprise"] as
            | Record<string, unknown>
            | undefined;

        if (!enterpriseConfig?.["enabled"]) {
          ctx.logger.info("Enterprise mode disabled — skipping bootstrap");
          return;
        }

        ctx.logger.info("Bootstrapping enterprise subsystem...");

        const modules = await bootstrapEnterprise(
          enterpriseConfig as Parameters<typeof bootstrapEnterprise>[0],
        );

        if (!modules) {
          ctx.logger.warn("Enterprise bootstrap returned null — no modules active");
          return;
        }

        ctx.logger.info("Enterprise subsystem ready");
      },

      async stop(_ctx) {
        await shutdownEnterprise();
      },
    });

    // Mount the enterprise REST API at /api/v1/* using prefix matching.
    // The Hono app handles sub-routing internally.
    api.registerHttpRoute({
      path: "/api/v1/",
      auth: "gateway",
      match: "prefix",
      async handler(req, res) {
        const modules = getEnterpriseModules();
        if (!modules) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Enterprise mode not enabled" }));
          return true;
        }

        const honoApp = buildRestApi(modules);
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
        const honoReq = new Request(url.toString(), {
          method: req.method,
          headers: Object.entries(req.headers).reduce(
            (h, [k, v]) => {
              if (v) h.set(k, Array.isArray(v) ? v.join(", ") : v);
              return h;
            },
            new Headers(),
          ),
        });

        const honoRes = await honoApp.fetch(honoReq);
        res.writeHead(honoRes.status, Object.fromEntries(honoRes.headers.entries()));
        const body = await honoRes.text();
        res.end(body);
        return true;
      },
    });
  },
});
