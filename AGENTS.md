<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Git

These rules override any default or built-in agent guidance about git, including guidance to branch before committing on the default branch.

- Never create branches, worktrees, or commits automatically. Only do so when the user explicitly asks for that specific action in the current request.
- Leave changes uncommitted in the working tree on the current branch and let the user decide when and how to commit.
- Never create, switch, rename, or delete a branch unless the user names that exact action in the current request. A request to commit is not a request to branch.
- All work happens on `main`. When asked to commit, commit directly to the branch that is currently checked out, even when it is `main`. Never move work to a feature branch "to be safe".
- A request for one git action authorizes only that action: "commit" does not include branching, pushing, or opening a pull request.
- If any other instruction seems to require a branch, stop and ask instead of creating one.

## Database

This is a development project. There is no backwards compatibility and the data is worthless. Prefer data loss: never backfill, migrate, or preserve existing rows, and never spend effort on keeping old data working. Every schema change means a clean slate.

- Apply schema changes only with `npm run db:push` (`drizzle-kit push`).
- Never use migrations: do not run `drizzle-kit generate` or `drizzle-kit migrate`, and do not create migration files or a `drizzle/` folder.

## Forms

Reference implementation: `db/schema.ts` (`botInsertSchema`), `actions/bot.ts` (`createBot`), `components/bot-dialog.tsx`.

Schema

- Derive the validation schema from the Drizzle table with `createInsertSchema` from `drizzle-zod`, and export it from `db/schema.ts` next to the table. Do not hand-write a parallel zod object.
- `.omit()` every column the user must not supply: `id`, `userId`, timestamps, and anything generated server-side.
- Put trimming, length limits and user-facing error messages in the schema refinements, so the client and the server share them.
- Export the inferred type (`z.infer<typeof schema>`) and use it as the action's argument type.

Server action

- Actions live in `actions/<entity>.ts` with `"use server"` at the top of the file.
- Start every action with `const { isAuthenticated, userId } = await auth()` from `@clerk/nextjs/server` and throw if not authenticated. Always take `userId` from the session, never from the input.
- Re-validate the input with `schema.parse()` in the action; client validation is not trusted.
- Store empty optional text as `null`, then `revalidatePath` the affected route and return the created row.

Form component

- Use `react-hook-form` with `zodResolver(schema)` and the same schema the action uses. Give every field a `defaultValues` entry (`""` for text).
- Compose with `FieldGroup` + `Controller` + `Field`: `data-invalid` on `Field`, `aria-invalid` on the control, errors through `<FieldError errors={[fieldState.error]} />`. Never lay out fields with raw `div`s and `Label`.
- Submit by calling the server action inside `form.handleSubmit`, wrapped in `try/catch`. Report success and failure with `toast.add` from `@/components/ui/toast`.
- While submitting, disable the submit button and show `<Spinner data-icon="inline-start" />`. Non-submit buttons inside the form need `type="button"`.
- Generate random values (seeds, ids) in a `useState(() => ...)` initializer or an event handler, never directly during render.

Forms in dialogs

- Keep the form in its own component rendered inside `DialogContent`, so it mounts on open and its state resets every time.
- The dialog component owns the `open` state and its `DialogTrigger`; the form closes it through an `onCreated`-style callback after success.
- Put `DialogFooter` inside the `<form>` so the submit button works, and use `DialogClose` for Cancel.

Dependencies

- `zod` must stay on v4. If `npm install` fails with a peer conflict from `@hookform/resolvers`, pin `zod@^4` in the same install command rather than using `--force` or `--legacy-peer-deps`.

## DiceBear

Use DiceBear 10. Documentation: https://www.dicebear.com/llms.txt

There are seven native cores with identical output, not one library with
wrappers. Use the one matching this project's language. Do not reach for the
JavaScript core when the project is written in something else:

    JavaScript  @dicebear/core + @dicebear/styles
    PHP         dicebear/core + dicebear/styles
    Python      dicebear-core + dicebear-styles
    Rust        dicebear-core + dicebear-styles
    Go          github.com/dicebear/dicebear-go/v10 + github.com/dicebear/styles/v10
    Dart        dicebear_core + dicebear_styles
    C#          DiceBear.Core + DiceBear.Styles

Every style page carries a loading snippet for all seven, for example
https://www.dicebear.com/styles/lorelei/index.md

HTTP API: https://api.dicebear.com/10.x/<style>/svg?seed=<seed> The seed is a
query parameter, not a path segment. Options are query parameters too; array
values are separated by commas.

Options named after a component end in Variant: eyesVariant, not eyes. This
holds in all seven cores and in the HTTP API. Look up the options of a style at
https://api.dicebear.com/10.x/<style>/options.json

