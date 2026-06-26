# Authentication

One-line: the entire console is gated behind Google Workspace SSO, restricted to the `civoren.com` domain, via Auth.js (NextAuth v5) middleware.

## How it works

- `src/auth.ts` — the single NextAuth config. One provider (Google), JWT sessions (no DB adapter). Two callbacks enforce the domain rule:
  - `signIn` — rejects any account that isn't Google, whose `email_verified` isn't `true`, or whose email domain isn't in `ALLOWED_DOMAINS`. This is the hard gate at login time.
  - `authorized` — re-checks the email domain on every request the middleware evaluates, so a previously-issued token can't outlive a tightened domain rule.
- `src/middleware.ts` — exports `auth` as the middleware. Every route except `api/auth/*`, Next internals, and static assets is gated; unauthenticated/unauthorized requests are redirected to the Auth.js sign-in page (`/api/auth/signin`).
- `src/app/api/auth/[...nextauth]/route.ts` — the Auth.js GET/POST handlers (sign-in, callback, sign-out, session).
- `src/app/layout.tsx` — server component; reads the session via `auth()` and renders the signed-in email + a sign-out button.

## The domain rule

Allowed domains come from `ALLOWED_AUTH_DOMAINS` (comma-separated), defaulting to `civoren.com`. The Google `hd` authorization param is set when exactly one domain is configured — but that's only a UX hint for the account chooser and is **not** a security boundary. The real enforcement is the server-side `signIn`/`authorized` domain check. Don't remove those callbacks.

## Required env vars

```
AUTH_SECRET=            # openssl rand -base64 33 — signs/encrypts the session JWT
AUTH_GOOGLE_ID=         # Google OAuth client ID
AUTH_GOOGLE_SECRET=     # Google OAuth client secret
ALLOWED_AUTH_DOMAINS=   # optional; defaults to "civoren.com"
AUTH_URL=               # canonical app URL in prod (e.g. https://console.civoren.com) — needed behind a proxy so OAuth redirects resolve correctly
AUTH_TRUST_HOST=true    # set on Railway/any non-Vercel host so Auth.js trusts the host header
```

## Google Cloud setup

In the Google Cloud Console (a project on the Civoren Workspace org), create an **OAuth 2.0 Client ID** of type "Web application" and add the authorized redirect URI:

```
https://<your-domain>/api/auth/callback/google
http://localhost:3000/api/auth/callback/google   # for local dev
```

Restricting the OAuth consent screen to "Internal" (Workspace-only) is an additional Google-side guard on top of the in-app domain check.
