/** Name of the cookie carrying the admin session token. */
export const ADMIN_SESSION_COOKIE = 'companion_admin_session'

/**
 * Pull a single cookie value out of a raw `Cookie` header.
 *
 * Companion does not depend on a cookie-parser package: this is the only cookie it reads, and a
 * websocket upgrade never passes through express middleware anyway, so the header has to be parsed
 * by hand there regardless.
 */
export function parseCookie(header: string | undefined, name: string): string | undefined {
	if (!header) return undefined

	for (const part of header.split(';')) {
		const separator = part.indexOf('=')
		if (separator < 0) continue

		if (part.slice(0, separator).trim() !== name) continue

		try {
			return decodeURIComponent(part.slice(separator + 1).trim())
		} catch (_e) {
			// A malformed percent-escape means this isn't a token we issued
			return undefined
		}
	}

	return undefined
}

/**
 * Build the `Set-Cookie` value for a session token, or for clearing it when `token` is null.
 *
 * `HttpOnly` keeps the token out of reach of page scripts, so an XSS bug in the web UI cannot read
 * an admin session out of the browser. `SameSite=Lax` means a cross-site form post cannot carry it,
 * which is what stops another page in the operator's browser from driving Companion (CSRF).
 *
 * `Secure` is deliberately not set: Companion is very often served over plain HTTP on a production
 * LAN, and a Secure cookie would silently never be stored there. That is an accepted trade-off of
 * this stage - over HTTP the token is visible to anyone who can already see the traffic.
 */
export function buildSessionCookie(token: string | null): string {
	const attributes = ['Path=/', 'HttpOnly', 'SameSite=Lax']

	if (token === null) {
		return `${ADMIN_SESSION_COOKIE}=; ${attributes.join('; ')}; Max-Age=0`
	}

	return `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; ${attributes.join('; ')}`
}