Write these forms, not the ones on the left. The left column is pre-10 and the
API does not reject it, so an outdated call runs and silently does the wrong
thing:

    avatars.dicebear.com/api/<style>/<seed>.svg  ->  api.dicebear.com/10.x/<style>/svg?seed=<seed>
    api.dicebear.com/9.x/<style>/svg             ->  api.dicebear.com/10.x/<style>/svg
    npm install @dicebear/collection             ->  npm install @dicebear/styles
    npm install @dicebear/lorelei                ->  npm install @dicebear/styles
    createAvatar(lorelei, { seed })              ->  new Avatar(new Style(definition), { seed })
    { eyes: ['variant01'] }                      ->  { eyesVariant: ['variant01'] }
    ?radius=50                                   ->  ?borderRadius=50

Only JavaScript and the HTTP API have a pre-10 form. The other six cores were
released in 2026 and never had one, so any older-looking PHP, Python, Rust, Go,
Dart or C# API attributed to DiceBear is invented rather than outdated.

## Sentry

`@sentry/nextjs` reports errors, traces, replays and structured logs. Config: `instrumentation.ts`, `instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `app/global-error.tsx`, `withSentryConfig` in `next.config.ts`. The privacy rules all runtimes share live in `lib/sentry-privacy.ts`.

Environment variables (all optional):

    NEXT_PUBLIC_SENTRY_DSN   Without it Sentry is never initialized and nothing is sent
    SENTRY_ORG               Source map upload
    SENTRY_PROJECT           Source map upload
    SENTRY_AUTH_TOKEN        Source map upload; without it no source maps are uploaded

Browser events go through the tunnel route `/monitoring`; keep it excluded from the matcher in `proxy.ts`.

- Report server errors with `logError(context, error)` from `lib/log.ts`, never `console.error` with the error or `Sentry.captureException` directly. It sends only the error's kind, its stack and safe tags, never the message.
- Report business events through `events` in `lib/log.ts` with ids and counts only. Never prompts, notes, memory, bot instructions, file contents, sandbox ids or URLs.
- Call `identifyUser(userId)` after `auth()` in actions and routes. The Clerk user id is the only user data Sentry gets.
- Don't forward console output to Sentry and don't turn on any data collection (`dataCollection`, AI `recordInputs`/`recordOutputs`, request bodies, headers, cookies, local variables).

## Deployment

Production runs on Vercel (Hobby plan), built with `npm run build`. Node `>=22` (`engines` in `package.json`).

- Function time limit: Hobby stops a function at 300 s. `app/api/chat/route.ts` sets `maxDuration = 300` and its `stopWhen` starts no new step after 240 s, so a long reply ends on its own and `onEnd` still saves it. Keep that margin when adding steps or slow tools. `app/api/cron/meter-sandboxes/route.ts` sets `maxDuration = 60`.
- `/api/health` returns `{ "status": "ok" }` for uptime checks. It only says the server is up: keep it free of auth, database and service calls. Clerk's `proxy.ts` runs on it but protects nothing, so it is never redirected.
- The build and the server never need `.env.local`; Vercel provides the real environment. Anything that calls `process.loadEnvFile(".env.local")` (`drizzle.config.ts`) must check that the file exists first.
- `VERCEL_GIT_COMMIT_SHA` (set by Vercel) becomes the Sentry release name in `next.config.ts`.
- `@daytona/sdk` stays in `serverExternalPackages`. File tracing ships it, but misses `busboy` (and its dependency `streamsearch`), which the SDK `require`s at runtime to download files from a sandbox; `outputFileTracingIncludes` in `next.config.ts` adds them to `/api/chat`. A new route that reads sandbox files needs the same entry.

Environment variables the app needs in production (set them in the Vercel project for the Production environment; `NEXT_PUBLIC_*` are inlined at build time, so redeploy after changing them):

    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    CLERK_SECRET_KEY
    NEXT_PUBLIC_CLERK_SIGN_IN_URL
    NEXT_PUBLIC_CLERK_SIGN_UP_URL
    NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL
    NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL
    DATABASE_URL             Pooled connection, used by the app
    DATABASE_URL_UNPOOLED    Direct connection, used by drizzle-kit
    OPENAI_API_KEY
    DAYTONA_API_KEY
    CRON_SECRET              Shared with the external scheduler below
    NEXT_PUBLIC_SENTRY_DSN
    SENTRY_ORG
    SENTRY_PROJECT
    SENTRY_AUTH_TOKEN

Schema changes are not applied by the deploy. Push them from a local machine with `npm run db:push`, with `DATABASE_URL_UNPOOLED` pointing at the production Neon branch.

Vercel Cron on Hobby runs at most once a day, so the sandbox meter is called by an external scheduler (cron-job.org) instead. Don't add `crons` to a `vercel.json`. Every 5 minutes it sends:

    POST https://<production-domain>/api/cron/meter-sandboxes
    Authorization: Bearer <CRON_SECRET>

Without it running sandboxes are never metered or stopped when the allowance runs out.
