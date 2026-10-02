/**
 * Asyntai AI Search for Medusa: the catalogue feed.
 *
 * WHY A FEED AND NOT A CRAWL. Crawling a shop gives us page text, which goes
 * stale the moment a price changes and carries no stock figure at all.
 * Reading the store's own numbers is what lets the search bar show a price, a
 * discount and an availability that are correct today.
 *
 * WHY NOT THE STORE API. Medusa already has /store/products, but reaching it
 * needs a publishable API key tied to a sales channel, and handing that key
 * out is handing out a key that also works from any browser on the internet.
 * This endpoint instead signs every request, so the address alone is worth
 * nothing.
 *
 * WHAT A SHOPPER WOULD SEE IS WHAT IS SENT.
 *   * Only published products.
 *   * The price is Medusa's own calculated price for the store's default
 *     region, so a promotion or a price list a shopper sees, Asyntai sees.
 *   * The currency is that region's currency, because this request has no
 *     shopper and therefore no session currency.
 */
import { QueryContext } from "@medusajs/framework/utils"

import * as State from "./state"

/** Products per page. Asyntai pages through until `pages` is reached. */
export const PAGE_SIZE = 100

/** Hard ceiling, so a hand-made request cannot ask for the whole shop at once. */
export const MAX_PAGE_SIZE = 250

/** How far a signed request's clock may drift, in seconds. */
export const CLOCK_SKEW = 300

/** Longest description we send. Asyntai truncates again; this saves bandwidth. */
export const MAX_DESCRIPTION = 2000

/** Most products one by-id call may name. */
export const MAX_IDS = 50

type Container = { resolve: (key: string) => any }

export type FeedResult = { status: number; body: Record<string, unknown> }

type Region = { id: string; currency_code: string }

const PRODUCT_FIELDS = [
  "id",
  "title",
  "subtitle",
  "handle",
  "description",
  "status",
  "thumbnail",
  "collection.title",
  "categories.name",
  "type.value",
  "tags.value",
  "variants.id",
  "variants.title",
  "variants.sku",
  "variants.manage_inventory",
  "variants.allow_backorder",
  // NOT variants.inventory_quantity. Medusa accepts that field and then
  // leaves it undefined here, which read as "stock unknown" and made every
  // product report In Stock, sold-out ones included. The levels below are
  // where the numbers actually live.
  "variants.inventory_items.required_quantity",
  "variants.inventory_items.inventory.location_levels.stocked_quantity",
  "variants.inventory_items.inventory.location_levels.reserved_quantity",
  "variants.calculated_price.*",
]

/** The same list without prices, for a store whose pricing context fails. */
const PRODUCT_FIELDS_NO_PRICE = PRODUCT_FIELDS.filter(
  (field) => !field.startsWith("variants.calculated_price")
)

function fail(status: number, message: string): FeedResult {
  return { status, body: { ok: false, error: message } }
}

// -----------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------

/**
 * Build the answer for one feed request.
 *
 * Never throws. The caller sets the status code from `status` and sends the
 * rest as JSON.
 */
