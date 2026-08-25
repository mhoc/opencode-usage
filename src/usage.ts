import { Database } from "bun:sqlite"
import { homedir } from "node:os"
import { join } from "node:path"
import { loadCodexReport, type CodexReport } from "./codex.ts"

export const PRICING_URL = "https://models.dev/api.json"

export const WINDOWS = [
  { id: "day", label: "Day", seconds: 24 * 60 * 60 },
  { id: "week", label: "Week", seconds: 7 * 24 * 60 * 60 },
  { id: "month", label: "Month", seconds: 30 * 24 * 60 * 60 },
  { id: "all", label: "All Time", seconds: null },
] as const

const TOKEN_FIELDS = ["input", "output", "reasoning", "cacheRead", "cacheWrite"] as const
const PRICING_TTL = 60 * 60 * 1000

type TokenField = (typeof TOKEN_FIELDS)[number]

export type UsageOptions = {
  db?: string
  pricingUrl?: string
}

export type ModelUsage = Record<TokenField, number> & {
  provider: string
  model: string
  messages: number
  real: number
  cache: number
  raw: number
  pricedCostUsd: number
  unpricedMessages: number
  pricingSource?: string
}

export type UsageWindow = {
  id: (typeof WINDOWS)[number]["id"]
  label: string
  startsAt?: number
  models: ModelUsage[]
  total: ModelUsage
}

export type UsageReport = {
  generatedAt: number
  dbPath: string
  pricingUrl: string
  pricingWarning?: string
  aliases: string[]
  unpriced: string[]
  codex?: CodexReport
  windows: UsageWindow[]
}

type UsageRecord = Record<TokenField, number> & {
  usageTime: number
  provider: string
  model: string
}

type Pricing = Record<string, unknown>
type Rates = Record<string, unknown>

let pricingCache: { url: string; expiresAt: number; data: Pricing } | undefined

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function defaultDatabasePath() {
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share")
  return join(dataHome, "opencode", "opencode.db")
}

function readUsage(dbPath: string): UsageRecord[] {
  const db = new Database(dbPath, { readonly: true, strict: true })
  try {
    const rows = db
      .query(
        `
          SELECT
            COALESCE(json_extract(data, '$.time.completed'), time_created) AS usageTime,
            json_extract(data, '$.providerID') AS provider,
            json_extract(data, '$.modelID') AS model,
            COALESCE(json_extract(data, '$.tokens.input'), 0) AS input,
            COALESCE(json_extract(data, '$.tokens.output'), 0) AS output,
            COALESCE(json_extract(data, '$.tokens.reasoning'), 0) AS reasoning,
            COALESCE(json_extract(data, '$.tokens.cache.read'), 0) AS cacheRead,
            COALESCE(json_extract(data, '$.tokens.cache.write'), 0) AS cacheWrite
          FROM message
          WHERE json_extract(data, '$.role') = 'assistant'
            AND (
                  COALESCE(json_extract(data, '$.tokens.input'), 0)
                + COALESCE(json_extract(data, '$.tokens.output'), 0)
                + COALESCE(json_extract(data, '$.tokens.reasoning'), 0)
                + COALESCE(json_extract(data, '$.tokens.cache.read'), 0)
                + COALESCE(json_extract(data, '$.tokens.cache.write'), 0)
            ) > 0
          ORDER BY usageTime
        `,
      )
      .all() as Record<string, unknown>[]

    return rows.map((row) => ({
      usageTime: Number(row.usageTime),
      provider: typeof row.provider === "string" ? row.provider : "unknown",
      model: typeof row.model === "string" ? row.model : "unknown",
      input: Number(row.input ?? 0),
      output: Number(row.output ?? 0),
      reasoning: Number(row.reasoning ?? 0),
      cacheRead: Number(row.cacheRead ?? 0),
      cacheWrite: Number(row.cacheWrite ?? 0),
    }))
  } finally {
    db.close(false)
  }
}

async function loadPricing(url: string): Promise<Pricing> {
  if (pricingCache?.url === url && pricingCache.expiresAt > Date.now()) return pricingCache.data

  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "opencode-usagex/0.1" },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`models.dev returned HTTP ${response.status}`)
  const data: unknown = await response.json()
  if (!isRecord(data)) throw new Error("models.dev returned an unexpected response")

  pricingCache = { url, expiresAt: Date.now() + PRICING_TTL, data }
  return data
}

function resolveModel(pricing: Pricing, provider: string, model: string) {
  const providerData = pricing[provider]
  if (!isRecord(providerData) || !isRecord(providerData.models)) return {}

  const candidates = [model]
  if (model.endsWith("-fast")) candidates.push(model.slice(0, -"-fast".length))

  for (const candidate of candidates) {
    const modelData = providerData.models[candidate]
    if (!isRecord(modelData) || !isRecord(modelData.cost)) continue
    return { modelData, source: `${provider}/${candidate}` }
  }
  return {}
}

function ratesForUsage(modelData: Record<string, unknown>, usage: UsageRecord): Rates {
  const rates = { ...(modelData.cost as Rates) }
  const contextTokens = usage.input + usage.cacheRead + usage.cacheWrite
  if (!Array.isArray(rates.tiers)) return rates

  const tiers = rates.tiers
    .filter(isRecord)
    .map((tier) => ({ rates: tier, tier: isRecord(tier.tier) ? tier.tier : {} }))
    .filter((item) => item.tier.type === "context" && typeof item.tier.size === "number")
    .sort((left, right) => Number(left.tier.size) - Number(right.tier.size))

  for (const item of tiers) {
    if (contextTokens <= Number(item.tier.size)) continue
    for (const [key, value] of Object.entries(item.rates)) {
      if (key !== "tier") rates[key] = value
    }
  }
  return rates
}

