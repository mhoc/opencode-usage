// @bun
// src/index.tsx
import { createComponent as _$createComponent } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { useTerminalDimensions } from "@opentui/solid";
import { useBindings } from "@opentui/keymap/solid";
import { createResource, createSignal, For, Show } from "solid-js";

// src/usage.ts
import { Database } from "bun:sqlite";
import { homedir as homedir2 } from "os";
import { join as join2 } from "path";

// src/codex.ts
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
var CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function parseWindow(value) {
  if (!isRecord(value))
    return;
  const usedPercent = finiteNumber(value.used_percent);
  if (usedPercent === undefined)
    return;
  return {
    usedPercent,
    windowSeconds: finiteNumber(value.limit_window_seconds),
    resetAfterSeconds: finiteNumber(value.reset_after_seconds),
    resetsAt: finiteNumber(value.reset_at)
  };
}
function parseCodexUsage(value) {
  if (!isRecord(value))
    throw new Error("Codex returned an unexpected response");
  const rateLimit = isRecord(value.rate_limit) ? value.rate_limit : {};
  const credits = isRecord(value.credits) ? value.credits : undefined;
  return {
    planType: typeof value.plan_type === "string" ? value.plan_type : undefined,
    allowed: typeof rateLimit.allowed === "boolean" ? rateLimit.allowed : undefined,
    limitReached: typeof rateLimit.limit_reached === "boolean" ? rateLimit.limit_reached : undefined,
    primary: parseWindow(rateLimit.primary_window),
    secondary: parseWindow(rateLimit.secondary_window),
    credits: credits ? {
      hasCredits: typeof credits.has_credits === "boolean" ? credits.has_credits : undefined,
      unlimited: typeof credits.unlimited === "boolean" ? credits.unlimited : undefined,
      balance: typeof credits.balance === "string" ? credits.balance : undefined
    } : undefined
  };
}
function defaultAuthPath() {
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(dataHome, "opencode", "auth.json");
}
async function readOpenAIOAuth() {
  let raw;
  try {
    raw = JSON.parse(process.env.OPENCODE_AUTH_CONTENT ?? await readFile(defaultAuthPath(), "utf8"));
  } catch {
    return;
  }
  if (!isRecord(raw) || !isRecord(raw.openai))
    return;
  const auth = raw.openai;
  if (auth.type !== "oauth" || typeof auth.access !== "string" || typeof auth.expires !== "number")
    return;
  return {
    type: "oauth",
    access: auth.access,
    expires: auth.expires,
    accountId: typeof auth.accountId === "string" ? auth.accountId : undefined
  };
}
async function loadCodexReport() {
  const auth = await readOpenAIOAuth();
  if (!auth)
    return;
  const fetchedAt = Date.now();
  if (!auth.access || auth.expires <= fetchedAt) {
    return { fetchedAt, error: "OpenAI sign-in has expired. Reconnect OpenAI in OpenCode." };
  }
  try {
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${auth.access}`,
      "User-Agent": "opencode-usagex/0.1"
    };
    if (auth.accountId)
      headers["ChatGPT-Account-ID"] = auth.accountId;
    const response = await fetch(CODEX_USAGE_URL, {
      headers,
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      const message = response.status === 401 || response.status === 403 ? "OpenAI did not authorize Codex usage access. Reconnect OpenAI in OpenCode." : `OpenAI returned HTTP ${response.status}`;
      return { fetchedAt, error: message };
    }
    return { fetchedAt, usage: parseCodexUsage(await response.json()) };
  } catch (error) {
    return { fetchedAt, error: error instanceof Error ? error.message : "Could not load Codex usage" };
  }
}

// src/usage.ts
var PRICING_URL = "https://models.dev/api.json";
var WINDOWS = [
  { id: "day", label: "Day", seconds: 24 * 60 * 60 },
  { id: "week", label: "Week", seconds: 7 * 24 * 60 * 60 },
  { id: "month", label: "Month", seconds: 30 * 24 * 60 * 60 },
  { id: "all", label: "All Time", seconds: null }
];
var TOKEN_FIELDS = ["input", "output", "reasoning", "cacheRead", "cacheWrite"];
var PRICING_TTL = 60 * 60 * 1000;
var pricingCache;
function isRecord2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function defaultDatabasePath() {
  const dataHome = process.env.XDG_DATA_HOME ?? join2(homedir2(), ".local", "share");
  return join2(dataHome, "opencode", "opencode.db");
}
function readUsage(dbPath) {
  const db = new Database(dbPath, { readonly: true, strict: true });
  try {
    const rows = db.query(`
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
        `).all();
    return rows.map((row) => ({
      usageTime: Number(row.usageTime),
      provider: typeof row.provider === "string" ? row.provider : "unknown",
      model: typeof row.model === "string" ? row.model : "unknown",
      input: Number(row.input ?? 0),
      output: Number(row.output ?? 0),
      reasoning: Number(row.reasoning ?? 0),
      cacheRead: Number(row.cacheRead ?? 0),
      cacheWrite: Number(row.cacheWrite ?? 0)
    }));
  } finally {
    db.close(false);
  }
}
async function loadPricing(url) {
  if (pricingCache?.url === url && pricingCache.expiresAt > Date.now())
    return pricingCache.data;
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "opencode-usagex/0.1" },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok)
    throw new Error(`models.dev returned HTTP ${response.status}`);
  const data = await response.json();
  if (!isRecord2(data))
    throw new Error("models.dev returned an unexpected response");
  pricingCache = { url, expiresAt: Date.now() + PRICING_TTL, data };
  return data;
}
function resolveModel(pricing, provider, model) {
  const providerData = pricing[provider];
  if (!isRecord2(providerData) || !isRecord2(providerData.models))
    return {};
  const candidates = [model];
  if (model.endsWith("-fast"))
    candidates.push(model.slice(0, -"-fast".length));
  for (const candidate of candidates) {
    const modelData = providerData.models[candidate];
    if (!isRecord2(modelData) || !isRecord2(modelData.cost))
      continue;
    return { modelData, source: `${provider}/${candidate}` };
  }
  return {};
}
function ratesForUsage(modelData, usage) {
  const rates = { ...modelData.cost };
  const contextTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  if (!Array.isArray(rates.tiers))
    return rates;
  const tiers = rates.tiers.filter(isRecord2).map((tier) => ({ rates: tier, tier: isRecord2(tier.tier) ? tier.tier : {} })).filter((item) => item.tier.type === "context" && typeof item.tier.size === "number").sort((left, right) => Number(left.tier.size) - Number(right.tier.size));
  for (const item of tiers) {
    if (contextTokens <= Number(item.tier.size))
      continue;
    for (const [key, value] of Object.entries(item.rates)) {
      if (key !== "tier")
        rates[key] = value;
    }
  }
  return rates;
}
function estimateCost(modelData, usage) {
  if (!modelData)
    return;
  const rates = ratesForUsage(modelData, usage);
  const categoryRates = {
    input: rates.input,
    output: rates.output,
    reasoning: rates.reasoning ?? rates.output,
    cacheRead: rates.cache_read,
    cacheWrite: rates.cache_write
  };
  for (const field of TOKEN_FIELDS) {
    if (usage[field] > 0 && typeof categoryRates[field] !== "number")
      return;
  }
  return TOKEN_FIELDS.reduce((total, field) => total + usage[field] * Number(categoryRates[field] ?? 0) / 1e6, 0);
}
function emptyUsage(provider = "", model = "") {
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
    unpricedMessages: 0
  };
}
function finishUsage(usage) {
  usage.real = usage.input + usage.output + usage.reasoning;
  usage.cache = usage.cacheRead + usage.cacheWrite;
  usage.raw = usage.real + usage.cache;
  return usage;
}
function aggregate(records, pricing, cutoff) {
  const models = new Map;
  const resolved = new Map;
  for (const record of records) {
    if (cutoff !== undefined && record.usageTime < cutoff)
      continue;
    const key = `${record.provider}/${record.model}`;
    let usage = models.get(key);
    if (!usage) {
      usage = emptyUsage(record.provider, record.model);
      models.set(key, usage);
    }
    usage.messages += 1;
    for (const field of TOKEN_FIELDS)
      usage[field] += record[field];
    let price = resolved.get(key);
    if (!price) {
      price = resolveModel(pricing, record.provider, record.model);
      resolved.set(key, price);
    }
    const cost = estimateCost(price.modelData, record);
    if (cost === undefined) {
      usage.unpricedMessages += 1;
    } else {
      usage.pricedCostUsd += cost;
      usage.pricingSource = price.source;
    }
  }
  const result = [...models.values()].map(finishUsage).sort((left, right) => right.raw - left.raw);
  const total = emptyUsage("", "TOTAL");
  for (const usage of result) {
    total.messages += usage.messages;
    for (const field of TOKEN_FIELDS)
      total[field] += usage[field];
    total.pricedCostUsd += usage.pricedCostUsd;
    total.unpricedMessages += usage.unpricedMessages;
  }
  return { models: result, total: finishUsage(total) };
}
async function loadUsageReport(options = {}) {
  const generatedAt = Date.now();
  const dbPath = options.db ?? defaultDatabasePath();
  const pricingUrl = options.pricingUrl ?? PRICING_URL;
  const records = readUsage(dbPath);
  let pricing = {};
  let pricingWarning;
  const [pricingResult, codex] = await Promise.all([
    loadPricing(pricingUrl).then((value) => ({ value }), (error) => ({ error })),
    loadCodexReport()
  ]);
  if ("value" in pricingResult)
    pricing = pricingResult.value;
  else
    pricingWarning = pricingResult.error instanceof Error ? pricingResult.error.message : String(pricingResult.error);
  const aliases = new Set;
  const unpriced = new Set;
  const windows = WINDOWS.map((window) => {
    const startsAt = window.seconds === null ? undefined : generatedAt - window.seconds * 1000;
    const result = aggregate(records, pricing, startsAt);
    for (const usage of result.models) {
      const recorded = `${usage.provider}/${usage.model}`;
      if (usage.pricingSource && usage.pricingSource !== recorded)
        aliases.add(`${recorded} -> ${usage.pricingSource}`);
      if (usage.unpricedMessages)
        unpriced.add(recorded);
    }
    return { id: window.id, label: window.label, startsAt, ...result };
  });
  return {
    generatedAt,
    dbPath,
    pricingUrl,
    pricingWarning,
    aliases: [...aliases].sort(),
    unpriced: [...unpriced].sort(),
    codex,
    windows
  };
}
function formatInteger(value) {
  return Math.round(value).toLocaleString("en-US");
}
function formatCompact(value) {
  const absolute = Math.abs(value);
  if (absolute < 1000)
    return Math.round(value).toString();
  if (absolute < 1e6)
    return `${(value / 1000).toFixed(absolute < 1e4 ? 1 : 0)}K`;
  if (absolute < 1e9)
    return `${(value / 1e6).toFixed(absolute < 1e7 ? 1 : 0)}M`;
  return `${(value / 1e9).toFixed(absolute < 10000000000 ? 1 : 0)}B`;
}
function formatCost(usage) {
  if (usage.unpricedMessages && usage.pricedCostUsd === 0)
    return "N/A";
  const value = `$${usage.pricedCostUsd.toFixed(4)}`;
  return usage.unpricedMessages ? `${value}+?` : value;
}

// src/index.tsx
var ROUTE = "usagex.modal";
var command = {
  open: "usagex.open"
};
function truncate(value, width) {
  if (value.length <= width)
    return value;
  if (width <= 1)
    return value.slice(0, width);
  return `${value.slice(0, width - 1)}\u2026`;
}
function formatStart(value) {
  return value === undefined ? "All recorded usage" : `Since ${new Date(value).toLocaleString()}`;
}
function Cell(props) {
  return (() => {
    var _el$ = _$createElement("box"), _el$2 = _$createElement("text");
    _$insertNode(_el$, _el$2);
    _$setProp(_el$, "flexShrink", 0);
    _$insert(_el$2, (() => {
      var _c$ = _$memo(() => !!props.bold);
      return () => _c$() ? (() => {
        var _el$3 = _$createElement("b");
        _$insert(_el$3, () => props.value);
        return _el$3;
      })() : props.value;
    })());
    _$effect((_p$) => {
      var _v$ = props.width, _v$2 = props.right ? "flex-end" : "flex-start", _v$3 = props.color;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$, "width", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$, "justifyContent", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp(_el$2, "fg", _v$3, _p$.a));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined
    });
    return _el$;
  })();
}
function SummaryCard(props) {
  return (() => {
    var _el$4 = _$createElement("box"), _el$5 = _$createElement("text"), _el$6 = _$createElement("text"), _el$7 = _$createElement("b");
    _$insertNode(_el$4, _el$5);
    _$insertNode(_el$4, _el$6);
    _$setProp(_el$4, "flexDirection", "column");
    _$setProp(_el$4, "flexGrow", 1);
    _$insert(_el$5, () => props.label);
    _$insertNode(_el$6, _el$7);
    _$insert(_el$7, () => props.value);
    _$effect((_p$) => {
      var { muted: _v$4, color: _v$5 } = props;
      _v$4 !== _p$.e && (_p$.e = _$setProp(_el$5, "fg", _v$4, _p$.e));
      _v$5 !== _p$.t && (_p$.t = _$setProp(_el$6, "fg", _v$5, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$4;
  })();
}
function formatDuration(seconds) {
  if (seconds === undefined)
    return "Usage";
  if (seconds % 604800 === 0)
    return `${seconds / 604800} week`;
  if (seconds % 86400 === 0)
    return `${seconds / 86400} day`;
  if (seconds % 3600 === 0)
    return `${seconds / 3600} hour`;
  return `${Math.round(seconds / 60)} minute`;
}
function formatReset(window, fetchedAt) {
  const seconds = window.resetAfterSeconds ?? (window.resetsAt ? window.resetsAt - fetchedAt / 1000 : undefined);
  if (seconds === undefined)
    return "Reset time unavailable";
  const safe = Math.max(0, seconds);
  const days = Math.floor(safe / 86400);
  const hours = Math.floor(safe % 86400 / 3600);
  const minutes = Math.ceil(safe % 3600 / 60);
  const relative = days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  const at = window.resetsAt ? new Date(window.resetsAt * 1000).toLocaleString() : undefined;
  return `Resets in ${relative}${at ? ` \xB7 ${at}` : ""}`;
}
function CodexWindowCard(props) {
  const theme = props.api.theme.current;
  const used = Math.max(0, Math.min(100, props.window.usedPercent));
  const width = props.compact ? 18 : 28;
  const filled = Math.round(used / 100 * width);
  const color = used >= 90 ? theme.error : used >= 70 ? theme.warning : theme.primary;
  return (() => {
    var _el$8 = _$createElement("box"), _el$9 = _$createElement("box"), _el$0 = _$createElement("text"), _el$1 = _$createElement("text"), _el$10 = _$createElement("b"), _el$11 = _$createTextNode(`% used`), _el$12 = _$createElement("text"), _el$13 = _$createElement("span"), _el$14 = _$createElement("span"), _el$15 = _$createElement("text"), _el$16 = _$createTextNode(`% remaining`), _el$17 = _$createElement("text");
    _$insertNode(_el$8, _el$9);
    _$insertNode(_el$8, _el$12);
    _$insertNode(_el$8, _el$15);
    _$insertNode(_el$8, _el$17);
    _$setProp(_el$8, "flexDirection", "column");
    _$setProp(_el$8, "flexGrow", 1);
    _$setProp(_el$8, "border", true);
    _$setProp(_el$8, "paddingLeft", 2);
    _$setProp(_el$8, "paddingRight", 2);
    _$setProp(_el$8, "gap", 1);
    _$insertNode(_el$9, _el$0);
    _$insertNode(_el$9, _el$1);
    _$setProp(_el$9, "flexDirection", "row");
    _$setProp(_el$9, "justifyContent", "space-between");
    _$insert(_el$0, () => props.title.toUpperCase());
    _$insertNode(_el$1, _el$10);
    _$setProp(_el$1, "fg", color);
    _$insertNode(_el$10, _el$11);
    _$insert(_el$10, () => Math.round(used), _el$11);
    _$insertNode(_el$12, _el$13);
    _$insertNode(_el$12, _el$14);
    _$setProp(_el$13, "style", {
      fg: color
    });
    _$insert(_el$13, () => "\u2588".repeat(filled));
    _$insert(_el$14, () => "\u2591".repeat(width - filled));
    _$insertNode(_el$15, _el$16);
    _$insert(_el$15, () => Math.max(0, Math.round(100 - used)), _el$16);
    _$insert(_el$17, () => formatReset(props.window, props.fetchedAt));
    _$effect((_p$) => {
      var { border: _v$6, textMuted: _v$7 } = theme, _v$8 = {
        fg: theme.backgroundElement
      }, _v$9 = theme.text, _v$0 = theme.textMuted;
      _v$6 !== _p$.e && (_p$.e = _$setProp(_el$8, "borderColor", _v$6, _p$.e));
      _v$7 !== _p$.t && (_p$.t = _$setProp(_el$0, "fg", _v$7, _p$.t));
      _v$8 !== _p$.a && (_p$.a = _$setProp(_el$14, "style", _v$8, _p$.a));
      _v$9 !== _p$.o && (_p$.o = _$setProp(_el$15, "fg", _v$9, _p$.o));
      _v$0 !== _p$.i && (_p$.i = _$setProp(_el$17, "fg", _v$0, _p$.i));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined
    });
    return _el$8;
  })();
}
function CodexView(props) {
  const theme = props.api.theme.current;
  const usage = () => props.report.usage;
  const plan = () => usage()?.planType?.replaceAll("_", " ");
  return (() => {
    var _el$18 = _$createElement("box"), _el$19 = _$createElement("box"), _el$20 = _$createElement("text"), _el$21 = _$createElement("b"), _el$26 = _$createElement("box"), _el$27 = _$createElement("text"), _el$28 = _$createTextNode(`OpenAI subscription data \xB7 updated `), _el$29 = _$createTextNode(` \xB7 r to refresh`);
    _$insertNode(_el$18, _el$19);
    _$insertNode(_el$18, _el$26);
    _$insertNode(_el$18, _el$27);
    _$setProp(_el$18, "flexDirection", "column");
    _$setProp(_el$18, "flexGrow", 1);
    _$setProp(_el$18, "gap", 1);
    _$insertNode(_el$19, _el$20);
    _$setProp(_el$19, "flexDirection", "row");
    _$setProp(_el$19, "justifyContent", "space-between");
    _$insertNode(_el$20, _el$21);
    _$insertNode(_el$21, _$createTextNode(`Codex subscription limits`));
    _$insert(_el$20, _$createComponent(Show, {
      get when() {
        return plan();
      },
      children: (value) => (() => {
        var _el$30 = _$createElement("span"), _el$31 = _$createTextNode(` `);
        _$insertNode(_el$30, _el$31);
        _$insert(_el$30, value, null);
        _$effect((_$p) => _$setProp(_el$30, "style", {
          fg: theme.textMuted
        }, _$p));
        return _el$30;
      })()
    }), null);
    _$insert(_el$19, _$createComponent(Show, {
      get when() {
        return usage()?.limitReached;
      },
      get children() {
        var _el$23 = _$createElement("text"), _el$24 = _$createElement("b");
        _$insertNode(_el$23, _el$24);
        _$insertNode(_el$24, _$createTextNode(`LIMIT REACHED`));
        _$effect((_$p) => _$setProp(_el$23, "fg", theme.error, _$p));
        return _el$23;
      }
    }), null);
    _$insert(_el$18, _$createComponent(Show, {
      get when() {
        return props.report.error;
      },
      children: (error) => (() => {
        var _el$32 = _$createElement("box"), _el$33 = _$createElement("text");
        _$insertNode(_el$32, _el$33);
        _$setProp(_el$32, "border", true);
        _$setProp(_el$32, "paddingLeft", 2);
        _$setProp(_el$32, "paddingRight", 2);
        _$insert(_el$33, error);
        _$effect((_p$) => {
          var { error: _v$11, error: _v$12 } = theme;
          _v$11 !== _p$.e && (_p$.e = _$setProp(_el$32, "borderColor", _v$11, _p$.e));
          _v$12 !== _p$.t && (_p$.t = _$setProp(_el$33, "fg", _v$12, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$32;
      })()
    }), _el$26);
    _$insert(_el$18, _$createComponent(Show, {
      get when() {
        return usage();
      },
      children: (data) => [(() => {
        var _el$34 = _$createElement("box");
        _$setProp(_el$34, "gap", 1);
        _$insert(_el$34, _$createComponent(Show, {
          get when() {
            return data().primary;
          },
          children: (window) => _$createComponent(CodexWindowCard, {
            get title() {
              return `${formatDuration(window().windowSeconds)} limit`;
            },
            get window() {
              return window();
            },
            get fetchedAt() {
              return props.report.fetchedAt;
            },
            get api() {
              return props.api;
            },
            get compact() {
              return props.compact;
            }
          })
        }), null);
        _$insert(_el$34, _$createComponent(Show, {
          get when() {
            return data().secondary;
          },
          children: (window) => _$createComponent(CodexWindowCard, {
            get title() {
              return `${formatDuration(window().windowSeconds)} limit`;
            },
            get window() {
              return window();
            },
            get fetchedAt() {
              return props.report.fetchedAt;
            },
            get api() {
              return props.api;
            },
            get compact() {
              return props.compact;
            }
          })
        }), null);
        _$effect((_$p) => _$setProp(_el$34, "flexDirection", props.compact ? "column" : "row", _$p));
        return _el$34;
      })(), _$createComponent(Show, {
        get when() {
          return _$memo(() => !!!data().primary)() && !data().secondary;
        },
        get children() {
          var _el$35 = _$createElement("text");
          _$insertNode(_el$35, _$createTextNode(`OpenAI returned no Codex usage windows.`));
          _$effect((_$p) => _$setProp(_el$35, "fg", theme.textMuted, _$p));
          return _el$35;
        }
      }), _$createComponent(Show, {
        get when() {
          return data().credits?.unlimited || data().credits?.balance;
        },
        get children() {
          var _el$37 = _$createElement("text"), _el$38 = _$createTextNode(`Credits: `);
          _$insertNode(_el$37, _el$38);
          _$insert(_el$37, (() => {
            var _c$2 = _$memo(() => !!data().credits?.unlimited);
            return () => _c$2() ? "Unlimited" : data().credits?.balance;
          })(), null);
          _$effect((_$p) => _$setProp(_el$37, "fg", theme.textMuted, _$p));
          return _el$37;
        }
      })]
    }), _el$26);
    _$setProp(_el$26, "flexGrow", 1);
    _$insertNode(_el$27, _el$28);
    _$insertNode(_el$27, _el$29);
    _$insert(_el$27, () => new Date(props.report.fetchedAt).toLocaleTimeString(), _el$29);
    _$effect((_p$) => {
      var { text: _v$1, textMuted: _v$10 } = theme;
      _v$1 !== _p$.e && (_p$.e = _$setProp(_el$20, "fg", _v$1, _p$.e));
      _v$10 !== _p$.t && (_p$.t = _$setProp(_el$27, "fg", _v$10, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$18;
  })();
}
function ModelRow(props) {
  const theme = props.api.theme.current;
  const name = `${props.usage.provider}/${props.usage.model}`;
  return (() => {
    var _el$39 = _$createElement("box"), _el$40 = _$createElement("box"), _el$41 = _$createElement("text");
    _$insertNode(_el$39, _el$40);
    _$insertNode(_el$39, _el$41);
    _$setProp(_el$39, "flexDirection", "column");
    _$setProp(_el$40, "flexDirection", "row");
    _$setProp(_el$40, "gap", 1);
    _$insert(_el$40, _$createComponent(Cell, {
      get width() {
        return props.modelWidth;
      },
      get value() {
        return truncate(name, props.modelWidth);
      },
      get color() {
        return theme.text;
      }
    }), null);
    _$insert(_el$40, _$createComponent(Show, {
      get when() {
        return !props.compact;
      },
      get children() {
        return [_$createComponent(Cell, {
          width: 7,
          get value() {
            return formatInteger(props.usage.messages);
          },
          get color() {
            return theme.textMuted;
          },
          right: true
        }), _$createComponent(Cell, {
          width: 14,
          get value() {
            return formatInteger(props.usage.real);
          },
          get color() {
            return theme.text;
          },
          right: true
        }), _$createComponent(Cell, {
          width: 14,
          get value() {
            return formatInteger(props.usage.cache);
          },
          get color() {
            return theme.text;
          },
          right: true
        })];
      }
    }), null);
    _$insert(_el$40, _$createComponent(Cell, {
      width: 14,
      get value() {
        return formatInteger(props.usage.raw);
      },
      get color() {
        return theme.primary;
      },
      right: true,
      bold: true
    }), null);
    _$insert(_el$40, _$createComponent(Cell, {
      width: 12,
      get value() {
        return formatCost(props.usage);
      },
      get color() {
        return theme.success;
      },
      right: true
    }), null);
    _$insert(_el$41, (() => {
      var _c$3 = _$memo(() => !!props.compact);
      return () => _c$3() ? `msgs ${formatCompact(props.usage.messages)} \xB7 real ${formatCompact(props.usage.real)} \xB7 cache ${formatCompact(props.usage.cache)} \xB7 in ${formatCompact(props.usage.input)} \xB7 out ${formatCompact(props.usage.output)} \xB7 reason ${formatCompact(props.usage.reasoning)} \xB7 rd ${formatCompact(props.usage.cacheRead)} \xB7 wr ${formatCompact(props.usage.cacheWrite)}` : `${" ".repeat(Math.min(props.modelWidth, 4))}in ${formatInteger(props.usage.input)}  out ${formatInteger(props.usage.output)}  reason ${formatInteger(props.usage.reasoning)}  cache rd ${formatInteger(props.usage.cacheRead)}  cache wr ${formatInteger(props.usage.cacheWrite)}`;
    })());
    _$effect((_$p) => _$setProp(_el$41, "fg", theme.textMuted, _$p));
    return _el$39;
  })();
}
function UsageModal(props) {
  const dimensions = useTerminalDimensions();
  const [active, setActive] = createSignal(0);
  const [offset, setOffset] = createSignal(0);
  const [report, {
    refetch
  }] = createResource(() => loadUsageReport(props.options));
  const tabs = () => {
    const data = report();
    if (!data)
      return [];
    return [...data.codex ? [{
      kind: "codex",
      label: "Codex",
      report: data.codex
    }] : [], ...data.windows.map((window2) => ({
      kind: "usage",
      label: window2.label,
      window: window2
    }))];
  };
  const tab = () => tabs()[active()];
  const window = () => {
    const selected = tab();
    return selected?.kind === "usage" ? selected.window : undefined;
  };
  const dialogWidth = () => Math.min(116, dimensions().width - 2);
  const compact = () => dialogWidth() < 100;
  const modelWidth = () => Math.max(18, dialogWidth() - (compact() ? 37 : 70));
  const pageSize = () => Math.max(1, Math.floor((dimensions().height - 21) / 2));
  const visibleModels = () => window()?.models.slice(offset(), offset() + pageSize()) ?? [];
  const selectWindow = (index) => {
    const count = tabs().length || 4;
    setActive((index + count) % count);
    setOffset(0);
  };
  const move = (delta) => {
    const count = window()?.models.length ?? 0;
    const max = Math.max(0, count - pageSize());
    setOffset((value) => Math.max(0, Math.min(max, value + delta)));
  };
  useBindings(() => ({
    priority: 1000,
    bindings: [{
      key: "escape",
      cmd: props.close
    }, {
      key: "q",
      cmd: props.close
    }, {
      key: "left",
      cmd: () => selectWindow(active() - 1)
    }, {
      key: "h",
      cmd: () => selectWindow(active() - 1)
    }, {
      key: "right",
      cmd: () => selectWindow(active() + 1)
    }, {
      key: "l",
      cmd: () => selectWindow(active() + 1)
    }, {
      key: "tab",
      cmd: () => selectWindow(active() + 1)
    }, {
      key: "up",
      cmd: () => move(-1)
    }, {
      key: "k",
      cmd: () => move(-1)
    }, {
      key: "down",
      cmd: () => move(1)
    }, {
      key: "j",
      cmd: () => move(1)
    }, {
      key: "r",
      cmd: () => void refetch()
    }]
  }));
  const theme = () => props.api.theme.current;
  return (() => {
    var _el$42 = _$createElement("box");
    _$setProp(_el$42, "width", "100%");
    _$setProp(_el$42, "height", "100%");
    _$insert(_el$42, _$createComponent(props.api.ui.Dialog, {
      size: "xlarge",
      get onClose() {
        return props.close;
      },
      get children() {
        var _el$43 = _$createElement("box"), _el$44 = _$createElement("box"), _el$45 = _$createElement("text"), _el$46 = _$createElement("b"), _el$48 = _$createElement("span");
        _$insertNode(_el$43, _el$44);
        _$setProp(_el$43, "width", "100%");
        _$setProp(_el$43, "paddingBottom", 1);
        _$setProp(_el$43, "paddingLeft", 2);
        _$setProp(_el$43, "paddingRight", 2);
        _$setProp(_el$43, "flexDirection", "column");
        _$setProp(_el$43, "gap", 1);
        _$insertNode(_el$44, _el$45);
        _$setProp(_el$44, "flexDirection", "row");
        _$setProp(_el$44, "justifyContent", "space-between");
        _$insertNode(_el$45, _el$46);
        _$insertNode(_el$45, _el$48);
        _$insertNode(_el$46, _$createTextNode(`OpenCode Usage`));
        _$insertNode(_el$48, _$createTextNode(` local tokens and API-equivalent cost`));
        _$insert(_el$44, _$createComponent(Show, {
          get when() {
            return !compact();
          },
          get children() {
            var _el$50 = _$createElement("text");
            _$insertNode(_el$50, _$createTextNode(`\u2190/\u2192 window \u2191/\u2193 scroll r refresh esc close`));
            _$effect((_$p) => _$setProp(_el$50, "fg", theme().textMuted, _$p));
            return _el$50;
          }
        }), null);
        _$insert(_el$43, _$createComponent(Show, {
          get when() {
            return report();
          },
          get fallback() {
            return (() => {
              var _el$54 = _$createElement("text");
              _$insertNode(_el$54, _$createTextNode(`Loading usage and current pricing\u2026`));
              _$effect((_$p) => _$setProp(_el$54, "fg", theme().textMuted, _$p));
              return _el$54;
            })();
          },
          children: (data) => [(() => {
            var _el$56 = _$createElement("box");
            _$setProp(_el$56, "flexDirection", "row");
            _$setProp(_el$56, "gap", 1);
            _$insert(_el$56, _$createComponent(For, {
              get each() {
                return tabs();
              },
              children: (item, index) => {
                const selected = () => active() === index();
                return (() => {
                  var _el$63 = _$createElement("box"), _el$64 = _$createElement("text");
                  _$insertNode(_el$63, _el$64);
                  _$setProp(_el$63, "onMouseUp", () => selectWindow(index()));
                  _$setProp(_el$63, "paddingLeft", 2);
                  _$setProp(_el$63, "paddingRight", 2);
                  _$insert(_el$64, () => item.label);
                  _$effect((_p$) => {
                    var _v$16 = selected() ? theme().primary : theme().backgroundElement, _v$17 = selected() ? theme().selectedListItemText : theme().text;
                    _v$16 !== _p$.e && (_p$.e = _$setProp(_el$63, "backgroundColor", _v$16, _p$.e));
                    _v$17 !== _p$.t && (_p$.t = _$setProp(_el$64, "fg", _v$17, _p$.t));
                    return _p$;
                  }, {
                    e: undefined,
                    t: undefined
                  });
                  return _el$63;
                })();
              }
            }));
            return _el$56;
          })(), _$createComponent(Show, {
            get when() {
              return _$memo(() => tab()?.kind === "codex")() ? data().codex : undefined;
            },
            children: (codex) => _$createComponent(CodexView, {
              get report() {
                return codex();
              },
              get api() {
                return props.api;
              },
              get compact() {
                return compact();
              }
            })
          }), _$createComponent(Show, {
            get when() {
              return window();
            },
            children: (selected) => [(() => {
              var _el$65 = _$createElement("box");
              _$setProp(_el$65, "flexDirection", "row");
              _$setProp(_el$65, "border", true);
              _$setProp(_el$65, "paddingLeft", 2);
              _$setProp(_el$65, "paddingRight", 2);
              _$insert(_el$65, _$createComponent(SummaryCard, {
                label: "RAW TOKENS",
                get value() {
                  return formatInteger(selected().total.raw);
                },
                get color() {
                  return theme().primary;
                },
                get muted() {
                  return theme().textMuted;
                }
              }), null);
              _$insert(_el$65, _$createComponent(SummaryCard, {
                label: "REAL TOKENS",
                get value() {
                  return formatInteger(selected().total.real);
                },
                get color() {
                  return theme().text;
                },
                get muted() {
                  return theme().textMuted;
                }
              }), null);
              _$insert(_el$65, _$createComponent(SummaryCard, {
                label: "CACHE TOKENS",
                get value() {
                  return formatInteger(selected().total.cache);
                },
                get color() {
                  return theme().text;
                },
                get muted() {
                  return theme().textMuted;
                }
              }), null);
              _$insert(_el$65, _$createComponent(SummaryCard, {
                label: "API COST",
                get value() {
                  return formatCost(selected().total);
                },
                get color() {
                  return theme().success;
                },
                get muted() {
                  return theme().textMuted;
                }
              }), null);
              _$effect((_$p) => _$setProp(_el$65, "borderColor", theme().border, _$p));
              return _el$65;
            })(), (() => {
              var _el$66 = _$createElement("box");
              _$setProp(_el$66, "flexDirection", "row");
              _$setProp(_el$66, "gap", 1);
              _$insert(_el$66, _$createComponent(Cell, {
                get width() {
                  return modelWidth();
                },
                value: "MODEL",
                get color() {
                  return theme().textMuted;
                }
              }), null);
              _$insert(_el$66, _$createComponent(Show, {
                get when() {
                  return !compact();
                },
                get children() {
                  return [_$createComponent(Cell, {
                    width: 7,
                    value: "MSGS",
                    get color() {
                      return theme().textMuted;
                    },
                    right: true
                  }), _$createComponent(Cell, {
                    width: 14,
                    value: "REAL",
                    get color() {
                      return theme().textMuted;
                    },
                    right: true
                  }), _$createComponent(Cell, {
                    width: 14,
                    value: "CACHE",
                    get color() {
                      return theme().textMuted;
                    },
                    right: true
                  })];
                }
              }), null);
              _$insert(_el$66, _$createComponent(Cell, {
                width: 14,
                value: "RAW",
                get color() {
                  return theme().textMuted;
                },
                right: true
              }), null);
              _$insert(_el$66, _$createComponent(Cell, {
                width: 12,
                value: "API COST",
                get color() {
                  return theme().textMuted;
                },
                right: true
              }), null);
              return _el$66;
            })(), _$createComponent(Show, {
              get when() {
                return selected().models.length;
              },
              get fallback() {
                return (() => {
                  var _el$76 = _$createElement("text");
                  _$insertNode(_el$76, _$createTextNode(`No token usage in this window.`));
                  _$effect((_$p) => _$setProp(_el$76, "fg", theme().textMuted, _$p));
                  return _el$76;
                })();
              },
              get children() {
                return _$createComponent(For, {
                  get each() {
                    return visibleModels();
                  },
                  children: (usage) => _$createComponent(ModelRow, {
                    usage,
                    get modelWidth() {
                      return modelWidth();
                    },
                    get api() {
                      return props.api;
                    },
                    get compact() {
                      return compact();
                    }
                  })
                });
              }
            }), (() => {
              var _el$67 = _$createElement("box");
              _$setProp(_el$67, "flexGrow", 1);
              return _el$67;
            })(), (() => {
              var _el$68 = _$createElement("box"), _el$69 = _$createElement("text"), _el$70 = _$createTextNode(`Models `), _el$71 = _$createTextNode(`\u2013`), _el$72 = _$createTextNode(` of `), _el$74 = _$createElement("text"), _el$75 = _$createTextNode(` \xB7 updated `);
              _$insertNode(_el$68, _el$69);
              _$insertNode(_el$68, _el$74);
              _$setProp(_el$68, "flexDirection", "row");
              _$setProp(_el$68, "justifyContent", "space-between");
              _$insertNode(_el$69, _el$70);
              _$insertNode(_el$69, _el$71);
              _$insertNode(_el$69, _el$72);
              _$insert(_el$69, (() => {
                var _c$5 = _$memo(() => !!selected().models.length);
                return () => _c$5() ? offset() + 1 : 0;
              })(), _el$71);
              _$insert(_el$69, () => Math.min(offset() + pageSize(), selected().models.length), _el$72);
              _$insert(_el$69, () => selected().models.length, null);
              _$insertNode(_el$74, _el$75);
              _$insert(_el$74, () => formatStart(selected().startsAt), _el$75);
              _$insert(_el$74, () => new Date(data().generatedAt).toLocaleTimeString(), null);
              _$effect((_p$) => {
                var _v$18 = theme().textMuted, _v$19 = theme().textMuted;
                _v$18 !== _p$.e && (_p$.e = _$setProp(_el$69, "fg", _v$18, _p$.e));
                _v$19 !== _p$.t && (_p$.t = _$setProp(_el$74, "fg", _v$19, _p$.t));
                return _p$;
              }, {
                e: undefined,
                t: undefined
              });
              return _el$68;
            })()]
          }), _$createComponent(Show, {
            get when() {
              return _$memo(() => !!window())() && data().pricingWarning;
            },
            get children() {
              var _el$57 = _$createElement("text"), _el$58 = _$createTextNode(`Pricing unavailable: `);
              _$insertNode(_el$57, _el$58);
              _$insert(_el$57, () => data().pricingWarning, null);
              _$effect((_$p) => _$setProp(_el$57, "fg", theme().warning, _$p));
              return _el$57;
            }
          }), _$createComponent(Show, {
            get when() {
              return _$memo(() => !!window())() && data().unpriced.length;
            },
            get children() {
              var _el$59 = _$createElement("text"), _el$60 = _$createTextNode(`Unpriced: `);
              _$insertNode(_el$59, _el$60);
              _$insert(_el$59, () => data().unpriced.join(", "), null);
              _$effect((_$p) => _$setProp(_el$59, "fg", theme().warning, _$p));
              return _el$59;
            }
          }), _$createComponent(Show, {
            get when() {
              return window();
            },
            get children() {
              var _el$61 = _$createElement("text");
              _$insertNode(_el$61, _$createTextNode(`Real = input + output + reasoning \xB7 Cache = reads + writes \xB7 models.dev prices are estimates`));
              _$effect((_$p) => _$setProp(_el$61, "fg", theme().textMuted, _$p));
              return _el$61;
            }
          })]
        }), null);
        _$insert(_el$43, _$createComponent(Show, {
          get when() {
            return report.error;
          },
          get children() {
            var _el$52 = _$createElement("text"), _el$53 = _$createTextNode(`Could not load usage: `);
            _$insertNode(_el$52, _el$53);
            _$insert(_el$52, (() => {
              var _c$4 = _$memo(() => report.error instanceof Error);
              return () => _c$4() ? report.error.message : String(report.error);
            })(), null);
            _$effect((_$p) => _$setProp(_el$52, "fg", theme().error, _$p));
            return _el$52;
          }
        }), null);
        _$effect((_p$) => {
          var _v$13 = Math.max(18, Math.floor(dimensions().height * 0.7)), _v$14 = theme().text, _v$15 = {
            fg: theme().textMuted
          };
          _v$13 !== _p$.e && (_p$.e = _$setProp(_el$43, "height", _v$13, _p$.e));
          _v$14 !== _p$.t && (_p$.t = _$setProp(_el$45, "fg", _v$14, _p$.t));
          _v$15 !== _p$.a && (_p$.a = _$setProp(_el$48, "style", _v$15, _p$.a));
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined
        });
        return _el$43;
      }
    }));
    _$effect((_$p) => _$setProp(_el$42, "backgroundColor", theme().background, _$p));
    return _el$42;
  })();
}
function returnTo(api, route) {
  if ("params" in route) {
    api.route.navigate(route.name, route.params);
    return;
  }
  api.route.navigate(route.name);
}
var tui = async (api, rawOptions) => {
  const options = {
    db: typeof rawOptions?.db === "string" ? rawOptions.db : undefined,
    pricingUrl: typeof rawOptions?.pricingUrl === "string" ? rawOptions.pricingUrl : undefined
  };
  let previous = {
    name: "home"
  };
  const close = () => returnTo(api, previous);
  api.route.register([{
    name: ROUTE,
    render: () => _$createComponent(UsageModal, {
      api,
      options,
      close
    })
  }]);
  api.keymap.registerLayer({
    commands: [{
      name: command.open,
      title: "Open usage report",
      category: "Plugin",
      namespace: "palette",
      slashName: "usagex",
      run() {
        previous = api.route.current;
        api.route.navigate(ROUTE);
      }
    }]
  });
};
var plugin = {
  id: "usagex",
  tui
};
var src_default = plugin;
export {
  src_default as default
};
