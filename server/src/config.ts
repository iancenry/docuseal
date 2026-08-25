const FORBIDDEN_PORTS = new Set([3000, 8080]);

function readPort(name: string, fallback: number): number {
  const raw = process.env[name];
  const port = raw ? Number(raw) : fallback;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535, got: ${raw}`);
  }
  if (FORBIDDEN_PORTS.has(port)) {
    throw new Error(`${name}=${port} is reserved for the legacy Ruby stack; pick another port`);
  }
  return port;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5433/docuseal_dev',
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-only-secret-change-me',
  apiPort: readPort('PORT', 4300),
  webDevPort: readPort('WEB_DEV_PORT', 5174),
  jobPort: readPort('JOB_DASHBOARD_PORT', 4301),
} as const;

export type Config = typeof config;
