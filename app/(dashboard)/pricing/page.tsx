import { PricingTable } from "@clerk/nextjs"
import { auth } from "@clerk/nextjs/server"

export default async function PricingPage() {
  await auth.protect()

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Pricing</h1>
        <p className="text-muted-foreground">
          Bots and their sandboxes are part of the paid plan.
        </p>
      </div>
      {/* After checkout, back to the app with the new plan */}
      <PricingTable newSubscriptionRedirectUrl="/" />
    </div>
  )
}
