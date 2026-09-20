import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import * as Feed from "../../../lib/feed"

/**
 * GET /asyntai-search/feed
 *
 * The signed catalogue feed. Asyntai is the only caller: every request
 * carries a timestamp and an HMAC-SHA256 signature keyed with a token this
 * store generated and handed over once, during connect.
 *
 * Off /store on purpose. A /store route demands a publishable API key, and
 * the catalogue read is server to server, so a key would be one more secret
 * to hold for no gain.
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const result = await Feed.handle(
    req.scope,
    (req.query || {}) as Record<string, unknown>
  )

  // Never cached, by us or by anything between us. The point of the feed is
  // that the price it quotes is the price the shop is charging now.
  res.setHeader("Cache-Control", "no-store")
  res.status(result.status).json(result.body)
}
