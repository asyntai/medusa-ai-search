/**
 * Asyntai AI Search for Medusa: everything the plugin remembers, and the one
 * question it asks Asyntai.
 *
 * TWO ADDRESSES, NOT ONE. Every other shop platform we ship for renders its
 * own storefront, so one URL is the shop, the admin and the feed. Medusa is
 * headless: the backend serves /admin and /store, and the storefront is a
 * separate application on a separate address. So this plugin keeps both.
 *
 *   storefrontUrl  where shoppers are, what Asyntai indexes, and what a
 *                  product link in the feed must point at.
 *   backendUrl     where this Medusa answers, and therefore where the
 *                  catalogue feed and the loader script live.
 *
 * Getting those two the wrong way round is the one mistake that makes an
 * otherwise working install answer with dead links, so both are shown on the
 * settings screen and both are editable.
 */
import { ASYNTAI_SEARCH_MODULE } from "../modules/asyntai-search"

export const DEFAULT_ORIGIN = "https://asyntai.com"

export const DEFAULT_SCRIPT_URL =
  "https://widget.asyntai.com/static/js/search-widget.js"

/** The keys a disconnect wipes. The owner's own settings are left alone. */
const CONNECTION_KEYS = [
  "site_id",
  "secret",
  "feed_token",
  "status",
  "status_at",
  "state",
  "state_at",
  "account_email",
]

type Container = { resolve: (key: string) => any }

export type Status = {
  enabled?: boolean
  reason?: string
  message?: string
  products?: number
  pages?: number
  cache_seconds?: number
  sync?: { status?: string; count?: number; error?: string } | null
  [key: string]: unknown
}

// -----------------------------------------------------------------
// Where we talk to Asyntai
// -----------------------------------------------------------------

/**
 * Where this store's server talks to Asyntai.
 *
 * Overridable from the environment so a staging copy can point at a test
 * server. There is deliberately no field for it on the settings screen: a
 * field that lets somebody retype the server address is a field that lets
 * somebody break their own store in a way support cannot see.
 */
export function origin(): string {
  const value = (process.env.ASYNTAI_SEARCH_ORIGIN || "").trim()
  return value ? value.replace(/\/+$/, "") : DEFAULT_ORIGIN
}

/**
 * What the SHOPPER'S browser downloads, which is not the same host as the one
 * above. Every install route we document points at the widget subdomain, so
 * this one does too.
 */
export function scriptUrl(): string {
  const value = (process.env.ASYNTAI_SEARCH_SCRIPT || "").trim()
  return value || DEFAULT_SCRIPT_URL
}

// -----------------------------------------------------------------
// Storage
// -----------------------------------------------------------------

function service(container: Container) {
  return container.resolve(ASYNTAI_SEARCH_MODULE)
}

export async function get(
  container: Container,
  name: string,
  fallback = ""
): Promise<string> {
  try {
    const rows = await service(container).listAsyntaiSettings({ name })
    const row = Array.isArray(rows) ? rows[0] : null
    if (!row || row.value === null || row.value === undefined) {
      return fallback
    }
    return String(row.value)
  } catch (e) {
    // The table is missing until `medusa db:migrate` has run. Answering with
    // the default keeps the settings screen loadable, so the owner can read
    // the message telling them to run it.
    return fallback
  }
}

export async function set(
  container: Container,
  name: string,
  value: string
): Promise<boolean> {
  try {
    const module = service(container)
    const rows = await module.listAsyntaiSettings({ name })
    const row = Array.isArray(rows) ? rows[0] : null

    if (row) {
      await module.updateAsyntaiSettings({ id: row.id, value: String(value) })
    } else {
      await module.createAsyntaiSettings({ name, value: String(value) })
    }

    return true
  } catch (e) {
    return false
  }
}

export async function forget(container: Container, name: string): Promise<void> {
  try {
    const module = service(container)
    const rows = await module.listAsyntaiSettings({ name })
    const row = Array.isArray(rows) ? rows[0] : null
    if (row) {
      await module.deleteAsyntaiSettings(row.id)
    }
  } catch (e) {
    // A row we could not delete is a row the next connect overwrites.
  }
}

export async function siteId(container: Container): Promise<string> {
  return (await get(container, "site_id")).trim()
}

/**
 * Forget the connection. The secret and the feed token go with it: a secret
 * kept after a disconnect can only ever sign a link nobody should follow, and
 * a token kept would let the feed keep answering for a store that asked it to
 * stop.
 */
export async function disconnect(container: Container): Promise<void> {
  for (const key of CONNECTION_KEYS) {
    await forget(container, key)
  }
}

// -----------------------------------------------------------------
// The two addresses
// -----------------------------------------------------------------

function tidyUrl(raw: string): string {
  let value = String(raw || "").trim()
  if (!value) {
    return ""
  }
  value = value.split("?")[0].replace(/\/+$/, "")
  if (!/^https?:\/\//i.test(value)) {
    value = "https://" + value
  }
  return value
}

