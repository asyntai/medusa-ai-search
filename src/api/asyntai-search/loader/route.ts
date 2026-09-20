import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import * as State from "../../../lib/state"

/**
 * GET /asyntai-search/loader
 *
 * The one tag a headless storefront has to carry.
 *
 * WHY A LOADER AND NOT THE WIDGET TAG ITSELF. Every other platform we ship
 * for renders its own pages, so the plugin writes the widget tag into them
 * and every setting takes effect at once. A headless storefront is a separate
 * application that this plugin cannot edit, so the merchant pastes one tag
 * into it, once. This route is what makes that tag enough: the site id, the
 * placement, the accent colour and the on/off decision all arrive from here,
 * so changing any of them in Medusa reaches shoppers without anybody opening
 * the storefront's source again.
 *
 * WHY NOT /store. Medusa demands a publishable API key on every /store route,
 * and a key pasted into a public storefront tag is a key handed to everyone.
 * A route of our own carries no such requirement and needs no such key.
 *
 * NOTHING IS PRINTED unless Asyntai has said yes. That is the one rule this
 * plugin exists to enforce: a search box that cannot answer is worse than no
 * search box, because in replace mode it has hidden the storefront's own
 * search behind it.
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const container = req.scope

  // This is the shopper traffic the status refresh rides on. It claims its
  // slot before calling out, so an unreachable Asyntai costs one shopper a
  // short wait rather than every shopper the full timeout.
  try {
    await State.refreshFromSite(container)
  } catch (e) {
    // A refresh that failed leaves the last answer in place, which is the
    // behaviour we want anyway.
  }

  const siteId = await State.siteId(container)
  const on = siteId !== "" && (await State.enabled(container))

  res.setHeader("Content-Type", "application/javascript; charset=utf-8")

  // Short, not zero. Long enough that a busy storefront does not ask on every
  // page view, short enough that switching the bar off reaches shoppers the
  // same day.
  res.setHeader("Cache-Control", "public, max-age=300")

  // A storefront is a different origin from this backend, and some setups
  // fetch this file rather than script-tag it.
  res.setHeader("Access-Control-Allow-Origin", "*")

  if (!on) {
    // A valid, empty script. A 404 here would print an error in every
    // shopper's console for a store that has simply not finished connecting.
    res.send("/* Asyntai AI Search: not enabled for this store. */\n")
    return
  }

  const attributes: Record<string, string> = {
    src: State.scriptUrl(),
    "data-asyntai-id": siteId,
  }

  // The widget calls asyntai.com unless told otherwise. A store pointed at a
  // staging copy of Asyntai has to say so on the tag as well, or its server
  // and its shoppers' browsers would talk to different servers.
  if (State.origin() !== State.DEFAULT_ORIGIN) {
    attributes["data-api-base"] = State.origin()
  }

  if ((await State.placement(container)) === "replace") {
    const selector = await State.selector(container)
    attributes["data-replace"] = selector || "auto"
  }

  const accent = await State.accent(container)

  if (accent) {
    attributes["data-accent"] = accent
  }

  const placeholder = await State.placeholder(container)

  if (placeholder) {
    attributes["data-placeholder"] = placeholder
  }

  res.send(script(attributes))
}

/**
 * One value, as a JavaScript string literal that is safe anywhere.
 *
 * JSON.stringify already stops a quote ending the string. The extra escape of
 * "<" stops a placeholder containing "</script>" from closing the block if a
 * storefront ever inlines this file instead of loading it by src, which is not
 * how we document it but is not ours to prevent.
 */
function literal(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003C")
}

/**
 * The script that adds the widget tag.
 *
 * Values go through `literal` rather than into a template, so a placeholder
 * the owner typed cannot become code.
 */
function script(attributes: Record<string, string>): string {
  const lines = [
    "/* Asyntai AI Search for Medusa */",
    "(function () {",
    '  if (document.querySelector("script[data-asyntai-id]")) { return; }',
    '  var s = document.createElement("script");',
    "  s.async = true;",
  ]

  for (const [name, value] of Object.entries(attributes)) {
    if (name === "src") {
      lines.push("  s.src = " + literal(value) + ";")
    } else {
      lines.push(
        "  s.setAttribute(" + literal(name) + ", " + literal(value) + ");"
      )
    }
  }

  lines.push(
    // In the head rather than after the load event, unlike our chat widget:
    // this bar sits in the header, and a late swap means the shopper watches
    // the storefront's search box get replaced in front of them.
    "  (document.head || document.documentElement).appendChild(s);",
    "})();",
    ""
  )

  return lines.join("\n")
}
