/**
 * Calls from the settings screen to this plugin's own admin routes.
 *
 * The Medusa dashboard signs its own requests with a session cookie, and
 * several hosted setups instead hold a bearer token in local storage. Which
 * one is in use is not something a plugin can know, so both are sent: the
 * cookie always, the token when there is one. A route that only wants one of
 * them ignores the other.
 */
const TOKEN_KEYS = ["medusa_auth_token", "medusa_jwt", "auth_token"]

function bearer(): Record<string, string> {
  try {
    for (const key of TOKEN_KEYS) {
      const raw = window.localStorage.getItem(key)

      if (raw) {
        // Some builds store the token JSON-encoded, some store it bare.
        const token = raw.startsWith('"') ? JSON.parse(raw) : raw

        if (typeof token === "string" && token.length > 10) {
          return { Authorization: "Bearer " + token }
        }
      }
    }
  } catch (e) {
    // A browser that refuses local storage still has its cookie.
  }

  return {}
}

export async function call(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<any> {
  const method = options.method || "GET"

  const response = await fetch("/admin/asyntai-search" + path, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...bearer(),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  let payload: any = null

  try {
    payload = await response.json()
  } catch (e) {
    payload = null
  }

  if (!response.ok) {
    throw new Error(
      (payload && (payload.error || payload.message)) ||
        "The request failed (HTTP " + response.status + ")."
    )
  }

  return payload
}
