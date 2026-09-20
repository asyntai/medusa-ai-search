import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import * as State from "../../../../lib/state"

/**
 * POST /admin/asyntai-search/finish
 *
 * Remember the site id and ask Asyntai for a first status.
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const container = req.scope
  const body = (req.body || {}) as Record<string, unknown>
  const siteId = String(body.site_id || "").trim()

  // The id is ours, so its shape is known. Anything else is a caller that did
  // not come from the poll above.
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(siteId)) {
    res.status(400).json({ error: "Invalid site id" })
    return
  }

  await State.set(container, "site_id", siteId)
  await State.set(
    container,
    "account_email",
    String(body.account_email || "").trim().slice(0, 200)
  )
  await State.forget(container, "state")
  await State.forget(container, "state_at")
  await State.refresh(container)

  res.json({ ok: true })
}
