# Scout.ai Feature Integration Plan

## Context and Goals
Chef by Convex already provides AI-assisted coding through Remix on the client and Convex on the backend. The Scout.ai program layer adds autonomous triage, agent-driven implementation, GitHub-aware delivery, and secure execution sandboxes. The goal is to extend the existing architecture without disrupting current flows, enabling:
- End-to-end issue triage through delivery (PRs) with minimal human intervention.
- Secure, observable execution of generated code and tests in E2B sandboxes.
- Real-time visibility into agent, queue, and repository activity inside the Chef UI.

## Guiding Principles
1. **Convex-first state management** – persist long-running workflows, telemetry, and agent state in Convex tables to leverage real-time updates.
2. **Composable services** – encapsulate GitHub, AI code generation, E2B, and queue logic behind dedicated modules accessed by Convex functions and Remix loaders/actions.
3. **Auditable automation** – persist all model prompts/results, sandbox runs, and GitHub actions for traceability.
4. **Incremental rollout** – ship foundation pieces (schema, services, task queue) before layering advanced automation.

## High-Level Architecture
```
Remix UI (app/*)
  ├─ Dashboard, Issue Board, Execution Monitor, PR Manager, Code Review UI
  ├─ WebSocket subscription to Convex for live updates
  └─ REST/loader actions proxying to Convex mutations/queries

Convex Backend (convex/*)
  ├─ Issue triage pipeline (webhook ingestion, scoring, assignment, clustering)
  ├─ AI generation service orchestrators (code, tests, docs)
  ├─ Task queue orchestrator & job records
  ├─ GitHub integration layer (GraphQL + REST)
  ├─ E2B sandbox client wrappers
  ├─ Code analysis & QA pipeline (lint, SAST, performance hints)
  └─ Audit/event log stream

Service Layer (app/lib/.server & zapdev-agent)
  ├─ GitHubClient (octokit GraphQL, REST fallbacks)
  ├─ AICodeEngine (OpenAI/Anthropic wrappers, prompt templates)
  ├─ E2BClient (sandbox lifecycle, streaming logs)
  ├─ BullMQ queue workers (Node worker scripts)
  └─ Analysis adapters (ESLint, Semgrep/SonarJS, custom heuristics)

External Services
  ├─ GitHub App / OAuth credentials
  ├─ Redis (BullMQ backend)
  ├─ E2B cloud API
  ├─ OpenAI / Anthropic API keys
```

## New Dependencies
- `@octokit/graphql` and `@octokit/rest` for GitHub API v4/v3 access.
- `bullmq` and `ioredis` for task queue management.
- `pino` (or reuse existing logging) for structured worker logs.
- `semver` (optional) for repo analysis.
- `sonarqube-scanner` or `semgrep` CLI wrappers for SAST (pending feasibility).

Dependency installation should be handled via `pnpm add` alongside lockfile updates when implementation begins.

## Convex Schema Extensions
Add the following tables (nomenclature aligns with requirements):
- `issues`: stores GitHub issue metadata, triage results, priority scores, status, assignee, cluster id, audit refs.
- `issueClusters`: optional helper table to describe clusters and linked issues.
- `codeGenerations`: records generated code/test/doc artifacts with status and linked sandbox runs.
- `pullRequests`: tracks PR lifecycle, merge status, reviewers, feedback references.
- `executionLogs`: persisted stdout/stderr, resource metrics, and sandbox metadata.
- `aiAgents`: registry of human and AI agents, capabilities, load, performance metrics.
- `taskQueue`: durable queue mirror storing job payload, queue type, status, timings.
- `auditEvents`: append-only log of automated actions for compliance.

Each table should be indexed to support real-time dashboards (e.g., `status`, `issueId`, `agentId`, `queueType`). Migration plan: create schema entries, run Convex migration CLI, backfill from GitHub if needed.

## Service Modules
### GitHub Integration Layer
- **Webhook handler**: Remix route `app/routes/api.github.webhook.ts` verifying signatures and forwarding payloads to `convex/http.ts` mutation `github.handleWebhook`.
- **Repository sync**: Convex mutation `github.syncRepository` to fetch metadata, branch list, open PRs.
- **Operations**: modules under `convex/github/` for cloning (via GitHub API + local mirror), branch management, commit creation, PR creation/update, review handling. Persist actions in `auditEvents`.
- **Authentication**: Use GitHub App installation tokens stored securely in Convex storage or environment variables; rotate via scheduled cron.

### Issue Triage Pipeline
- `issues.ingestWebhook` mutation stores raw payload and normalised issue record.
- Scoring job enqueued in BullMQ: uses severity keywords, repo velocity metrics, label weights, historical resolution times (query from Convex + GitHub).
- Smart assignment heuristics: map labels/areas to `aiAgents` capabilities and availability.
- Clustering: vectorise issue titles/descriptions using embeddings (OpenAI text-embedding-3-large) and group via cosine similarity; persist cluster id.

### AI Code Generation Engine
- `ai/codeEngine.ts` orchestrator invoked by Convex actions; uses templates stored in `zapdev-agent/prompts`.
- Multi-language support determined by issue context; inspect repo languages via GitHub API.
- Test generation flows call out to sandbox after synthesising tests.
- Documentation generation updates README or docs; track in `codeGenerations` record.

