# Asyntai AI Search for Medusa

A search bar that understands what a shopper means, and answers from your own
catalogue.

Somebody types "something warm for cold weather" and the bar finds your
sweatpants, although not one of those words is in the product name. It answers
with the price, the discount and the stock your store is showing right now,
because it reads your catalogue rather than your pages.

## Why choose Asyntai?

- **Shoppers find things they cannot name.** Plain language works, and so do
  misspellings and questions.
- **Live prices and stock.** A price list or a promotion in Medusa reaches the
  search results.
- **Works in all languages.** The bar answers in the shopper's own language.
- **One tag, then never again.** Every setting on the admin screen reaches
  your storefront from the plugin, so you paste one line and stop.
- **Free to start.** A free Asyntai account is enough.

## Install

```bash
npm install @asyntai/medusa-plugin-ai-search
```

Add it to `medusa-config.ts`:

```ts
module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "@asyntai/medusa-plugin-ai-search",
      options: {},
    },
  ],
})
```

Then create the plugin's table and restart:

```bash
npx medusa db:migrate
```

## Connect

1. Open **AI Search** in the Medusa admin.
2. Check the **Storefront address**. That is where shoppers are, and it is
   what Asyntai indexes. The plugin guesses it from `STORE_CORS`, so it is
   usually right already.
3. Press **Connect to Asyntai** and sign in, or create a free account.
4. Asyntai starts reading your catalogue. The bar switches itself on when that
   is done.

## Put the bar on your storefront

Medusa is headless, so your storefront is a separate application and this
plugin cannot edit it. Paste the tag the admin screen shows you into your
storefront, once:

```html
<script async src="https://YOUR-MEDUSA/asyntai-search/loader"></script>
```

Everything else, the site id, the placement, the accent colour, and whether
the bar shows at all, arrives from that address. Change a setting in Medusa
and your storefront follows within five minutes. You never edit the storefront
again.

### The Medusa Next.js starter

The starter uses the Next.js App Router, which drops a plain `<script>` tag
written into `<head>`. Use `next/script` in `src/app/layout.tsx` instead:

```tsx
import Script from "next/script"

// inside <body>
<Script
  src="https://YOUR-MEDUSA/asyntai-search/loader"
  strategy="afterInteractive"
/>
```

The starter also ships no search box of its own, so there is nothing for the
bar to replace. Set **Where the bar goes** to *Only where I put a placeholder*
and add this wherever you want it:

```tsx
<div data-asyntai-search />
```

Set **Product path** to `/{countryCode}/products/{handle}` for your own
default region, for example `/us/products/{handle}`. That is how the starter
addresses a product, and it is how search results link to one.

## Settings

| Setting | What it does |
| --- | --- |
| Storefront address | Where shoppers are. Asyntai indexes it, and product links are built from it. |
| Backend address | Where this Medusa answers. The catalogue feed and the tag live here, so Asyntai has to be able to reach it. |
| Product path | How your storefront addresses a product. `{handle}` stands for the product. |
| Where the bar goes | Replace the storefront's own search box, or render only where you put a placeholder. |
| Search box to replace | A CSS selector, for a storefront whose search box is not found automatically. |
| Accent colour | The bar's own colour. |
| Placeholder text | What the empty bar says. |
| Let Asyntai read the catalogue | On, the bar answers with live prices and stock. Off, it answers from your pages alone. |

Changing the **Backend address** after connecting means Asyntai still reads
the catalogue from the old one. The screen says so, and pressing Connect again
fixes it.

## The catalogue feed

The plugin exposes one read-only endpoint, `GET /asyntai-search/feed`, and
Asyntai is its only caller. Every request carries a timestamp and an
HMAC-SHA256 signature keyed with a token this store generated and handed over
once, during connect. The store refuses a request whose clock is more than
five minutes out, so a captured address stops working almost at once.

It is deliberately not under `/store`. A `/store` route needs a publishable
API key, and a key that a server uses is one more secret to hold for no gain.

## Requirements

- Medusa 2.x
- Node 20 or newer
- PostgreSQL

## Licence

MIT.

## A question?

Email hello@asyntai.com, or ask the chatbot at
[asyntai.com](https://asyntai.com/).