export async function handle(
  container: Container,
  query: Record<string, unknown>
): Promise<FeedResult> {
  if (!(await State.feedEnabled(container))) {
    return fail(403, "The catalogue feed is switched off for this store.")
  }

  // The token alone decides. Asyntai starts reading the catalogue the moment
  // the owner signs in, BEFORE this store has polled for its site id, and
  // refusing that first read would mark the store as disconnected at
  // Asyntai's end.
  const token = await State.feedToken(container)

  if (!token) {
    return fail(403, "This store is not connected to Asyntai.")
  }

  const rawPage = query.page === undefined ? "" : String(query.page)
  const rawLimit = query.limit === undefined ? "" : String(query.limit)
  const ids = query.ids === undefined ? "" : String(query.ids)
  const ts = query.ts === undefined ? "" : String(query.ts)
  const sig = query.sig === undefined ? "" : String(query.sig)

  // The signature covers the values AFTER they are read but BEFORE they are
  // clamped, so the string signed by Asyntai is the string checked here.
  const signed =
    "page=" + rawPage + "&limit=" + rawLimit + "&ids=" + ids + "&ts=" + ts

  if (!ts || !/^[0-9]+$/.test(ts)) {
    return fail(403, "Missing timestamp.")
  }

  // A replayed request is worth little here, but a signature with no expiry
  // is a credential that never dies. Five minutes is enough for any clock a
  // shop server is likely to keep.
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) > CLOCK_SKEW) {
    return fail(403, "The request has expired.")
  }

  const { createHmac, timingSafeEqual } = await import("crypto")
  const expected = createHmac("sha256", token).update(signed).digest("hex")

  if (!sig || sig.length !== expected.length) {
    return fail(403, "Bad signature.")
  }

  if (
    !timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))
  ) {
    return fail(403, "Bad signature.")
  }

  let page = Number(rawPage) || 1
  let limit = Number(rawLimit) || PAGE_SIZE

  if (!Number.isFinite(page) || page < 1) {
    page = 1
  }

  if (!Number.isFinite(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    limit = PAGE_SIZE
  }

  try {
    if (ids) {
      return await byIds(container, ids)
    }

    return await byPage(container, Math.floor(page), Math.floor(limit))
  } catch (e: any) {
    return fail(500, "The store could not read its catalogue: " + String(e?.message || e))
  }
}

// -----------------------------------------------------------------
// Reading the catalogue
// -----------------------------------------------------------------

/**
 * The region whose prices this feed quotes.
 *
 * The store's default region where it names one, and the first region
 * otherwise. A Medusa always has at least one, because a store with none can
 * take no orders.
 */
async function defaultRegion(container: Container): Promise<Region | null> {
  const query = container.resolve("query")

  try {
    const { data } = await query.graph({
      entity: "region",
      fields: ["id", "currency_code"],
    })

    if (!Array.isArray(data) || !data.length) {
      return null
    }

    return { id: String(data[0].id), currency_code: String(data[0].currency_code || "") }
  } catch (e) {
    return null
  }
}

/**
 * Ask Medusa for products, with prices where the store can price them.
 *
 * A store with no region, or one whose pricing context Medusa refuses, still
 * has a searchable catalogue: names, descriptions and categories are what
 * most questions are answered from. So a pricing failure drops the prices and
 * keeps the products, rather than failing the whole read.
 */
async function fetchProducts(
  container: Container,
  region: Region | null,
  filters: Record<string, unknown>,
  pagination: Record<string, unknown>
): Promise<{ rows: any[]; count: number }> {
  const query = container.resolve("query")

  if (region) {
    try {
      const result = await query.graph({
        entity: "product",
        fields: PRODUCT_FIELDS,
        filters,
        pagination,
        context: {
          variants: {
            calculated_price: QueryContext({
              region_id: region.id,
              currency_code: region.currency_code,
            }),
          },
        },
      })

      return {
        rows: Array.isArray(result.data) ? result.data : [],
        count: Number(result.metadata?.count ?? result.data?.length ?? 0),
      }
    } catch (e) {
      // Fall through to the price-free read below.
    }
  }

  const result = await query.graph({
    entity: "product",
    fields: PRODUCT_FIELDS_NO_PRICE,
    filters,
    pagination,
  })

  return {
    rows: Array.isArray(result.data) ? result.data : [],
    count: Number(result.metadata?.count ?? result.data?.length ?? 0),
  }
}

/**
 * One page of the catalogue, in a stable order.
 *
 * Ordered by id rather than by title, so a rename between two pages cannot
 * make a product appear twice or not at all.
 */
async function byPage(
  container: Container,
  page: number,
  limit: number
): Promise<FeedResult> {
  const region = await defaultRegion(container)
  const storefront = await State.storefrontUrl(container)
  const pattern = await productPattern(container)

  const { rows, count } = await fetchProducts(
    container,
    region,
    { status: "published" },
    { skip: (page - 1) * limit, take: limit, order: { id: "ASC" } }
  )

  const products = rows
    .map((row) => one(row, region, storefront, pattern))
    .filter((row) => row !== null)

  return {
    status: 200,
    body: {
      ok: true,
      store: await storeInfo(container, region),
      page,
      pages: limit > 0 ? Math.max(1, Math.ceil(count / limit)) : 1,
      total: count,
      products,
    },
  }
}