### E2B Integration
- Server-side client `services/e2b.ts` wrapping authentication, sandbox spawn, file sync, command execution, streaming logs.
- Execution pipeline: upload generated code, run tests/linters, capture logs to `executionLogs`, update job status.
- Resource/timeouts handled via E2B API parameters; enforce defaults per queue type (triage vs generation vs regression).

### Task Queue System
- BullMQ queues: `triage`, `generation`, `testing`, `analysis`, `delivery`.
- Worker scripts under `app/workers/` (or `scripts/workers/`) running via separate Node process; orchestrate Convex mutations for state transitions.
- Convex `taskQueue` table stores job metadata; sync hooks keep BullMQ and Convex state consistent.
- Retry policies per queue; dead-letter monitoring.

### Code Analysis & QA
- Static analysis workers run ESLint/Prettier with repo configuration.
- Security scanning via Semgrep ruleset; store findings in `codeGenerations.securityFindings` or dedicated `analysisFindings` table.
- Performance heuristics: simple complexity metrics (e.g., `escomplex`, Lighthouse for web) depending on repo type.
- Automated code review uses AI summarise diff and raise suggestions stored alongside PR comments.

### Real-time Monitoring
- Use Convex queries for live dashboard data: `issues.listByStatus`, `agents.list`, `tasks.inProgress`, `executions.recent`.
- WebSocket updates already provided by Convex; Remix components subscribe via generated client hooks.

## API Endpoints and Routes
Implement Remix route modules corresponding to requirement list:
- `app/routes/api.github.webhook.ts` – POST handler verifying signature and delegating to Convex.
- `app/routes/api.issues.triage.ts` – GET returning triaged issue summaries.
- `app/routes/api.issues.assign.ts` – POST to assign issue to agent; calls Convex mutation.
- `app/routes/api.code.generate.ts` – POST to trigger code generation job.
- `app/routes/api.code.test.ts` – POST to request sandbox test run.
- `app/routes/api.code.review.ts` – POST for AI review results.
- `app/routes/api.github.pr.create.ts`, `api.github.pr.update.ts`, `api.github.repos.$id.status.ts`.
- `app/routes/api.agents.status.ts`, `api.tasks.queue.ts`.
- WebSocket endpoint proxied by Remix or rely on Convex real-time subscriptions; optional `app/routes/api.realtime.updates.ts` for custom events.

Each API route should be thin, delegating to shared server modules that call Convex actions/mutations.

## UI Components
- **Dashboard**: Summaries of issues, agents, queues, recent executions. Use existing design system components.
- **Issue Triage Board**: Kanban built with DnD utilising `react-dnd`; columns by status/priority.
- **Code Review Interface**: Diff viewer using Codemirror or `react-diff-viewer`, showing AI suggestions.
- **Execution Monitor**: Terminal-like log viewer streaming from Convex `executionLogs` updates.
- **PR Management**: Table of open PRs, status, reviewers, merge readiness.

## Security and Compliance
- Store service credentials in Convex secrets or environment-managed vault; never in code.
- Sign and verify GitHub webhooks using shared secret.
- Enforce RBAC via `aiAgents.role` and session membership mapping; restrict destructive operations to privileged users.
- Audit trail: create `auditEvents` entry for every automated action; surface in admin dashboard.
- Implement rate limiting for inbound webhooks and manual triggers (reuse `convex/rateLimiter.ts`).

## Implementation Roadmap
### Phase 1: Foundation
1. Extend Convex schema with new tables + migrations.
2. Implement GitHub webhook route, basic issue ingestion mutation, and persistence.
3. Add BullMQ queue setup, `taskQueue` sync helpers, and worker bootstrap scripts (stubs allowed).
4. Create service wrappers for GitHub GraphQL, AI engine, E2B (with placeholder credentials).
5. Build minimal dashboard showing counts from new tables.

### Phase 2: Core AI Workflows
1. Implement priority scoring function and smart assignment heuristics.
2. Enable AI code generation pipeline writing to `codeGenerations` and scheduling sandbox runs.
3. Integrate E2B execution with log capture.
4. Automate PR creation/update and commit message generation.

### Phase 3: Advanced Automation
1. Issue clustering with embeddings, conflict resolution flows.
2. Code analysis pipeline (lint + SAST + performance suggestions).
3. Enhanced parallel orchestration (resource aware scheduling, dead-letter handling).

### Phase 4: Polish & Scale
1. UI/UX refinements, real-time dashboards, notifications.
2. Security hardening, audit export, load testing.
3. Documentation (API docs, runbooks) and deployment automation.

## Open Questions / Risks
- Redis/BullMQ hosting strategy for local vs production deployments.
- E2B sandbox quotas and cost monitoring; need throttling.
- GitHub App permissions scope and install flow inside Chef UI.
- Long-running worker process hosting (Vercel edge vs dedicated Node worker).
- Observability stack (logs, metrics) integration with existing tooling (Datadog/Sentry?).

## Immediate Next Steps
1. Confirm infrastructure prerequisites (Redis instance, GitHub App credentials, E2B API keys).
2. Start Phase 1 implementation: schema + webhook ingestion + queue scaffolding.
3. Define detailed AI prompt templates for triage, code generation, review (leverage `zapdev-agent/prompts`).
4. Set up feature flag to gate Scout.ai functionality during rollout.

