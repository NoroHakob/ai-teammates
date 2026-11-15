// Clerk Billing feature slugs. The "pro" plan has both; the free plan has neither.
export type Feature = "bots" | "sandboxes"

// The server's error for a missing feature; the client turns it into the paywall
export const UPGRADE_REQUIRED = "Upgrade required"

// Why each feature needs an upgrade, shown to the person and to the model
export const featureReasons: Record<Feature, string> = {
  bots: "Bots are part of the paid plan.",
  sandboxes: "Sandboxes are part of the paid plan.",
}

// has() from Clerk's auth() or useAuth(), limited to this app's features
export function hasFeature(
  has: (params: { feature: string }) => boolean,
  feature: Feature
) {
  return has({ feature })
}

// The server's error once the plan's allowance for this billing period is spent
export const USAGE_LIMIT_ERROR =
  "You've used up your usage for this billing period."
