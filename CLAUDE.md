# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Architecture

Zapdev is an AI-powered full-stack web application builder built on Convex. It's a Remix application with React frontend that enables users to build complete web apps through AI conversations. The project is a pnpm workspace with these main components:

- **Frontend**: Remix + React app with Vite bundling, Tailwind CSS styling
- **Backend**: Convex reactive database with real-time subscriptions  
- **AI Agent**: OpenRouter integration providing access to 100+ AI models
- **E2B Code Interpreter**: Cloud-based code execution environments for running generated code
- **Authentication**: Clerk-based auth bridged to Convex

## Development Commands

**Setup and Development:**
```bash
# Initial setup (Node 18.18+ required)
nvm install && nvm use
npm install -g pnpm
pnpm i
echo 'VITE_CONVEX_URL=placeholder' >> .env.local
npx convex dev --once

# Development (requires two terminals)
pnpm run dev              # Frontend (visit http://127.0.0.1:5173)
npx convex dev           # Backend database

# For internal development against local big-brain
just convex-bb dev       # Alternative convex command
```

**Quality Assurance:**
```bash
pnpm run lint            # ESLint + Prettier check
pnpm run lint:fix        # Auto-fix linting issues
pnpm run typecheck       # TypeScript type checking
pnpm run test            # Vitest test suite
pnpm run test:watch      # Watch mode testing
```

**Build and Deploy:**
```bash
pnpm run build           # Production build
pnpm run preview         # Preview production build
pnpm run build:proxy     # Build proxy component
pnpm run rebuild-template # Regenerate bootstrap template
```

## Codebase Structure

### Frontend (`app/`)
- `components/` - React UI components organized by feature
- `lib/` - Client-side utilities, hooks, and state management
- `routes/` - Remix route definitions (file-based routing)
- `styles/` - Tailwind CSS and component styles
- `types/` - TypeScript type definitions
- `utils/` - Shared utility functions

### Backend (`convex/`)
- Database schema, queries, mutations, and actions
- HTTP endpoints and API routes
- Authentication and session management
- Real-time message handling and compression
- File cleanup and project management logic

### AI Integration (`zapdev-agent/`)
- System prompts and AI model configurations
- Tool definitions and agent workflow orchestration  
- Multi-provider AI SDK integrations
- Code generation and execution logic

### Supporting Components
- `template/` - Bootstrap project template for generated apps
- `test-kitchen/` - Agent testing and regression fixtures
- `zapdevshot/` - CLI interface for Zapdev webapp
- `types/` - Shared TypeScript definitions across workspace

## Development Patterns

### Convex Integration
- Follow the comprehensive Convex guidelines in `.cursor/rules/convex_rules.mdc`
- Always use new function syntax with proper validators
- Use `query`, `mutation`, `action` for public APIs
- Use `internalQuery`, `internalMutation`, `internalAction` for private functions
- Define schemas in `convex/schema.ts` with proper indexing

### Code Style
- TypeScript with ESM modules throughout
- Prettier enforces 2-space indentation
- PascalCase for React components and Convex functions
- camelCase for hooks (prefixed with `use`)
- kebab-case for route files
- Tailwind utility classes preferred over custom CSS

### AI Agent Development
- System prompts live in `zapdev-agent/` and are built via `buildSystemPrompts.ts`
- OpenRouter integration provides unified access to 100+ AI models
- E2B Code Interpreter integration for cloud-based code execution
- Real-time streaming responses with proper error handling

### Testing Strategy
- Vitest for unit tests, snapshots, and Convex function testing
- Tests colocated as `*.test.ts` or `*.spec.tsx`
- Backend tests in `convex/`, agent tests in `zapdev-agent/`
- Mock external services for deterministic test runs

## Environment and Configuration

### Required Local Variables (.env.local)
```bash
VITE_CONVEX_URL=placeholder
# OpenRouter provides access to 100+ AI models through single API
OPENROUTER_API_KEY=<your-openrouter-key>
OPENROUTER_MODEL=anthropic/claude-3.5-sonnet
# E2B provides cloud-based code execution environments
E2B_API_KEY=<your-e2b-key>
```

### Convex Environment Variables (via dashboard)
```bash
BIG_BRAIN_HOST=https://api.convex.dev
CONVEX_OAUTH_CLIENT_ID=<oauth-setup-value>
CONVEX_OAUTH_CLIENT_SECRET=<oauth-setup-value>  
CLERK_PUBLISHABLE_KEY=<clerk-publishable-key>
CLERK_JWT_ISSUER_DOMAIN=<your-domain>.clerk.accounts.dev
```

## Important Notes

- **Use pnpm**: Project uses pnpm workspace, not npm
- **Use 127.0.0.1**: Frontend must run on 127.0.0.1:5173, not localhost
- **Reload Required**: First dev server load requires a page reload
- **Template Updates**: Run `pnpm run rebuild-template` after bootstrap changes
- **No Secrets**: Never commit API keys or sensitive data
- **Node 18.18+**: Required for development (Node 22 in Vercel production)

## Branch Strategy

- `main` - Default development branch
- `staging` - Deployed to zapdev-staging.convex.dev  
- `release` - Production deployment at zapdev.convex.dev

## Debugging Tools

Global variables available in browser console:
- `zapdevE2BContainer` - E2B Code Interpreter runtime
- `zapdevMessages` / `zapdevParsedMessages` - Message handling
- `zapdevSetLogLevel()` - Adjust logging level ("debug", "info", "tracing")
- `zapdevAssertAdmin()` - Enable admin features (Convex team only)