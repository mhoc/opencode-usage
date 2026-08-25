import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { loadCodexReport, parseCodexUsage } from "./codex.ts"

describe("parseCodexUsage", () => {
  test("parses subscription windows and credits", () => {
    assert.deepEqual(
      parseCodexUsage({
        plan_type: "plus",
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: {
            used_percent: 42,
            limit_window_seconds: 18_000,
            reset_after_seconds: 120,
            reset_at: 1_735_689_720,
          },
          secondary_window: {
            used_percent: 5,
            limit_window_seconds: 604_800,
            reset_after_seconds: 43_200,
            reset_at: 1_735_693_200,
          },
        },
        credits: {
          has_credits: true,
          unlimited: false,
          balance: "9.99",
        },
      }),
      {
      planType: "plus",
      allowed: true,
      limitReached: false,
      primary: {
        usedPercent: 42,
        windowSeconds: 18_000,
        resetAfterSeconds: 120,
        resetsAt: 1_735_689_720,
      },
      secondary: {
        usedPercent: 5,
        windowSeconds: 604_800,
        resetAfterSeconds: 43_200,
        resetsAt: 1_735_693_200,
      },
      credits: {
        hasCredits: true,
        unlimited: false,
        balance: "9.99",
      },
      },
    )
  })

  test("allows absent and malformed optional windows", () => {
    assert.deepEqual(parseCodexUsage({ rate_limit: { primary_window: null, secondary_window: {} } }), {
      planType: undefined,
      allowed: undefined,
      limitReached: undefined,
      primary: undefined,
      secondary: undefined,
      credits: undefined,
    })
  })

  test("rejects a non-object response", () => {
    assert.throws(() => parseCodexUsage([]), /unexpected response/)
  })

  test("omits Codex usage without OpenAI OAuth", async () => {
    const previous = process.env.OPENCODE_AUTH_CONTENT
    process.env.OPENCODE_AUTH_CONTENT = "{}"
    try {
      assert.equal(await loadCodexReport(), undefined)
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_AUTH_CONTENT
      else process.env.OPENCODE_AUTH_CONTENT = previous
    }
  })

  test("does not refresh expired credentials", async () => {
    const previous = process.env.OPENCODE_AUTH_CONTENT
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({
      openai: { type: "oauth", access: "expired-test-token", refresh: "unused", expires: 0 },
    })
    try {
      const report = await loadCodexReport()
      assert.match(report?.error ?? "", /expired/)
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_AUTH_CONTENT
      else process.env.OPENCODE_AUTH_CONTENT = previous
    }
  })
})