/**
 * Named products only.
 *
 * Asyntai calls this just before it answers a shopper, to make sure the price
 * and the stock it is about to quote are the ones the shop is charging right
 * now.
 */
async function byIds(container: Container, ids: string): Promise<FeedResult> {
  const wanted: string[] = []

  for (const raw of ids.split(",")) {
    const id = raw.trim()

    if (id && !wanted.includes(id)) {
      wanted.push(id)
    }

    if (wanted.length >= MAX_IDS) {
      break
    }
  }

  const region = await defaultRegion(container)
  const storefront = await State.storefrontUrl(container)
  const pattern = await productPattern(container)

  // Through the same published test as a page, so a product the owner has
  // since unpublished is not quoted from a stale id.
  const { rows } = await fetchProducts(
    container,
    region,
    { id: wanted, status: "published" },
    { take: MAX_IDS }
  )

  const products = rows
    .map((row) => one(row, region, storefront, pattern))
    .filter((row) => row !== null)

  return {
    status: 200,
    body: {
      ok: true,
      store: await storeInfo(container, region),
      page: 1,
      pages: 1,
      total: products.length,
      products,
    },
  }
}

// -----------------------------------------------------------------
// Rendering one product
// -----------------------------------------------------------------

/**
 * The path a shopper lands on, with {handle} standing for the product.
 *
 * A setting rather than a constant, because a headless storefront chooses its
 * own routes. The Medusa Next.js starter puts a country code in front of
 * every path, so a store using it sets `/us/products/{handle}` here and its
 * search results point at pages that exist.
 */
async function productPattern(container: Container): Promise<string> {
  const saved = (await State.get(container, "product_path")).trim()
  return saved || "/products/{handle}"
}

function one(
  row: any,
  region: Region | null,
  storefront: string,
  pattern: string
): Record<string, unknown> | null {
  if (!row || !row.id) {
    return null
  }

  const title = plainText(String(row.title || ""))

  if (!title) {
    return null
  }

  const out: Record<string, unknown> = { id: String(row.id), name: title }

  const description = plainText(
    String(row.description || "") || String(row.subtitle || "")
  )

  if (description) {
    out.description = description
  }

  const variants: any[] = Array.isArray(row.variants) ? row.variants : []
  const sku = String(variants[0]?.sku || "").trim()

  if (sku) {
    out.sku = sku
    // What OpenCart calls the model. Sent under both names so the reader that
    // already knows one shape needs no new branch.
    out.model = sku
  }

  const [regular, final] = prices(variants)

  if (final !== null && regular !== null && final < regular) {
    out.price = money(regular)
    out.special = money(final)
  } else if (final !== null) {
    out.price = money(final)
  } else if (regular !== null) {
    out.price = money(regular)
  }

  const currency = currencyOf(variants) || region?.currency_code || ""

  if (currency) {
    out.currency = currency.toUpperCase()
  }

  const inStock = saleable(variants)
  const quantity = stockQuantity(variants)

  // A product still for sale at 0 (backorders) gets no number, so the feed
  // never says 0 and In Stock about the same product.
  if (quantity !== null && !(quantity <= 0 && inStock)) {
    out.quantity = quantity
  }

  out.stock_status = inStock ? "In Stock" : "Out Of Stock"

  const categories = names(row.categories, "name")

  if (row.collection?.title) {
    categories.unshift(String(row.collection.title))
  }

  if (categories.length) {
    out.categories = categories
  }

  const tags = names(row.tags, "value")

  if (tags.length) {
    out.tags = tags
  }

  out.url = productUrl(storefront, pattern, String(row.handle || ""))

  const image = String(row.thumbnail || "").trim()

  if (image) {
    out.image_url = image
  }

  return out
}

