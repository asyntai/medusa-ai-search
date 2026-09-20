import { defineRouteConfig } from "@medusajs/admin-sdk"
import { MagnifyingGlass } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Select,
  Switch,
  Text,
  Textarea,
  toast,
} from "@medusajs/ui"
import { useCallback, useEffect, useRef, useState } from "react"

import { call } from "../../lib/api"

type Panel = {
  site_id: string
  account_email: string
  connected: boolean
  state: "live" | "setting_up" | "blocked" | "unknown"
  status: Record<string, any> | null
  message: string
  preview_url: string
  storefront_url: string
  backend_url: string
  loader_url: string
  feed_url: string
  feed_enabled: boolean
  placement: string
  selector: string
  accent: string
  placeholder: string
  product_path: string
}

const BADGE: Record<string, { color: any; label: string }> = {
  live: { color: "green", label: "Live" },
  setting_up: { color: "orange", label: "Setting up" },
  blocked: { color: "red", label: "Off" },
  unknown: { color: "grey", label: "Unknown" },
}

const AsyntaiSearchPage = () => {
  const [panel, setPanel] = useState<Panel | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState("")
  const [form, setForm] = useState<Partial<Panel>>({})
  const [copied, setCopied] = useState(false)
  const polling = useRef<number | null>(null)

  const load = useCallback(async () => {
    try {
      const data = (await call("")) as Panel
      setPanel(data)
      setForm({
        storefront_url: data.storefront_url,
        backend_url: data.backend_url,
        product_path: data.product_path,
        placement: data.placement,
        selector: data.selector,
        accent: data.accent,
        placeholder: data.placeholder,
        feed_enabled: data.feed_enabled,
      })
    } catch (e: any) {
      toast.error("Could not load the settings", { description: e.message })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()

    return () => {
      if (polling.current) {
        window.clearInterval(polling.current)
      }
    }
  }, [load])

  const snippet = panel
    ? '<script async src="' + panel.loader_url + '"></script>'
    : ""

  // -----------------------------------------------------------------
  // Connecting
  // -----------------------------------------------------------------

  const connect = async () => {
    setBusy("connect")

    try {
      const started = await call("/prepare", { method: "POST" })
      const popup = window.open(started.url, "asyntai_connect", "width=820,height=760")

      if (!popup) {
        toast.error("The sign-in window was blocked", {
          description: "Allow pop-ups for this page and press Connect again.",
        })
        setBusy("")
        return
      }

      let attempts = 0

      polling.current = window.setInterval(async () => {
        attempts += 1

        if (attempts > 150) {
          window.clearInterval(polling.current!)
          setBusy("")
          toast.error("The sign-in window timed out", {
            description: "Press Connect to start again.",
          })
          return
        }

        try {
          const answer = await call("/poll?state=" + encodeURIComponent(started.state))

          if (!answer.ready) {
            return
          }

          window.clearInterval(polling.current!)

          await call("/finish", {
            method: "POST",
            body: {
              site_id: answer.site_id,
              account_email: answer.account_email,
            },
          })

          try {
            popup.close()
          } catch (e) {
            // A pop-up we cannot close is one the owner closes themselves.
          }

          toast.success("Connected to Asyntai")
          setBusy("")
          await load()
        } catch (e: any) {
          window.clearInterval(polling.current!)
          setBusy("")
          toast.error("Connecting failed", { description: e.message })
        }
      }, 2000)
    } catch (e: any) {
      setBusy("")
      toast.error("Connecting failed", { description: e.message })
    }
  }

  const disconnect = async () => {
    if (!window.confirm("Disconnect this store from Asyntai?")) {
      return
    }

    setBusy("disconnect")

    try {
      await call("/disconnect", { method: "POST" })
      toast.success("Disconnected")
      await load()
    } catch (e: any) {
      toast.error("Could not disconnect", { description: e.message })
    } finally {
      setBusy("")
    }
  }

  const refresh = async () => {
    setBusy("refresh")

    try {
      const answer = await call("/refresh", { method: "POST" })
      toast[answer.ok ? "success" : "warning"](answer.message)
      await load()
    } catch (e: any) {
      toast.error("Could not refresh", { description: e.message })
    } finally {
      setBusy("")
    }
  }

  const save = async () => {
    setBusy("save")

    try {
      const answer = await call("/settings", { method: "POST", body: form })

      if (answer.reconnect_needed) {
        toast.warning("Saved. Connect again.", {
          description:
            "The backend address changed, and Asyntai still reads the catalogue from the old one.",
        })
      } else {
        toast.success("Saved")
      }

      await load()
    } catch (e: any) {
      toast.error("Could not save", { description: e.message })
    } finally {
      setBusy("")
    }
  }

  const field = (key: keyof Panel) => ({
    value: (form[key] as string) ?? "",
    onChange: (event: { target: { value: string } }) =>
      setForm((current) => ({ ...current, [key]: event.target.value })),
  })

  if (loading) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h1">AI Search</Heading>
        </div>
        <div className="px-6 py-4">
          <Text>Loading…</Text>
        </div>
      </Container>
    )
  }

  if (!panel) {
    return (
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h1">AI Search</Heading>
        </div>
        <div className="px-6 py-4">
          <Text>
            The settings could not be read. Run <code>npx medusa db:migrate</code>{" "}
            and reload this page.
          </Text>
        </div>
      </Container>
    )
  }

  const badge = BADGE[panel.state] || BADGE.unknown
  const sync = panel.status?.sync as
    | { status?: string; count?: number; error?: string }
    | null
    | undefined

  return (
    <div className="flex flex-col gap-y-3">
      {/* Status */}
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-x-3">
            <Heading level="h1">AI Search</Heading>
            {panel.connected && <Badge color={badge.color}>{badge.label}</Badge>}
          </div>
          <div className="flex items-center gap-x-2">
            {panel.connected && (
              <Button
                variant="secondary"
                size="small"
                isLoading={busy === "refresh"}
                onClick={refresh}
              >
                Check again
              </Button>
            )}
            {panel.connected && panel.preview_url && (
              <Button
                variant="secondary"
                size="small"
                onClick={() => window.open(panel.preview_url, "_blank", "noopener")}
              >
                Try it
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-y-2 px-6 py-4">
          <Text>{panel.message}</Text>

          {panel.connected && panel.account_email && (
            <Text size="small" className="text-ui-fg-subtle">
              Connected as {panel.account_email}
            </Text>
          )}

          {sync?.status === "syncing" && (
            <Text size="small" className="text-ui-fg-subtle">
              Reading the catalogue now.
            </Text>
          )}

          {sync?.status === "error" && sync.error && (
            <Text size="small" className="text-ui-fg-error">
              The last catalogue read failed: {sync.error}
            </Text>
          )}

          {!panel.connected && (
            <div className="pt-2">
              <Button isLoading={busy === "connect"} onClick={connect}>
                Connect to Asyntai
              </Button>
              <Text size="small" className="pt-2 text-ui-fg-subtle">
                A free account is enough to start. The bar switches itself on
                once Asyntai has read your catalogue.
              </Text>
            </div>
          )}

          {panel.connected && (
            <div className="pt-2">
              <Button
                variant="danger"
                size="small"
                isLoading={busy === "disconnect"}
                onClick={disconnect}
              >
                Disconnect
              </Button>
            </div>
          )}
        </div>
      </Container>

      {/* The tag for the storefront */}
      {panel.connected && (
        <Container className="divide-y p-0">
          <div className="px-6 py-4">
            <Heading level="h2">Add one tag to your storefront</Heading>
          </div>
          <div className="flex flex-col gap-y-3 px-6 py-4">
            <Text size="small" className="text-ui-fg-subtle">
              Paste this into the <code>&lt;head&gt;</code> of your storefront.
              Paste it once: every setting on this page reaches it from here, so
              you never have to edit the storefront again.
            </Text>

            <Textarea readOnly rows={2} value={snippet} />

            <div>
              <Button
                variant="secondary"
                size="small"
                onClick={() => {
                  navigator.clipboard.writeText(snippet)
                  setCopied(true)
                  window.setTimeout(() => setCopied(false), 2000)
                  toast.success("Copied")
                }}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        </Container>
      )}

      {/* Settings */}
      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">Settings</Heading>
        </div>

        <div className="flex flex-col gap-y-4 px-6 py-4">
          <div className="flex flex-col gap-y-1">
            <Label size="small" weight="plus">
              Storefront address
            </Label>
            <Input placeholder="https://shop.example.com" {...field("storefront_url")} />
            <Text size="small" className="text-ui-fg-subtle">
              Where shoppers are. Asyntai indexes this address, and every
              product link in a search result is built from it.
            </Text>
          </div>

          <div className="flex flex-col gap-y-1">
            <Label size="small" weight="plus">
              Backend address
            </Label>
            <Input placeholder="https://api.example.com" {...field("backend_url")} />
            <Text size="small" className="text-ui-fg-subtle">
              Where this Medusa answers. The catalogue feed and the tag above
              live here, so it has to be an address Asyntai can reach.
            </Text>
          </div>

          <div className="flex flex-col gap-y-1">
            <Label size="small" weight="plus">
              Product path
            </Label>
            <Input placeholder="/products/{handle}" {...field("product_path")} />
            <Text size="small" className="text-ui-fg-subtle">
              How your storefront addresses a product. The Medusa Next.js
              starter puts a country code first, so it wants{" "}
              <code>/us/products/&#123;handle&#125;</code>.
            </Text>
          </div>

          <div className="flex flex-col gap-y-1">
            <Label size="small" weight="plus">
              Where the bar goes
            </Label>
            <Select
              value={(form.placement as string) || "replace"}
              onValueChange={(value) =>
                setForm((current) => ({ ...current, placement: value }))
              }
            >
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="replace">
                  Replace the storefront's own search box
                </Select.Item>
                <Select.Item value="manual">
                  Only where I put a placeholder
                </Select.Item>
              </Select.Content>
            </Select>
            <Text size="small" className="text-ui-fg-subtle">
              With a placeholder, add{" "}
              <code>&lt;div data-asyntai-search&gt;&lt;/div&gt;</code> wherever
              you want the bar.
            </Text>
          </div>

          {form.placement !== "manual" && (
            <div className="flex flex-col gap-y-1">
              <Label size="small" weight="plus">
                Search box to replace
              </Label>
              <Input placeholder="Leave empty to find it automatically" {...field("selector")} />
              <Text size="small" className="text-ui-fg-subtle">
                A CSS selector, for a storefront whose search box we do not
                find on our own.
              </Text>
            </div>
          )}

          <div className="flex flex-col gap-y-1">
            <Label size="small" weight="plus">
              Accent colour
            </Label>
            <Input placeholder="#0f172a" {...field("accent")} />
          </div>

          <div className="flex flex-col gap-y-1">
            <Label size="small" weight="plus">
              Placeholder text
            </Label>
            <Input placeholder="Ask anything…" {...field("placeholder")} />
          </div>

          <div className="flex items-start justify-between gap-x-4 border-t pt-4">
            <div className="flex flex-col gap-y-1">
              <Label size="small" weight="plus">
                Let Asyntai read the catalogue
              </Label>
              <Text size="small" className="text-ui-fg-subtle">
                On, the bar answers with the price and the stock your shop is
                showing right now. Off, it answers from your pages alone.
              </Text>
              {panel.connected && (
                <Text size="small" className="text-ui-fg-muted">
                  Feed: <code>{panel.feed_url}</code>
                </Text>
              )}
            </div>
            <Switch
              checked={form.feed_enabled !== false}
              onCheckedChange={(checked) =>
                setForm((current) => ({ ...current, feed_enabled: checked }))
              }
            />
          </div>

          <div>
            <Button isLoading={busy === "save"} onClick={save}>
              Save
            </Button>
          </div>
        </div>
      </Container>
    </div>
  )
}

export const config = defineRouteConfig({
  label: "AI Search",
  icon: MagnifyingGlass,
})

export default AsyntaiSearchPage
