import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import * as State from "../../../../lib/state"

/**
 * POST /admin/asyntai-search/settings
 *
 * The owner's choices: where the bar goes, how it looks, where the storefront
 * is, and whether Asyntai may read the catalogue.
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const container = req.scope
  const body = (req.body || {}) as Record<string, unknown>

  // Read before the write, so the comparison below is against what the store
  // was connected with.
  const oldBackend = await State.backendUrl(container)
  const connected = (await State.siteId(container)) !== ""

  const placement = String(body.placement || "replace")
  await State.set(
    container,
    "placement",
    placement === "manual" ? "manual" : "replace"
  )

  for (const key of ["selector", "accent", "placeholder"]) {
    const value = String(body[key] ?? "").trim().slice(0, 200)
    await State.set(container, key, value)
  }

  for (const key of ["storefront_url", "backend_url"]) {
    const value = String(body[key] ?? "").trim().slice(0, 500)
    await State.set(container, key, value)
  }

  const pattern = String(body.product_path ?? "").trim().slice(0, 200)
  await State.set(container, "product_path", pattern)

  const feedOn = body.feed_enabled === undefined ? true : Boolean(body.feed_enabled)
  await State.set(container, "feed_enabled", feedOn ? "1" : "0")

  // Asyntai stored the feed address when this store connected, and there is
  // no way to change it from here. Saying so is the difference between a
  // catalogue that quietly stops updating and one the owner knows to fix.
  const newBackend = await State.backendUrl(container)
  const reconnectNeeded = connected && newBackend !== oldBackend

  res.json({
    ok: true,
    reconnect_needed: reconnectNeeded,
    loader_url: await State.loaderUrl(container),
    feed_url: await State.feedUrl(container),
    storefront_url: await State.storefrontUrl(container),
    backend_url: newBackend,
  })
}
