import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import * as State from "../../../lib/state"

/**
 * GET /admin/asyntai-search
 *
 * Everything the settings screen shows, in one call.
 *
 * Medusa authenticates every /admin route for us, so there is no check here
 * and no AUTHENTICATE = false either. This endpoint hands back the feed
 * address, which is the store's half of a signed pair, and it must never
 * answer an unauthenticated caller.
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const container = req.scope
  const siteId = await State.siteId(container)
  const status = siteId ? await State.refreshIfStale(container) : null
  const reason = status?.reason || ""

  let state: string

  if (status !== null && status.enabled) {
    state = "live"
  } else if (reason === "no_products") {
    state = "setting_up"
  } else if (reason === "plan" || reason === "limit") {
    state = "blocked"
  } else {
    state = "unknown"
  }

  res.json({
    site_id: siteId,
    account_email: await State.get(container, "account_email"),
    connected: siteId !== "",
    state,
    status,
    message:
      state === "unknown" && siteId !== ""
        ? "Asyntai could not be reached just now. The bar keeps its last answer until it can."
        : State.message(status),
    preview_url: await State.previewUrl(container),
    storefront_url: await State.storefrontUrl(container),
    backend_url: await State.backendUrl(container),
    loader_url: await State.loaderUrl(container),
    feed_url: await State.feedUrl(container),
    feed_enabled: await State.feedEnabled(container),
    placement: await State.placement(container),
    selector: await State.selector(container),
    accent: await State.accent(container),
    placeholder: await State.placeholder(container),
    product_path:
      (await State.get(container, "product_path")) || "/products/{handle}",
  })
}