function estimateCost(modelData: Record<string, unknown> | undefined, usage: UsageRecord) {
  if (!modelData) return undefined
  const rates = ratesForUsage(modelData, usage)
  const categoryRates: Record<TokenField, unknown> = {
    input: rates.input,
    output: rates.output,
    reasoning: rates.reasoning ?? rates.output,
    cacheRead: rates.cache_read,
    cacheWrite: rates.cache_write,
  }

  for (const field of TOKEN_FIELDS) {
    if (usage[field] > 0 && typeof categoryRates[field] !== "number") return undefined
  }

  return TOKEN_FIELDS.reduce(
    (total, field) => total + (usage[field] * Number(categoryRates[field] ?? 0)) / 1_000_000,
    0,
  )
}

function emptyUsage(provider = "", model = ""): ModelUsage {
  return {
    provider,
    model,
    messages: 0,
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    real: 0,
    cache: 0,
    raw: 0,
    pricedCostUsd: 0,
    unpricedMessages: 0,
  }
}

function finishUsage(usage: ModelUsage) {
  usage.real = usage.input + usage.output + usage.reasoning
  usage.cache = usage.cacheRead + usage.cacheWrite
  usage.raw = usage.real + usage.cache
  return usage
}

function aggregate(records: UsageRecord[], pricing: Pricing, cutoff?: number) {
  const models = new Map<string, ModelUsage>()
  const resolved = new Map<string, ReturnType<typeof resolveModel>>()

  for (const record of records) {
    if (cutoff !== undefined && record.usageTime < cutoff) continue
    const key = `${record.provider}/${record.model}`
    let usage = models.get(key)
    if (!usage) {
      usage = emptyUsage(record.provider, record.model)
      models.set(key, usage)
    }

    usage.messages += 1
    for (const field of TOKEN_FIELDS) usage[field] += record[field]

    let price = resolved.get(key)
    if (!price) {
      price = resolveModel(pricing, record.provider, record.model)
      resolved.set(key, price)
    }
    const cost = estimateCost(price.modelData, record)
    if (cost === undefined) {
      usage.unpricedMessages += 1
    } else {
      usage.pricedCostUsd += cost
      usage.pricingSource = price.source
    }
  }

  const result = [...models.values()].map(finishUsage).sort((left, right) => right.raw - left.raw)
  const total = emptyUsage("", "TOTAL")
  for (const usage of result) {
    total.messages += usage.messages
    for (const field of TOKEN_FIELDS) total[field] += usage[field]
    total.pricedCostUsd += usage.pricedCostUsd
    total.unpricedMessages += usage.unpricedMessages
  }
  return { models: result, total: finishUsage(total) }
}

export async function loadUsageReport(options: UsageOptions = {}): Promise<UsageReport> {
  const generatedAt = Date.now()
  const dbPath = options.db ?? defaultDatabasePath()
  const pricingUrl = options.pricingUrl ?? PRICING_URL
  const records = readUsage(dbPath)

  let pricing: Pricing = {}
  let pricingWarning: string | undefined
  const [pricingResult, codex] = await Promise.all([
    loadPricing(pricingUrl).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    ),
    loadCodexReport(),
  ])
  if ("value" in pricingResult) pricing = pricingResult.value
  else pricingWarning = pricingResult.error instanceof Error ? pricingResult.error.message : String(pricingResult.error)

  const aliases = new Set<string>()
  const unpriced = new Set<string>()
  const windows = WINDOWS.map((window): UsageWindow => {
    const startsAt = window.seconds === null ? undefined : generatedAt - window.seconds * 1000
    const result = aggregate(records, pricing, startsAt)
    for (const usage of result.models) {
      const recorded = `${usage.provider}/${usage.model}`
      if (usage.pricingSource && usage.pricingSource !== recorded) aliases.add(`${recorded} -> ${usage.pricingSource}`)
      if (usage.unpricedMessages) unpriced.add(recorded)
    }
    return { id: window.id, label: window.label, startsAt, ...result }
  })

  return {
    generatedAt,
    dbPath,
    pricingUrl,
    pricingWarning,
    aliases: [...aliases].sort(),
    unpriced: [...unpriced].sort(),
    codex,
    windows,
  }
}

export function formatInteger(value: number) {
  return Math.round(value).toLocaleString("en-US")
}

export function formatCompact(value: number) {
  const absolute = Math.abs(value)
  if (absolute < 1_000) return Math.round(value).toString()
  if (absolute < 1_000_000) return `${(value / 1_000).toFixed(absolute < 10_000 ? 1 : 0)}K`
  if (absolute < 1_000_000_000) return `${(value / 1_000_000).toFixed(absolute < 10_000_000 ? 1 : 0)}M`
  return `${(value / 1_000_000_000).toFixed(absolute < 10_000_000_000 ? 1 : 0)}B`
}

export function formatCost(usage: Pick<ModelUsage, "pricedCostUsd" | "unpricedMessages">) {
  if (usage.unpricedMessages && usage.pricedCostUsd === 0) return "N/A"
  const value = `$${usage.pricedCostUsd.toFixed(4)}`
  return usage.unpricedMessages ? `${value}+?` : value
}
