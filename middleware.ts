// Vercel Edge Middleware — HTTP Basic Auth gate for the whole deployment.
// Vercel's own Password Protection is a paid Pro add-on; this is the free
// equivalent for a sandbox. Change the credentials here and push to rotate.

import { next } from "@vercel/edge";

const USER = "lab";
const PASS = "trail2026";

export const config = {
  // Everything except Vercel's internal endpoints.
  matcher: "/((?!_vercel).*)",
};

export default function middleware(req: Request): Response {
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Basic ${btoa(`${USER}:${PASS}`)}`) return next();
  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="image-trail-lab"' },
  });
}
