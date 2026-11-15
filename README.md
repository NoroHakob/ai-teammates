# AI Teammates

AI teammates you chat with. Each bot has its own Linux sandbox with a desktop (Daytona), so it can run commands, edit files and use a screen instead of only describing what it would do.

- **Direct and group chats.** In a group chat you address one bot, and it can hand the request off to a teammate whose job fits better.
- **Per-bot memory.** Bots remember what they learn across conversations.
- **Billing with usage limits.** A paid Clerk plan unlocks bots and sandboxes. AI cost and sandbox time are metered against a per-period allowance ($10 of AI, 50 sandbox hours; see `lib/usage.ts`).

Built following Code With Antonio's "AI Teammates" tutorial, with changes: no Trigger.dev (sandbox metering runs from an external cron), and it deploys to Vercel.

## Stack

Next.js 16, React 19, Tailwind CSS 4, shadcn/ui (Base UI), Clerk (auth and billing), Neon Postgres + Drizzle ORM, AI SDK 7 + OpenAI, Daytona, Sentry.

## Local setup

Requirements: Node.js 22 or newer, plus accounts with Clerk, Neon, OpenAI and Daytona (Sentry is optional).

```bash
npm install
```

Create `.env.local` in the project root with these variables:

| Variable                                          | Where to get it                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`               | Clerk dashboard → API keys                                                           |
| `CLERK_SECRET_KEY`                                | Clerk dashboard → API keys                                                           |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`                   | The app's sign-in route: `/sign-in`                                                  |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL`                   | The app's sign-up route: `/sign-up`                                                  |
| `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | Where to land after sign-in, e.g. `/`                                                |
| `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` | Where to land after sign-up, e.g. `/`                                                |
| `DATABASE_URL`                                    | Neon console → Connect, **pooled** connection string                                 |
| `DATABASE_URL_UNPOOLED`                           | Neon console → Connect, **direct** (unpooled) connection string, used by drizzle-kit |
| `OPENAI_API_KEY`                                  | OpenAI platform → API keys                                                           |
| `DAYTONA_API_KEY`                                 | Daytona dashboard → API keys                                                         |
| `CRON_SECRET`                                     | Any long random string you generate, e.g. `openssl rand -hex 32`                     |
| `NEXT_PUBLIC_SENTRY_DSN`                          | Sentry → project settings → Client keys (DSN). Optional: without it Sentry is off    |
| `SENTRY_ORG`                                      | Sentry organization slug. Optional, for source map upload                            |
| `SENTRY_PROJECT`                                  | Sentry project slug. Optional, for source map upload                                 |
| `SENTRY_AUTH_TOKEN`                               | Sentry → auth tokens. Optional, without it no source maps are uploaded               |

In Clerk, enable Billing and create a paid plan with the features `bots` and `sandboxes` (the free plan has neither).

Create the database tables, then start the dev server:

```bash
npm run db:push
npm run dev
```

The app runs on http://localhost:3000.

Schema changes go through `npm run db:push` only. There are no migrations, and existing data is not preserved.

## Deploy (Vercel)

1. Import the repository into Vercel. The build command is `npm run build`.
2. Set every variable from the table above for the Production environment. `NEXT_PUBLIC_*` variables are baked in at build time, so redeploy after changing them.
3. Use a separate Neon branch for production. Push the schema to it from your machine before the first deploy and after every schema change. Deploys don't touch the database:

   ```bash
   DATABASE_URL_UNPOOLED="<production branch direct URL>" npm run db:push
   ```

4. Set up the sandbox meter. Vercel Cron on the Hobby plan runs at most once a day, so use an external scheduler such as cron-job.org. Every 5 minutes, it must send:

   ```
   POST https://<your-domain>/api/cron/meter-sandboxes
   Authorization: Bearer <CRON_SECRET>
   ```

   Without it, running sandboxes are never metered or stopped when the allowance runs out.

5. Optionally point an uptime monitor at `GET /api/health`. It returns `{ "status": "ok" }` and doesn't touch the database or other services.

Vercel Hobby stops a function after 300 s. The chat route sets `maxDuration = 300` and starts no new model step after 240 s, so long replies end cleanly and are saved.

## Security notes

- **No secrets in the sandbox.** The bot runs whatever the model decides, so sandboxes get no env vars, API keys or volumes. The Daytona key stays on the server.
- **Sentry collects no content.** It receives no prompts, replies, memory, file contents, sandbox ids or URLs with their query strings. Server errors are sent without their message. The only user data sent is the Clerk user id. The rules live in `lib/sentry-privacy.ts` and `lib/log.ts`.
- **Set spend limits** on OpenAI, Daytona and Vercel. The in-app allowance caps what each user can spend, not your total bill.
- The cron endpoint only accepts requests that carry `CRON_SECRET`. Keep that secret out of the client and out of logs.

## Scripts

| Script              | What it does                                                   |
| ------------------- | -------------------------------------------------------------- |
| `npm run dev`       | Start the dev server                                           |
| `npm run build`     | Production build                                               |
| `npm start`         | Serve the production build (reads `PORT`, default 3000)        |
| `npm run lint`      | ESLint                                                         |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`)                              |
| `npm run format`    | Prettier on all `.ts`/`.tsx` files                             |
| `npm run db:push`   | Push `db/schema.ts` to the database in `DATABASE_URL_UNPOOLED` |
| `npm run db:studio` | Open Drizzle Studio                                            |
