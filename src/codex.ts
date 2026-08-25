import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"

type OpenAIOAuth = {
  type: "oauth"
  access: string
  expires: number
  accountId?: string
}

export type CodexUsageWindow = {
  usedPercent: number
  windowSeconds?: number
  resetAfterSeconds?: number
  resetsAt?: number
}

export type CodexUsage = {
  planType?: string
  allowed?: boolean
  limitReached?: boolean
  primary?: CodexUsageWindow
  secondary?: CodexUsageWindow
  credits?: {
    hasCredits?: boolean
    unlimited?: boolean
    balance?: string
  }
}

export type CodexReport = {
  fetchedAt: number
  usage?: CodexUsage
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function parseWindow(value: unknown): CodexUsageWindow | undefined {
  if (!isRecord(value)) return
  const usedPercent = finiteNumber(value.used_percent)
  if (usedPercent === undefined) return
  return {
    usedPercent,
    windowSeconds: finiteNumber(value.limit_window_seconds),
    resetAfterSeconds: finiteNumber(value.reset_after_seconds),
    resetsAt: finiteNumber(value.reset_at),
  }
}

export function parseCodexUsage(value: unknown): CodexUsage {
  if (!isRecord(value)) throw new Error("Codex returned an unexpected response")
  const rateLimit = isRecord(value.rate_limit) ? value.rate_limit : {}
  const credits = isRecord(value.credits) ? value.credits : undefined

  return {
    planType: typeof value.plan_type === "string" ? value.plan_type : undefined,
    allowed: typeof rateLimit.allowed === "boolean" ? rateLimit.allowed : undefined,
    limitReached: typeof rateLimit.limit_reached === "boolean" ? rateLimit.limit_reached : undefined,
    primary: parseWindow(rateLimit.primary_window),
    secondary: parseWindow(rateLimit.secondary_window),
    credits: credits
      ? {
          hasCredits: typeof credits.has_credits === "boolean" ? credits.has_credits : undefined,
          unlimited: typeof credits.unlimited === "boolean" ? credits.unlimited : undefined,
          balance: typeof credits.balance === "string" ? credits.balance : undefined,
        }
      : undefined,
  }
}

function defaultAuthPath() {
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share")
  return join(dataHome, "opencode", "auth.json")
}

async function readOpenAIOAuth(): Promise<OpenAIOAuth | undefined> {
  let raw: unknown
  try {
    raw = JSON.parse(process.env.OPENCODE_AUTH_CONTENT ?? (await readFile(defaultAuthPath(), "utf8")))
  } catch {
    return
  }
  if (!isRecord(raw) || !isRecord(raw.openai)) return
  const auth = raw.openai
  if (auth.type !== "oauth" || typeof auth.access !== "string" || typeof auth.expires !== "number") return
  return {
    type: "oauth",
    access: auth.access,
    expires: auth.expires,
    accountId: typeof auth.accountId === "string" ? auth.accountId : undefined,
  }
}

export async function loadCodexReport(): Promise<CodexReport | undefined> {
  const auth = await readOpenAIOAuth()
  if (!auth) return

  const fetchedAt = Date.now()
  if (!auth.access || auth.expires <= fetchedAt) {
    return { fetchedAt, error: "OpenAI sign-in has expired. Reconnect OpenAI in OpenCode." }
  }

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${auth.access}`,
      "User-Agent": "opencode-usagex/0.1",
    }
    if (auth.accountId) headers["ChatGPT-Account-ID"] = auth.accountId

    const response = await fetch(CODEX_USAGE_URL, {
      headers,
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      const message = response.status === 401 || response.status === 403
        ? "OpenAI did not authorize Codex usage access. Reconnect OpenAI in OpenCode."
        : `OpenAI returned HTTP ${response.status}`
      return { fetchedAt, error: message }
    }
    return { fetchedAt, usage: parseCodexUsage(await response.json()) }
  } catch (error) {
    return { fetchedAt, error: error instanceof Error ? error.message : "Could not load Codex usage" }
  }
}
