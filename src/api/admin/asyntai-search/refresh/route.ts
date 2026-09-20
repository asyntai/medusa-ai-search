import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import * as State from "../../../../lib/state"

/**
 * POST /admin/asyntai-search/refresh
 *
 * Ask Asyntai again now. For the settings screen's own button, so an owner
 * who has just fixed their plan does not have to wait out the cache.
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const container = req.scope
  const status = await State.refresh(container)
  const shown = status ?? (await State.status(container))

  res.json({
    ok: status !== null,
    enabled: status !== null && Boolean(status.enabled),
    message: State.message(shown),
  })
}
