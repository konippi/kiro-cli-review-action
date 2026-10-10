import { delimiter, join } from 'node:path';

/** Parent environment keys forwarded to Kiro and its MCP servers. */
export const ALLOWED_ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'KIRO_DISABLE_TELEMETRY',
] as const;

interface KiroEnvironmentOptions {
  readonly kiroApiKey: string;
  readonly githubToken: string;
  readonly kiroHome: string;
  readonly kiroBinDir: string;
}

/** Builds the allowlisted parent environment for a Kiro process. */
export function buildKiroProcessEnv(
  parentEnv: NodeJS.ProcessEnv,
  kiroBinDir: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const key of ALLOWED_ENV_KEYS) {
    const value = parentEnv[key];
    if (value !== undefined) env[key] = value;
  }

  // The Kiro launcher resolves its sibling kiro-cli-chat through PATH.
  env.PATH = parentEnv.PATH ? `${kiroBinDir}${delimiter}${parentEnv.PATH}` : kiroBinDir;

  return env;
}

/** Builds the allowlisted environment that Kiro passes on to every MCP server it spawns. */
export function buildKiroEnv(
  parentEnv: NodeJS.ProcessEnv,
  options: KiroEnvironmentOptions,
): NodeJS.ProcessEnv {
  const env = buildKiroProcessEnv(parentEnv, options.kiroBinDir);

  env.CI = 'true';
  env.GITHUB_ACTIONS = 'true';
  env.TERM = 'dumb';

  if (typeof parentEnv.GITHUB_SERVER_URL === 'string') {
    const githubHost = new URL(parentEnv.GITHUB_SERVER_URL).origin;
    if (githubHost !== 'https://github.com') env.GITHUB_HOST = githubHost;
  }

  env.KIRO_API_KEY = options.kiroApiKey;
  if (options.githubToken !== '') env.GITHUB_PERSONAL_ACCESS_TOKEN = options.githubToken;

  env.KIRO_HOME = options.kiroHome;
  env.KIRO_AGENT_CONFIG_DIR = join(options.kiroHome, 'agents');

  return env;
}
