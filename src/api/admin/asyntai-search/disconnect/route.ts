import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import * as State from "../../../../lib/state"

/**
 * POST /admin/asyntai-search/disconnect
 *
 * The owner's settings survive, so reconnecting does not mean choosing the
 * placement and the accent colour all over again.
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  await State.disconnect(req.scope)

  res.json({ ok: true })
}
