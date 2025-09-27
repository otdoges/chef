<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://chef.convex.dev/github-header-dark.svg">
    <img alt="ZapDev by Convex'" src="https://chef.convex.dev/github-header-light.svg" width="600">
  </picture>
</p>

[ZapDev](https://chef.convex.dev) is the only AI app builder that knows backend. It builds full-stack web apps with a built-in database, zero config auth, file uploads,
real-time UIs, and background workflows. If you want to check out the secret sauce that powers ZapDev, you can view or download the system prompt [here](https://github.com/get-convex/chef/releases/latest).

ZapDev's capabilities are enabled by being built on top of [Convex](https://convex.dev), the open-source reactive database designed to make life easy for web app developers. The "magic" in ZapDev is just the fact that it's using Convex's APIs, which are an ideal fit for codegen.

Development of ZapDev is led by the Convex team. We
[welcome bug fixes](./CONTRIBUTING.md) and
[love receiving feedback](https://discord.gg/convex).

This project is a fork of the `stable` branch of [bolt.diy](https://github.com/stackblitz-labs/bolt.diy).

## Getting Started

Visit our [documentation](https://docs.convex.dev/chef) to learn more about ZapDev and check out our prompting [guide](https://stack.convex.dev/chef-cookbook-tips-working-with-ai-app-builders).

The easiest way to build with ZapDev is through our hosted [webapp](https://chef.convex.dev), which includes a generous free tier. If you want to
run ZapDev locally, you can follow the guide below.

### Running Locally

Note: This will use the hosted Convex control plane to provision Convex projects. However, ZapDev tokens used in this enviroment will not count towards usage in your Convex account.

**1. Clone the project**

Clone the GitHub respository and `cd` into the directory by running the following commands:

```bash
git clone https://github.com/get-convex/chef.git
cd chef
```

**2. Set up local environment**

Run the following commands in your terminal:

```bash
nvm install
nvm use
npm install -g pnpm
pnpm i
echo 'VITE_CONVEX_URL=placeholder' >> .env.local
npx convex dev --once # follow the steps to create a Convex project in your team
```

Note: `nvm` only works on Mac and Linux. If you are using Windows, you may have to find an alternative.

**3. Set up ZapDev OAuth application**

Go to the Convex [dashboard](https://dashboard.convex.dev/team/settings/applications/oauth-apps) and create an OAuth application. The team you use to create the application will be the only team you can sign-in with on local ZapDev. Redirect URIs will not matter, but you can set one to http://127.0.0.1:5173 (or whatever port you'll run the ZapDev UI on) so that the form can be submitted.

**4. Set up Convex deployment**

Use `npx convex dashboard` to open the Convex [dashboard](https://dashboard.convex.dev) and go to Settings → Environment Variables. Then, set the following environment variables:

```env
BIG_BRAIN_HOST=https://api.convex.dev
CONVEX_OAUTH_CLIENT_ID=<value from oauth setup>
CONVEX_OAUTH_CLIENT_SECRET=<value from oauth setup>
WORKOS_CLIENT_ID=<value from .env.development>
```

**5. Add API keys for model providers**

Add any of the following API keys in your `.env.local` to enable code generation:

```env
ANTHROPIC_API_KEY=<your api key>
GOOGLE_API_KEY=<your api key>
OPENAI_API_KEY=<your api key>
XAI_API_KEY=<your api key>
```

Note: You can also add your own API keys through the ZapDev settings page.

Alternatively, you can route all model calls through Vercel AI Gateway (recommended):

```env
# OpenAI-compatible base URL (defaults to https://ai-gateway.vercel.sh/v1)
VERCEL_AI_GATEWAY_BASE_URL=https://ai-gateway.vercel.sh/v1
# Required: Gateway API key
VERCEL_AI_GATEWAY_API_KEY=<your gateway api key>
# Default model to use when routing via the gateway
# Examples: gpt-4.1-mini, anthropic/claude-3-5-sonnet-20241022, groq/llama-3.1-70b
AI_MODEL=gpt-4.1-mini
```

When VERCEL_AI_GATEWAY_API_KEY is set, ZapDev will use the gateway for OpenAI, Anthropic, and OpenRouter model calls by default. Other providers (e.g. Google, XAI, Bedrock) continue to use their native SDKs unless configured otherwise.

**6. Run ZapDev backend and frontend**

Run the following commands in your terminal:

```bash
pnpm run dev

## in another terminal
npx convex dev
```

Congratulations, you now have ZapDev running locally! You can log in to ZapDev with your existing Convex account.

Note: ZapDev is accessible at http://127.0.0.1:{port}/ and will not work properly on http://localhost:{port}/.

## Repository Layout

- `app/` contains all of the client side code and some serverless APIs.

  - `components/` defines the UI components
  - `lib/` contains client-side logic for syncing local state with the server
  - `routes/` defines some client and server routes

- `chef-agent/` handles the agentic loop by injecting system prompts, defining tools, and calling out to model providers.

- `chefshot/` defines a CLI interface for interacting with the ZapDev webapp.

- `convex/` contains the database that stores chats and user metadata.

- `template/` contains the template that we use to start all ZapDev projects.

- `test-kitchen/` contains a test harness for the ZapDev agent loop.