/**
 * The cheapest regular and the cheapest final price across the variants.
 *
 * The cheapest rather than the first, because that is the number a shop shows
 * on a listing page when a product has several variants, and therefore the
 * number a shopper has already seen before they search.
 */
function prices(variants: any[]): [number | null, number | null] {
  let regular: number | null = null
  let final: number | null = null

  for (const variant of variants) {
    const calculated = variant?.calculated_price

    if (!calculated) {
      continue
    }

    const withTax = toNumber(calculated.calculated_amount)
    const originalWithTax = toNumber(calculated.original_amount)

    if (withTax !== null && (final === null || withTax < final)) {
      final = withTax
    }

    if (
      originalWithTax !== null &&
      (regular === null || originalWithTax < regular)
    ) {
      regular = originalWithTax
    }
  }

  if (regular === null) {
    regular = final
  }

  if (final === null) {
    final = regular
  }

  return [regular, final]
}

function currencyOf(variants: any[]): string {
  for (const variant of variants) {
    const code = variant?.calculated_price?.currency_code

    if (code) {
      return String(code)
    }
  }

  return ""
}

/**
 * How many of one variant a shopper could buy, or null when Medusa does not
 * count this variant's stock.
 *
 * A variant can sit on several inventory items, and every one of them is
 * needed to ship it. So the answer is the SMALLEST of them, not the sum: a kit
 * with a thousand boxes and two lids can ship two kits.
 */
function variantQuantity(variant: any): number | null {
  if (!variant?.manage_inventory) {
    return null
  }

  const items = Array.isArray(variant.inventory_items)
    ? variant.inventory_items
    : []

  if (!items.length) {
    return null
  }

  let smallest: number | null = null

  for (const item of items) {
    const levels = Array.isArray(item?.inventory?.location_levels)
      ? item.inventory.location_levels
      : []

    let available = 0

    for (const level of levels) {
      const stocked = toNumber(level?.stocked_quantity) ?? 0
      const reserved = toNumber(level?.reserved_quantity) ?? 0
      available += stocked - reserved
    }

    // How many of this item one unit of the variant consumes. Absent on an
    // older store, where one is the only answer it ever had.
    const required = toNumber(item?.required_quantity) ?? 1
    const buildable = required > 0 ? Math.floor(available / required) : available

    if (smallest === null || buildable < smallest) {
      smallest = buildable
    }
  }

  return smallest
}

/**
 * How many are in stock across the product, or null when the store does not
 * count them.
 *
 * Null and zero are different answers: a product whose stock Medusa does not
 * manage is always buyable, and reporting it as zero would make the bar say a
 * shop is out of something it sells.
 */
function stockQuantity(variants: any[]): number | null {
  let total = 0
  let counted = false

  for (const variant of variants) {
    // A variant that sells without limit (stock not managed, or backorders
    // allowed) makes any total an undercount of what a shopper can buy.
    if (!variant?.manage_inventory || variant?.allow_backorder) {
      return null
    }

    const quantity = variantQuantity(variant)

    if (quantity === null) {
      return null
    }

    counted = true
    total += Math.max(0, quantity)
  }

  return counted ? total : null
}

function saleable(variants: any[]): boolean {
  if (!variants.length) {
    return false
  }

  for (const variant of variants) {
    if (!variant?.manage_inventory || variant?.allow_backorder) {
      return true
    }

    const quantity = variantQuantity(variant)

    // Unknown is not the same as none. A variant Medusa cannot count is one
    // the storefront still sells.
    if (quantity === null || quantity > 0) {
      return true
    }
  }

  return false
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null
  }

  const parsed = Number(value)

  return Number.isFinite(parsed) ? parsed : null
}

/**
 * A price as a plain decimal string.
 *
 * Deliberately NOT run through a currency formatter. A formatted string
 * carries a symbol, a thousands separator and a session currency, none of
 * which survive being read back as a number.
 */
function money(value: number): string {
  return value.toFixed(4)
}