/**
 * The first address in STORE_CORS that could be a storefront.
 *
 * A headless Medusa has to be told which browsers may call it, so the
 * storefront is almost always already named there. Using it as the default
 * means most installs never have to fill the field in at all.
 */
function storefrontFromCors(): string {
  const raw = String(process.env.STORE_CORS || "")

  for (const part of raw.split(",")) {
    const trimmed = part.trim()

    // A regular expression or a wildcard entry names a shape, not a shop.
    if (!trimmed || trimmed.startsWith("/") || trimmed.includes("*")) {
      continue
    }

    const candidate = tidyUrl(trimmed)

    if (!candidate) {
      continue
    }

    // The admin lives on the backend, so an entry pointing at the backend's
    // own port is not the storefront.
    if (/^https?:\/\/[^/]*:9000(\/|$)/i.test(candidate)) {
      continue
    }

    return candidate
  }

  return ""
}

/** Where shoppers are. What Asyntai indexes, and what feed links point at. */
export async function storefrontUrl(container: Container): Promise<string> {
  const saved = tidyUrl(await get(container, "storefront_url"))
  if (saved) {
    return saved
  }
  return tidyUrl(process.env.STOREFRONT_URL || "") || storefrontFromCors()
}

/** Where this Medusa answers. The feed and the loader script live here. */
export async function backendUrl(container: Container): Promise<string> {
  const saved = tidyUrl(await get(container, "backend_url"))
  if (saved) {
    return saved
  }
  return (
    tidyUrl(process.env.MEDUSA_BACKEND_URL || "") || "http://localhost:9000"
  )
}

/** The address Asyntai reads the catalogue from. */
export async function feedUrl(container: Container): Promise<string> {
  return (await backendUrl(container)) + "/asyntai-search/feed"
}

/** The one tag the storefront has to carry. */
export async function loaderUrl(container: Container): Promise<string> {
  return (await backendUrl(container)) + "/asyntai-search/loader"
}

// -----------------------------------------------------------------
// The owner's settings
// -----------------------------------------------------------------

/**
 * 'replace'  take the place of the search box the storefront already shows
 * 'manual'   render only where the storefront puts <div data-asyntai-search>
 */
export async function placement(container: Container): Promise<string> {
  return (await get(container, "placement")) === "manual" ? "manual" : "replace"
}

export async function selector(container: Container): Promise<string> {
  return (await get(container, "selector")).trim()
}

export async function accent(container: Container): Promise<string> {
  return (await get(container, "accent")).trim()
}

export async function placeholder(container: Container): Promise<string> {
  return (await get(container, "placeholder")).trim()
}

/**
 * Whether Asyntai may read the catalogue. On by default: live prices and
 * stock are the reason to run this on a shop at all.
 */
export async function feedEnabled(container: Container): Promise<boolean> {
  return (await get(container, "feed_enabled", "1")) !== "0"
}

export async function feedToken(container: Container): Promise<string> {
  return (await get(container, "feed_token")).trim()
}

// -----------------------------------------------------------------
// The one question we ask Asyntai
// -----------------------------------------------------------------

/** The last answer, or null when there has never been one. */
export async function status(container: Container): Promise<Status | null> {
  const raw = await get(container, "status")
  if (!raw) {
    return null
  }
  try {
    const decoded = JSON.parse(raw)
    return decoded && typeof decoded === "object" ? (decoded as Status) : null
  } catch (e) {
    return null
  }
}

/**
 * May the bar render on the storefront right now?
 *
 * FALSE while we have never had an answer, on purpose. A bar that cannot
 * answer is worse than no bar, because in replace mode it has hidden the
 * storefront's own search box behind it.
 */
export async function enabled(container: Container): Promise<boolean> {
  const current = await status(container)
  return current !== null && Boolean(current.enabled)
}

function maxAge(current: Status): number {
  const seconds = Number(current.cache_seconds ?? 3600)
  if (!Number.isFinite(seconds) || seconds < 30) {
    return 30
  }
  return Math.floor(seconds)
}

/**
 * Re-ask Asyntai and store the answer.
 *
 * Returns the answer, or null when the call failed, in which case the
 * previous answer is kept: a network blip must not switch a working store's
 * search off.
 */
export async function refresh(
  container: Container,
  timeoutMs = 10000
): Promise<Status | null> {
  const id = await siteId(container)

  if (!id) {
    await forget(container, "status")
    await forget(container, "status_at")
    return null
  }

  const body = await httpGet(
    origin() +
      "/api/v1/search-widget/status/?widget_id=" +
      encodeURIComponent(id),
    timeoutMs
  )

  if (body === null) {
    return null
  }

  let decoded: any

  try {
    decoded = JSON.parse(body)
  } catch (e) {
    return null
  }

  if (!decoded || typeof decoded !== "object" || !("enabled" in decoded)) {
    return null
  }

  await set(container, "status", JSON.stringify(decoded))
  await set(container, "status_at", String(Math.floor(Date.now() / 1000)))

  return decoded as Status
}

