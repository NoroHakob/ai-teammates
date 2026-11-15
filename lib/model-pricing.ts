import type { LanguageModelUsage } from "ai"

// gpt-6-luna (lib/ai.ts), in dollars per 1M tokens
const PRICES = {
  input: 0.1,
  cachedInput: 0.01,
  output: 0.5,
}

// Dollars per 1M tokens is millionths of a dollar per token. Scaled by 100 to
// whole numbers, so the sum is exact before it is rounded up once.
const SCALE = 100
const rate = (dollarsPerMillion: number) =>
  Math.round(dollarsPerMillion * SCALE)

// The cost of one model call in millionths of a dollar, rounded up
export function chatModelCost(usage: LanguageModelUsage) {
  const input = usage.inputTokens ?? 0
  const cached = Math.min(usage.inputTokenDetails.cacheReadTokens ?? 0, input)
  // outputTokens already includes the reasoning tokens
  const output = usage.outputTokens ?? 0

  const scaled =
    (input - cached) * rate(PRICES.input) +
    cached * rate(PRICES.cachedInput) +
    output * rate(PRICES.output)

  return Math.ceil(scaled / SCALE)
}
