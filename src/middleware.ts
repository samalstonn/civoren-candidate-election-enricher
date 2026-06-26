import { auth } from "@/auth";

/**
 * Gate the entire site behind Google Workspace SSO. Unauthenticated requests
 * (or accounts outside the allowed domain) are redirected to the sign-in page
 * by Auth.js. The `authorized` callback in `src/auth.ts` enforces the domain.
 */
export default auth;

export const config = {
  // Run on everything except Next internals, the auth endpoints themselves,
  // and static assets — otherwise the sign-in page redirect would loop.
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|woff2?)$).*)",
  ],
};
