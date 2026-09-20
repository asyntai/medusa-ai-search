import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { randomBytes } from "crypto"

import * as State from "../../../../lib/state"

/**
 * POST /admin/asyntai-search/prepare
 *
 * Park a fresh preview secret and feed token at Asyntai, and hand the browser
 * the sign-in address.
 */
export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const container = req.scope
  const storefront = await State.storefrontUrl(container)

  // Without this we would register the backend as the shop, and Asyntai would
  // index an API instead of a storefront. Better to stop here and say so.
  if (!storefront) {
    res.status(400).json({
      error:
        "Set the storefront address first. That is where shoppers are, and it is what Asyntai indexes.",
    })
    return
  }

  const state = "md_" + randomBytes(12).toString("hex")

  // Made here and sent once, in this request body, which is the only hop of
  // the handshake that never passes through a browser. With it this store can
  // prove a preview belongs to it without depending on a cookie surviving
  // inside somebody else's frame.
  const secret = randomBytes(24).toString("hex")

  // The feed token is written BEFORE staging, and kept if staging fails:
  // Asyntai reads the catalogue the moment the owner signs in, and the feed
  // must already answer to the token Asyntai was given.
  const feedToken = randomBytes(24).toString("hex")
  await State.set(container, "feed_token", feedToken)

  const feedOn = await State.feedEnabled(container)

  const body = await State.httpPostJson(
    State.origin() + "/api/v1/wp-search/stage/",
    {
      state,
      site_url: storefront,
      consumer_key: "",
      consumer_secret: "",
      plugin_secret: secret,
      platform: "medusa",
      product: "search",
      feed_token: feedOn ? feedToken : "",
      feed_url: feedOn ? await State.feedUrl(container) : "",
    }
  )

  if (body === null) {
    res.status(502).json({
      error: "Asyntai could not be reached. Check the server's connection and try again.",
    })
    return
  }

  // Kept only after Asyntai accepted it, so a failed handshake cannot leave
  // this store signing tokens with a secret nobody knows.
  await State.set(container, "secret", secret)
  await State.set(container, "state", state)
  await State.set(container, "state_at", String(Math.floor(Date.now() / 1000)))

  const email = String((req as any).auth_context?.app_metadata?.user_email || "")

  const query = new URLSearchParams({
    state,
    site_url: storefront,
    platform: "medusa",
    // Which product brought them, kept apart from which platform: this is
    // what separates a search install from a chat install in the signup
    // numbers.
    product: "search",
    wp_email: email,
    lang: "en",
  })

  res.json({ state, url: State.origin() + "/wp-auth?" + query.toString() })
}
