/** @type {import('next').NextConfig} */

// The engine is a separate service: Vercel hosts this UI, the Python graph runs where it
// can hold a sandbox, a vector store and durable checkpoints. See web/README.md.
//
// In production the browser never calls the engine's own domain. It calls /engine/* on
// this site and Vercel proxies the request to Render. A cross-site call from the page to
// onrender.com was refused inside Brave with Shields on -- the health probe failed
// instantly, so the app sat on "Waking the tutoring engine" while the engine was up and
// Chrome worked. A same-origin path leaves a content blocker nothing cross-site to refuse.
// Vercel waits up to 120 s for an external origin's first byte; a probe that outlasts that
// during a cold start fails like any other probe and is retried.
//
// The engine URL is not a secret -- it is a public endpoint -- so it lives here rather than
// in a dashboard setting nobody can see. Development still calls localhost directly,
// because a `npm run dev` that silently drives the live service is a trap.
// NEXT_PUBLIC_API_URL overrides the base the browser uses; ENGINE_ORIGIN overrides where
// /engine/* is proxied.
const ENGINE = process.env.ENGINE_ORIGIN ?? "https://cogniflow-engine.onrender.com";

const nextConfig = {
  env: {
    NEXT_PUBLIC_API_URL:
      process.env.NEXT_PUBLIC_API_URL ??
      (process.env.NODE_ENV === "production" ? "/engine" : "http://127.0.0.1:8000"),
  },
  async rewrites() {
    return [{ source: "/engine/:path*", destination: `${ENGINE}/:path*` }];
  },
};
export default nextConfig;
