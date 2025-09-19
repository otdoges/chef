# Repository Guidelines

## Project Structure & Module Organization
Zapdev is a pnpm workspace. UI, Remix routes, and client helpers are in `app/`; shared types in `types/`; static assets in `public/`. Convex functions and database logic sit in `convex/`. Agent prompts, tool wiring, and evaluation logic live in `zapdev-agent/`. `zapdevshot/` exposes the CLI, `test-kitchen/` stores agent regression fixtures, and `template/` holds the bootstrap project shipped to users.

## Build, Test, and Development Commands
Use Node 18.18+ with pnpm. Run `pnpm run dev` for Remix and `npx convex dev` in a second terminal (visit `http://127.0.0.1:5173`). Build with `pnpm run build`; preview via `pnpm run preview`. For subsystem tweaks use `pnpm run build:proxy` or `pnpm run rebuild-template`. Keep quality with `pnpm run lint`, `pnpm run lint:fix`, `pnpm run typecheck`, and `pnpm run test` or `pnpm run test:watch`.

## Coding Style & Naming Conventions
TypeScript with ESM is the default. Prettier (invoked through `pnpm run lint:fix`) enforces two-space indentation and standard wrapping. ESLint rules live in `eslint.config.mjs` and `convex/eslint.config.mjs`; address warnings instead of disabling them. Use PascalCase for React components and Convex functions, camelCase hooks prefixed with `use`, and kebab-case files for routes. Tailwind utility classes are preferred over bespoke CSS.

## Testing Guidelines
Vitest covers units, snapshots, and Convex logic; colocate specs as `*.test.ts` or `*.spec.tsx`. Backend cases live under `convex/`, agent parsers in `zapdev-agent/`, and scenario runs in `test-kitchen/`. Extend the relevant suite whenever prompts, tools, or database schemas change. Run `pnpm run test` (add `-- --reporter verbose` when debugging) and keep runs deterministic by mocking external services.

## Commit & Pull Request Guidelines
Commits follow the repo history: concise imperative subjects, optional bracketed scope tags (e.g., `[Open Source]`), and the PR number added on merge. Keep changes scoped per commit. PRs need a summary, testing notes, linked issues, and UI screenshots or videos when visuals shift. Highlight environment updates and confirm lint, test, and typecheck status before requesting review.

## Security & Configuration Tips
Do not commit secrets or `.env.local`. Required local variables include `VITE_CONVEX_URL`, Convex OAuth credentials, and any model API keys; manage them through the Convex dashboard or a local `.env.local`. When updating bootstrap assets, run `pnpm run rebuild-template` and verify generated apps stay free of credentials and build warnings.
