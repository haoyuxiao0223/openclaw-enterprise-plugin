# OpenClaw Enterprise Plugin

Enterprise multi-tenant extension for [OpenClaw](https://github.com/openclaw/openclaw) — adds governance, audit, isolation, collaboration, and reliability layers for enterprise deployments.

## Features

- **Kernel** — Pluggable infrastructure abstractions (Storage, Queue, Cache, EventBus, Lock, Secret) with Memory, PostgreSQL, and Redis backends
- **Governance** — Identity providers (Token, OIDC), authorization engines (RBAC, Scope-based), quota management, content filtering
- **Audit** — Event pipeline with pluggable sinks (Log, Storage, Webhook, EventBus)
- **Collaboration** — Task state machine, workflow engine, agent handoff, knowledge store
- **Embedding API** — REST API with rate limiting, API key management, message envelope
- **Isolation** — Agent runtime backends (Kubernetes), resource limiting
- **Reliability** — Circuit breaker, retry policies, checkpointing, health checks, timeout management, Prometheus metrics
- **Middleware** — AuthN, AuthZ, tenant context, audit logging, rate limiting pipeline

## Architecture

```
┌─────────────────────────────────────────────────┐
│                 OpenClaw Gateway                 │
│  (upstream — syncs independently)               │
├─────────────────────────────────────────────────┤
│            Enterprise Plugin (this repo)         │
│  ┌──────────┐ ┌────────────┐ ┌───────────────┐  │
│  │  Kernel   │ │ Governance │ │     Audit     │  │
│  └──────────┘ └────────────┘ └───────────────┘  │
│  ┌──────────┐ ┌────────────┐ ┌───────────────┐  │
│  │Collabora.│ │ Embedding  │ │   Isolation   │  │
│  └──────────┘ └────────────┘ └───────────────┘  │
│  ┌──────────┐ ┌────────────┐                     │
│  │Reliability│ │ Middleware │                     │
│  └──────────┘ └────────────┘                     │
├─────────────────────────────────────────────────┤
│          PostgreSQL  │  Redis  │  Kubernetes     │
└─────────────────────────────────────────────────┘
```

## Installation

### As an OpenClaw Plugin

```bash
# Install OpenClaw
npm install -g openclaw

# Install the enterprise plugin
openclaw plugins install @openclaw/enterprise
```

### From Source (Development)

```bash
git clone https://github.com/haoyuxiao0223/openclaw-enterprise-plugin.git
cd openclaw-enterprise-plugin
npm install
```

## Configuration

Add the `enterprise` section to your `openclaw.json`:

```json
{
  "enterprise": {
    "enabled": true,
    "kernel": {
      "storage": { "backend": "postgres", "connectionString": "env:DATABASE_URL" },
      "queue": { "backend": "redis", "url": "env:REDIS_URL" },
      "cache": { "backend": "redis", "url": "env:REDIS_URL" },
      "eventBus": { "backend": "redis", "url": "env:REDIS_URL" },
      "lock": { "backend": "redis", "url": "env:REDIS_URL" }
    },
    "governance": {
      "identity": { "provider": "token" },
      "authorization": { "engine": "scope" }
    },
    "audit": {
      "sinks": [
        { "type": "log" },
        { "type": "storage" }
      ]
    },
    "reliability": {
      "metrics": { "provider": "prometheus", "port": 9090 }
    }
  }
}
```

## Deployment

### Docker Compose

```bash
cd deploy/docker-compose
docker compose up -d
```

This starts OpenClaw with enterprise mode, PostgreSQL, and Redis.

### Kubernetes (Helm)

```bash
helm install openclaw-enterprise deploy/helm/openclaw-enterprise \
  --set postgres.auth.password=<your-password>
```

## Project Structure

```
├── index.ts                 # Plugin entry (definePluginEntry)
├── bootstrap.ts             # Enterprise subsystem assembly
├── openclaw.plugin.json     # Plugin manifest for OpenClaw discovery
├── package.json             # npm package with openclaw metadata
├── src/
│   ├── kernel/              # Infrastructure abstractions
│   ├── kernel-impl/         # Memory / Postgres / Redis implementations
│   ├── governance/          # Identity, authorization, quota, content filter
│   ├── audit/               # Audit pipeline + sinks
│   ├── collaboration/       # Task FSM, workflow, handoff, knowledge
│   ├── embedding/           # REST API, rate limiter, API key management
│   ├── isolation/           # Agent runtime, resource limiter
│   ├── reliability/         # Circuit breaker, retry, checkpoint, health
│   ├── middleware/          # AuthN, AuthZ, tenant, audit, rate limit
│   └── registry.ts         # EnterpriseModules type definitions
├── deploy/
│   ├── Dockerfile.enterprise
│   ├── docker-compose/
│   └── helm/
├── database-schema.sql      # PostgreSQL schema
├── rls-policies.sql         # Row-Level Security policies
└── docs/
    ├── PRD-openclaw-enterprise-architecture.md
    ├── api-design.md
    └── tech-desigh.md
```

## How It Works

This plugin integrates with OpenClaw using the standard plugin API:

- **`registerService`** — Bootstraps the enterprise kernel and all modules on gateway start, tears down on stop
- **`registerHttpRoute`** — Mounts the enterprise REST API at `/api/v1/*` on the gateway HTTP server

The enterprise modules are completely decoupled from OpenClaw core:
- Zero imports from upstream OpenClaw source code
- All types are self-contained within this plugin
- Configuration is read from the `enterprise` section of `openclaw.json`

## License

MIT — See [LICENSE](LICENSE) for details.

Based on [OpenClaw](https://github.com/openclaw/openclaw) (MIT License, Copyright 2025 Peter Steinberger).