/**
 * Refresh only when the stored answer is older than Asyntai asked us to keep
 * it. For the settings screen, where somebody is waiting and wants current
 * information.
 */
export async function refreshIfStale(
  container: Container
): Promise<Status | null> {
  const current = await status(container)

  if (current === null) {
    return refresh(container)
  }

  const at = Number(await get(container, "status_at", "0")) || 0
  const age = Math.floor(Date.now() / 1000) - at

  return age >= maxAge(current) ? refresh(container) : current
}

/**
 * The same thing, from a shopper's request for the loader script.
 *
 * Medusa has a scheduler, but a plugin that only refreshed on a schedule
 * would be switched off for a whole interval on any store whose worker mode
 * runs no scheduler. So the refresh also rides on shopper traffic, and that
 * makes the cost of a slow answer everybody's problem. Two rules keep it
 * small.
 *
 * The stamp is written BEFORE the call, not after. Otherwise a server that
 * accepts the connection and then says nothing makes EVERY shopper wait the
 * full timeout, because none of them ever gets to record an attempt. With the
 * stamp claimed first, one shopper waits and the rest sail past.
 *
 * And the timeout is short. On the settings screen ten seconds is patience;
 * on a shopper's page it is a page nobody waits for.
 */
export async function refreshFromSite(container: Container): Promise<void> {
  const current = await status(container)
  const at = Number(await get(container, "status_at", "0")) || 0
  const age = Math.floor(Date.now() / 1000) - at

  if (current !== null && age < maxAge(current)) {
    return
  }

  // Claim the attempt first. If the call then fails, the next check is a
  // whole interval away rather than on the very next request.
  await set(container, "status_at", String(Math.floor(Date.now() / 1000)))
  await refresh(container, 4000)
}

/**
 * A sentence for the settings screen.
 *
 * Known reasons are worded here, in the plugin. An unknown reason falls back
 * to whatever Asyntai sent, which is what lets a new reason appear without a
 * new release of this plugin.
 */
export function message(current: Status | null): string {
  if (current === null) {
    return "Not connected to Asyntai yet."
  }

  if (current.enabled) {
    const products = Number(current.products ?? 0)

    // A store with nothing in its catalogue yet is still searchable, and
    // "searching 0 products" would read as a fault.
    if (!Number.isFinite(products) || products < 1) {
      return "Live. The bar is answering from your pages."
    }

    return (
      "Live. The bar is answering from " +
      products.toLocaleString("en-US") +
      " catalogue items."
    )
  }

  switch (current.reason) {
    case "plan":
      return "The AI Search Bar is not part of this Asyntai plan yet."
    case "limit":
      return "This month's searches are used up. The bar starts again when the plan renews."
    case "no_products":
      return "Asyntai is still reading your catalogue. The bar switches on by itself when that is done."
    case "unknown_widget":
      return "This store is not connected to Asyntai any more. Connect it again below."
  }

  return current.message
    ? String(current.message).replace(/<[^>]*>/g, "")
    : "The bar is switched off for this store."
}

// -----------------------------------------------------------------
// The owner's own bar, on a link
// -----------------------------------------------------------------

/**
 * The address of this store's own search bar, carrying proof that this store
 * asked for it.
 *
 * Signed rather than relying on a session: the owner is signed in to Medusa,
 * not necessarily to Asyntai, and a link that lands on a sign-in form is a
 * link nobody follows. Empty without a secret, which hides the button rather
 * than offering a door that does not open.
 */
export async function previewUrl(container: Container): Promise<string> {
  const id = await siteId(container)
  const secret = await get(container, "secret")

  if (!id || !secret) {
    return ""
  }

  const { createHmac } = await import("crypto")
  const expiry = Math.floor(Date.now() / 1000) + 1500
  const signature = createHmac("sha256", secret)
    .update(id + ":" + expiry)
    .digest("hex")

  const query = new URLSearchParams({
    widget_id: id,
    token: expiry + "." + signature,
  })

  return origin() + "/ai-search-bar/preview/?" + query.toString()
}

// -----------------------------------------------------------------
// HTTP
// -----------------------------------------------------------------

/** Body of a GET, or null on any failure. */
export async function httpGet(
  url: string,
  timeoutMs = 10000
): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })

    if (!response.ok) {
      return null
    }

    return await response.text()
  } catch (e) {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Body of a JSON POST, or null on any failure. */
export async function httpPostJson(
  url: string,
  payload: Record<string, unknown>,
  timeoutMs = 15000
): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!response.ok) {
      return null
    }

    return await response.text()
  } catch (e) {
    return null
  } finally {
    clearTimeout(timer)
  }
}
