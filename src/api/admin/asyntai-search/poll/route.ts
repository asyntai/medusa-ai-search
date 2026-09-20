import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import * as State from "../../../../lib/state"

/** How long a handshake state stays valid. */
const STATE_TTL = 900

/**
 * GET /admin/asyntai-search/poll?state=...
 *
 * Has the owner finished signing in?
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const container = req.scope
  const state = String(req.query.state || "").trim()
  const stored = await State.get(container, "state")
  const startedAt = Number(await State.get(container, "state_at", "0")) || 0

  // Only the state this store just generated is ever polled, so a guessed or
  // replayed one cannot be used to read somebody else's handshake.
  if (!state || state !== stored) {
    res.status(400).json({ error: "Unknown handshake" })
    return
  }

  if (Math.floor(Date.now() / 1000) - startedAt > STATE_TTL) {
    res.status(410).json({
      error: "That sign-in window has expired. Press Connect to start again.",
    })
    return
  }

  const body = await State.httpGet(
    State.origin() +
      "/api/v1/wp-search/connect-status/?state=" +
      encodeURIComponent(state)
  )

  if (body === null) {
    res.json({ ready: false })
    return
  }

  let decoded: any

  try {
    decoded = JSON.parse(body)
  } catch (e) {
    res.json({ ready: false })
    return
  }

  if (!decoded || !decoded.ready || !decoded.data?.site_id) {
    res.json({ ready: false })
    return
  }

  res.json({
    ready: true,
    site_id: String(decoded.data.site_id),
    account_email: String(decoded.data.account_email || ""),
  })
}
