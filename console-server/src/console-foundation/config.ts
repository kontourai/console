import type {
  ConsoleHostedAuthToken,
  ConsoleHubServerOptions,
  ConsoleRuntimeMode,
  TelemetryStorageAdapterName
} from "./types";
import { resolveOAuthConfig, type ConsoleOAuthConfig } from "./oauth-resource";
import { resolveOAuthLoginConfig, isSecureOrLoopbackUrl, type ConsoleOAuthLoginConfig } from "./oidc-login";

export interface ConsoleRuntimeConfig {
  mode: ConsoleRuntimeMode;
  allowedOrigins: string[];
  defaultTenantId: string;
  hostedTenantIds: string[];
  hostedAuthTokens: ConsoleHostedAuthToken[];
  localAuthToken?: string;
  /**
   * OAuth 2.1 Resource-Server config (ADR 0003, Phase 1). Present ⇒ the console
   * additionally accepts OIDC-issued audience-bound JWTs and serves RFC 9728
   * Protected Resource Metadata. Absent ⇒ JWT path off, behavior unchanged.
   */
  oauth?: ConsoleOAuthConfig;
  /**
   * OIDC login (Authorization Code + PKCE) config for the console UI (ADR 0003,
   * Phase 2c). Present ⇒ `/auth/login` + `/auth/callback` are active. Absent ⇒
   * those routes 404 and nothing changes.
   */
  oauthLogin?: ConsoleOAuthLoginConfig;
  /**
   * Bearer token guarding `POST /ingest/flow`. Absent ⇒ the ingest endpoint is
   * disabled (returns 404). See `ConsoleHubServerOptions.ingestToken`.
   */
  ingestToken?: string;
  telemetryStorageAdapter: TelemetryStorageAdapterName;
  telemetryDatabaseUrl?: string;
  validation: ConsoleConfigValidationIssue[];
}

export interface ConsoleConfigValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
}

export function resolveConsoleRuntimeConfig(options: ConsoleHubServerOptions = {}, env: NodeJS.ProcessEnv = process.env): ConsoleRuntimeConfig {
  const mode = resolveRuntimeMode(options, env);
  const defaultTenantId = options.defaultTenantId || env.CONSOLE_TENANT_ID || "default";
  const hostedTenantIds = options.hostedTenantIds || parseCsv(env.CONSOLE_TENANT_ALLOWLIST);
  const hostedAuthTokens = normalizeAuthTokens(options.hostedAuthTokens || parseHostedAuthTokens(env, defaultTenantId));
  const localAuthToken = options.telemetryToken || env.CONSOLE_AUTH_TOKEN || env.CONSOLE_TELEMETRY_TOKEN;
  const ingestToken = options.ingestToken || env.CONSOLE_INGEST_TOKEN;
  const allowedOrigins = options.allowedOrigins || parseCsv(env.CONSOLE_ALLOWED_ORIGINS);
  const telemetryStorageAdapter = resolveTelemetryStorageAdapter(options, env);
  const telemetryDatabaseUrl = options.telemetryDatabaseUrl || env.CONSOLE_DATABASE_URL || env.CONSOLE_TELEMETRY_DATABASE_URL;
  const oauth = resolveOAuthConfig(env);
  const oauthLogin = resolveOAuthLoginConfig(env);
  const validation: ConsoleConfigValidationIssue[] = [];

  if (mode === "hosted") {
    if (telemetryStorageAdapter !== "postgres") {
      validation.push({
        severity: "error",
        code: "HOSTED_POSTGRES_REQUIRED",
        message: "hosted mode requires postgres telemetry storage"
      });
    }
    if (!telemetryDatabaseUrl && !options.telemetrySqlClient) {
      validation.push({
        severity: "error",
        code: "HOSTED_DATABASE_REQUIRED",
        message: "hosted mode requires a telemetry database URL or SQL client"
      });
    }
    if (!hostedAuthTokens.length) {
      validation.push({
        severity: "error",
        code: "HOSTED_AUTH_REQUIRED",
        message: "hosted mode requires at least one auth token"
      });
    }
    const unknownTenant = hostedAuthTokens.find((token) => hostedTenantIds.length && !hostedTenantIds.includes(token.tenantId));
    if (unknownTenant) {
      validation.push({
        severity: "error",
        code: "HOSTED_TENANT_NOT_ALLOWED",
        message: "hosted auth token references a tenant outside the allowlist"
      });
    }
    if (!allowedOrigins.length) {
      validation.push({
        severity: "warning",
        code: "HOSTED_ORIGINS_EMPTY",
        message: "hosted mode has no additional allowed origins configured"
      });
    }
  }

  // OIDC login (ADR 0003, Phase 2c) config checks.
  if (oauthLogin && !oauth) {
    validation.push({
      severity: "warning",
      code: "OAUTH_LOGIN_WITHOUT_RESOURCE_SERVER",
      message: "OIDC login is configured but CONSOLE_OAUTH_ISSUER/AUDIENCE are absent; /auth/login will 404"
    });
  }
  if (oauthLogin) {
    for (const [name, endpoint] of [["authorization", oauthLogin.authorizationEndpoint], ["token", oauthLogin.tokenEndpoint]] as const) {
      if (!isSecureOrLoopbackUrl(endpoint)) {
        validation.push({
          severity: "error",
          code: "OAUTH_ENDPOINT_INSECURE",
          message: `OIDC ${name} endpoint must be https (or http loopback for dev): ${endpoint}`
        });
      }
    }
  }
  // Core login envs present but login disabled — most often a missing state secret.
  if (!oauthLogin && env.CONSOLE_OAUTH_CLIENT_ID && env.CONSOLE_OAUTH_AUTHORIZATION_ENDPOINT) {
    validation.push({
      severity: "warning",
      code: "OAUTH_LOGIN_INCOMPLETE",
      message: "OIDC login env present but incomplete (require CONSOLE_OAUTH_STATE_SECRET + REDIRECT_URI + AUTHORIZATION/TOKEN endpoints); login disabled"
    });
  }

  return {
    mode,
    allowedOrigins,
    defaultTenantId,
    hostedTenantIds,
    hostedAuthTokens,
    localAuthToken,
    ingestToken,
    oauth,
    oauthLogin,
    telemetryStorageAdapter,
    telemetryDatabaseUrl,
    validation
  };
}

