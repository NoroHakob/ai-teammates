// Railway's healthcheck: only says the server is up. No auth, DB or service
// calls, so a slow dependency never marks a healthy deploy as failed.
export function GET() {
  return Response.json({ status: "ok" })
}
