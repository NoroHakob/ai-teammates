import { auth } from "@clerk/nextjs/server"
import { format } from "date-fns"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Progress, ProgressLabel } from "@/components/ui/progress"
import { getUsage, usageLimits } from "@/lib/usage"

// ai amounts are millionths of a dollar
function dollars(micros: number) {
  return `$${(micros / 1_000_000).toFixed(2)}`
}

// sandbox amounts are seconds
function hours(seconds: number) {
  const value = seconds / 3600
  return `${Number.isInteger(value) ? value : value.toFixed(1)} h`
}

function UsageBar({
  label,
  used,
  limit,
  formatAmount,
}: {
  label: string
  used: number
  limit: number
  formatAmount: (amount: number) => string
}) {
  return (
    <Progress value={Math.min(used, limit)} max={limit}>
      <ProgressLabel>{label}</ProgressLabel>
      <span className="ml-auto text-sm text-muted-foreground tabular-nums">
        {formatAmount(used)} / {formatAmount(limit)}
      </span>
    </Progress>
  )
}

export default async function UsagePage() {
  const { userId } = await auth.protect()
  const usage = await getUsage(userId)

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Usage</h1>
        <p className="text-muted-foreground">
          {usage
            ? `What your plan includes this billing period. It resets on ${format(usage.period.end, "MMMM d, yyyy")}.`
            : "Usage is included with the paid plan."}
        </p>
      </div>
      {usage ? (
        <div className="flex flex-col gap-6">
          <UsageBar
            label="AI"
            used={usage.used.ai}
            limit={usageLimits.ai}
            formatAmount={dollars}
          />
          <UsageBar
            label="Sandbox"
            used={usage.used.sandbox}
            limit={usageLimits.sandbox}
            formatAmount={hours}
          />
        </div>
      ) : (
        <Button
          className="self-start"
          nativeButton={false}
          render={<Link href="/pricing" />}
        >
          See plans
        </Button>
      )}
    </div>
  )
}
