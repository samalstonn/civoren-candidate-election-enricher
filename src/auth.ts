import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Domain(s) allowed to sign in. Anyone whose Google account is outside these
 * Workspace domains is rejected at the `signIn` callback below.
 *
 * Defaults to `civoren.com`. Override/extend via the comma-separated
 * ALLOWED_AUTH_DOMAINS env var (e.g. "civoren.com,civoren.org").
 */
const ALLOWED_DOMAINS = (process.env.ALLOWED_AUTH_DOMAINS ?? "civoren.com")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

function emailDomainAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const domain = email.split("@")[1]?.toLowerCase();
  return !!domain && ALLOWED_DOMAINS.includes(domain);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      // `hd` hints Google to pre-filter the account chooser to the Workspace
      // domain. This is only a UX hint — it is NOT a security boundary and can
      // be bypassed, so we re-verify the domain server-side in `signIn` below.
      authorization: {
        params: {
          hd: ALLOWED_DOMAINS.length === 1 ? ALLOWED_DOMAINS[0] : undefined,
          prompt: "select_account",
        },
      },
    }),
  ],
  callbacks: {
    /**
     * Hard gate: only Google accounts whose verified email is on an allowed
     * Workspace domain may sign in. Returning false aborts the sign-in.
     */
    signIn({ account, profile }) {
      if (account?.provider !== "google") return false;
      // `email_verified` ensures the address actually belongs to the account.
      if (profile?.email_verified !== true) return false;
      return emailDomainAllowed(profile.email);
    },
    // Belt-and-suspenders: re-check on every session/jwt resolution so a token
    // can never outlive the domain rule (e.g. if ALLOWED_DOMAINS is tightened).
    authorized({ auth }) {
      return emailDomainAllowed(auth?.user?.email);
    },
  },
});
