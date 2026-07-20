// Central auth + session middleware.
// All logic lives in proxy.ts; this file is the entry point Next.js requires.
export { proxy as middleware, config } from "./proxy";