export function assertConsoleRuntimeConfig(config: ConsoleRuntimeConfig): void {
  const firstError = config.validation.find((issue) => issue.severity === "error");
  if (!firstError) return;
  const error = new Error(firstError.message) as Error & { code?: string; safeMessage?: string; statusCode?: number };
  error.code = firstError.code;
  error.safeMessage = firstError.message;
  error.statusCode = 500;
  throw error;
}

export function redactConsoleRuntimeConfig(config: ConsoleRuntimeConfig) {
  return {
    mode: config.mode,
    allowedOrigins: config.allowedOrigins,
    defaultTenantId: config.defaultTenantId,
    hostedTenantIds: config.hostedTenantIds,
    hostedAuthTokens: config.hostedAuthTokens.map((token) => ({
      tenantId: token.tenantId,
      label: token.label,
      token: token.token ? "[redacted]" : ""
    })),
    localAuthToken: config.localAuthToken ? "[redacted]" : undefined,
    ingestToken: config.ingestToken ? "[redacted]" : undefined,
    oauth: config.oauth
      ? { issuer: config.oauth.issuer, audience: config.oauth.audience, jwksUri: config.oauth.jwksUri, tenantClaims: config.oauth.tenantClaims }
      : undefined,
    oauthLogin: config.oauthLogin
      ? {
          clientId: config.oauthLogin.clientId,
          clientSecret: config.oauthLogin.clientSecret ? "[redacted]" : "",
          redirectUri: config.oauthLogin.redirectUri,
          authorizationEndpoint: config.oauthLogin.authorizationEndpoint,
          tokenEndpoint: config.oauthLogin.tokenEndpoint,
          scopes: config.oauthLogin.scopes,
          stateSecret: config.oauthLogin.stateSecret ? "[redacted]" : ""
        }
      : undefined,
    telemetryStorageAdapter: config.telemetryStorageAdapter,
    telemetryDatabaseUrl: config.telemetryDatabaseUrl ? "[redacted]" : undefined,
    validation: config.validation
  };
}

export function resolveTelemetryStorageAdapter(options: ConsoleHubServerOptions = {}, env: NodeJS.ProcessEnv = process.env): TelemetryStorageAdapterName {
  const configured = options.telemetryStorageAdapter
    || env.CONSOLE_TELEMETRY_STORAGE
    || "local-jsonl";
  if (configured === "local-jsonl" || configured === "sqlite" || configured === "postgres" || configured === "sql") return configured;
  return "local-jsonl";
}

function resolveRuntimeMode(options: ConsoleHubServerOptions, env: NodeJS.ProcessEnv): ConsoleRuntimeMode {
  const configured = options.runtimeMode || env.CONSOLE_RUNTIME_MODE || "local";
  return configured === "hosted" ? "hosted" : "local";
}

function parseHostedAuthTokens(env: NodeJS.ProcessEnv, defaultTenantId: string): ConsoleHostedAuthToken[] {
  if (env.CONSOLE_AUTH_TOKENS_JSON) {
    try {
      const parsed = JSON.parse(env.CONSOLE_AUTH_TOKENS_JSON);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item) => item && typeof item === "object" && typeof item.token === "string")
          .map((item) => ({
            token: item.token,
            tenantId: typeof item.tenantId === "string" ? item.tenantId : defaultTenantId,
            label: typeof item.label === "string" ? item.label : undefined
          }));
      }
    } catch {
      return [];
    }
  }
  const singleToken = env.CONSOLE_AUTH_TOKEN;
  return singleToken ? [{ token: singleToken, tenantId: defaultTenantId, label: "default" }] : [];
}

function normalizeAuthTokens(tokens: ConsoleHostedAuthToken[]): ConsoleHostedAuthToken[] {
  const seen = new Set<string>();
  return tokens.filter((token) => {
    if (!token.token || !token.tenantId || seen.has(token.token)) return false;
    seen.add(token.token);
    return true;
  });
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