/** Layers of escaping undone before tags are removed. Real data has one or two. */
const MAX_DECODE_PASSES = 5

/**
 * HTML reduced to the text a shopper would read. Used for names too.
 *
 * Entities are decoded FIRST, until nothing changes, and tags are removed
 * after that. In the other order an escaped value ("&lt;b&gt;") comes back
 * as live markup once the strip is done.
 *
 * Because the text is decoded before the strip, a tag is matched only when
 * "<" is followed by a letter or "/", so "5 < 10 cm" keeps its words.
 */
function plainText(html: string): string {
  let text = String(html || "")

  for (let i = 0; i < MAX_DECODE_PASSES; i++) {
    const decoded = decodeEntities(text)

    if (decoded === text) {
      break
    }

    text = decoded
  }

  // Until nothing changes: removing one tag can join the pieces around it
  // into another ("<scr<b>ipt>").
  for (let i = 0; i < MAX_DECODE_PASSES; i++) {
    const before = text
    text = text.replace(/<script\b[\s\S]*?(?:<\/script\s*>|$)/gi, " ")
    text = text.replace(/<style\b[\s\S]*?(?:<\/style\s*>|$)/gi, " ")
    text = text.replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
    text = text.replace(/<\/?[a-zA-Z][^<>]*>/g, " ")
    // A tag cut off at the very end, with no ">" to close it.
    text = text.replace(/<\/?[a-zA-Z][^<>]*$/, " ")

    if (text === before) {
      break
    }
  }

  // A non-breaking space is not matched by \s, so it is named here.
  text = text.replace(/[\s ]+/g, " ").trim()

  if (text.length > MAX_DESCRIPTION) {
    text = text.slice(0, MAX_DESCRIPTION)
  }

  return text
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  deg: "°", euro: "€", pound: "£", copy: "©", reg: "®", trade: "™",
  hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", times: "×",
}

/**
 * One round of entity decoding: the common named ones and every numeric one.
 * Each entity is read from the text as it stood before this round, so
 * "&amp;lt;" becomes "&lt;" here and "<" only on the next round.
 */
function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10)

      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) {
        return whole
      }

      try {
        return String.fromCodePoint(code)
      } catch (e) {
        return whole
      }
    }

    const named = NAMED_ENTITIES[body.toLowerCase()]

    return named === undefined ? whole : named
  })
}

function names(rows: unknown, key: string): string[] {
  if (!Array.isArray(rows)) {
    return []
  }

  const out: string[] = []

  for (const row of rows) {
    const value = String((row as any)?.[key] || "").trim()

    if (value && !out.includes(value)) {
      out.push(value)
    }
  }

  return out
}

/**
 * The address a shopper lands on.
 *
 * Built from the stored storefront address rather than from this request,
 * because this request came from Asyntai to the BACKEND. Using the request's
 * own host would hand out links to an address no shopper can reach.
 */
function productUrl(storefront: string, pattern: string, handle: string): string {
  if (!storefront || !handle) {
    return ""
  }

  const path = pattern.includes("{handle}")
    ? pattern.replace("{handle}", encodeURIComponent(handle))
    : pattern.replace(/\/+$/, "") + "/" + encodeURIComponent(handle)

  return storefront.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "")
}

// -----------------------------------------------------------------
// The store itself
// -----------------------------------------------------------------

async function storeInfo(
  container: Container,
  region: Region | null
): Promise<Record<string, unknown>> {
  let name = ""

  try {
    const query = container.resolve("query")
    const { data } = await query.graph({ entity: "store", fields: ["name"] })
    name = String(data?.[0]?.name || "")
  } catch (e) {
    name = ""
  }

  return {
    name: name || "Medusa",
    url: await State.storefrontUrl(container),
    currency: (region?.currency_code || "").toUpperCase(),
    platform: "medusa",
    // Named, so that a bare version number never has to be guessed at.
    version: "Medusa " + medusaVersion(),
  }
}

function medusaVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return String(require("@medusajs/medusa/package.json").version || "")
  } catch (e) {
    return ""
  }
}
