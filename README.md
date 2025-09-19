<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://zapdev.convex.dev/github-header-dark.svg">
    <img alt="Zapdev by Convex'" src="https://zapdev.convex.dev/github-header-light.svg" width="600">
  </picture>
</p>

[Zapdev](https://zapdev.convex.dev) is the only AI app builder that knows backend. It builds full-stack web apps with a built-in database, zero config auth, file uploads,
real-time UIs, and background workflows. If you want to check out the secret sauce that powers Zapdev, you can view or download the system prompt [here](https://github.com/get-convex/zapdev/releases/latest).

Zapdev's capabilities are enabled by being built on top of [Convex](https://convex.dev), the open-source reactive database designed to make life easy for web app developers. The "magic" in Zapdev is just the fact that it's using Convex's APIs, which are an ideal fit for codegen.

Development of the Zapdev is led by the Convex team. We
[welcome bug fixes](./CONTRIBUTING.md) and
[love receiving feedback](https://discord.gg/convex).

This project is a fork of the `stable` branch of [bolt.diy](https://github.com/stackblitz-labs/bolt.diy).

## Getting Started

Visit our [documentation](https://docs.convex.dev/zapdev) to learn more about Zapdev and check out our prompting [guide](https://stack.convex.dev/zapdev-cookbook-tips-working-with-ai-app-builders).

The easiest way to build with Zapdev is through our hosted [webapp](https://zapdev.convex.dev), which includes a generous free tier. If you want to
run Zapdev locally, you can follow the guide below.

### Running Locally

Note: This will use the hosted Convex control plane to provision Convex projects. However, Zapdev tokens used in this enviroment will not count towards usage in your Convex account.

**1. Clone the project**

Clone the GitHub respository and `cd` into the directory by running the following commands:

```bash
git clone https://github.com/get-convex/zapdev.git
cd zapdev
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

**3. Set up Zapdev OAuth application**

Go to the Convex [dashboard](https://dashboard.convex.dev/team/settings/applications/oauth-apps) and create an OAuth application. The team you use to create the application will be the only team you can sign-in with on local Zapdev. Redirect URIs will not matter, but you can set one to http://127.0.0.1:5173 (or whatever port you’ll run the Zapdev UI on) so that the form can be submitted.

**4. Set up Convex deployment**

Use `npx convex dashboard` to open the Convex [dashboard](https://dashboard.convex.dev) and go to Settings → Environment Variables. Then, set the following environment variables:

```env
BIG_BRAIN_HOST=https://api.convex.dev
CONVEX_OAUTH_CLIENT_ID=<value from oauth setup>
CONVEX_OAUTH_CLIENT_SECRET=<value from oauth setup>
CLERK_PUBLISHABLE_KEY=<value from Clerk dashboard>
CLERK_JWT_ISSUER_DOMAIN=<your-domain>.clerk.accounts.dev
```

**5. Add API keys for model providers**

Add the following API keys in your `.env.local` to enable code generation:

```env
# OpenRouter provides access to 100+ AI models through a single API key
OPENROUTER_API_KEY=<your openrouter api key>

# E2B provides cloud-based code execution environments
E2B_API_KEY=<your e2b api key>
```

Get your API keys:
- OpenRouter: Visit [openrouter.ai/keys](https://openrouter.ai/keys) to get your API key
- E2B: Visit [e2b.dev](https://e2b.dev) to get your API key

Note: You can also add your own OpenRouter API key through the Zapdev settings page.

**6. Run Zapdev backend and frontend**

Run the following commands in your terminal:

```bash
pnpm run dev

## in another terminal
npx convex dev
```

Congratulations, you now have Zapdev running locally! You can log in to Zapdev with your existing Convex account.

Note: Zapdev is accessible at http://127.0.0.1:{port}/ and will not work properly on http://localhost:{port}/.

## Repository Layout

- `app/` contains all of the client side code and some serverless APIs.

  - `components/` defines the UI components
  - `lib/` contains client-side logic for syncing local state with the server
  - `routes/` defines some client and server routes

- `zapdev-agent/` handles the agentic loop by injecting system prompts, defining tools, and calling out to model providers.

- `zapdevshot/` defines a CLI interface for interacting with the Zapdev webapp.

- `convex/` contains the database that stores chats and user metadata.

- `template/` contains the template that we use to start all Zapdev projects.

- `test-kitchen/` contains a test harness for the Zapdev agent loop.
