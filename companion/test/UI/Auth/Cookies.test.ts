import { describe, expect, test } from 'vitest'
import { ADMIN_SESSION_COOKIE, buildSessionCookie, parseCookie } from '../../../lib/UI/Auth/Cookies.js'

describe('parseCookie', () => {
	test('reads a named cookie from a multi-cookie header', () => {
		const header = `theme=dark; ${ADMIN_SESSION_COOKIE}=abc123; other=x`
		expect(parseCookie(header, ADMIN_SESSION_COOKIE)).toBe('abc123')
	})

	test('returns undefined when absent, empty or malformed', () => {
		expect(parseCookie(undefined, ADMIN_SESSION_COOKIE)).toBeUndefined()
		expect(parseCookie('', ADMIN_SESSION_COOKIE)).toBeUndefined()
		expect(parseCookie('theme=dark', ADMIN_SESSION_COOKIE)).toBeUndefined()
		expect(parseCookie('novalue', ADMIN_SESSION_COOKIE)).toBeUndefined()
	})

	test('does not match a cookie whose name merely ends with the target', () => {
		expect(parseCookie(`not_${ADMIN_SESSION_COOKIE}=abc123`, ADMIN_SESSION_COOKIE)).toBeUndefined()
	})

	test('decodes percent-escapes, and rejects a malformed one', () => {
		expect(parseCookie(`${ADMIN_SESSION_COOKIE}=a%20b`, ADMIN_SESSION_COOKIE)).toBe('a b')
		expect(parseCookie(`${ADMIN_SESSION_COOKIE}=%ZZ`, ADMIN_SESSION_COOKIE)).toBeUndefined()
	})
})

describe('buildSessionCookie', () => {
	test('a session cookie is HttpOnly and SameSite=Lax', () => {
		const cookie = buildSessionCookie('token-value')

		expect(cookie).toContain(`${ADMIN_SESSION_COOKIE}=token-value`)
		expect(cookie).toContain('HttpOnly')
		expect(cookie).toContain('SameSite=Lax')
		expect(cookie).toContain('Path=/')
	})

	test('clearing expires the cookie immediately', () => {
		const cookie = buildSessionCookie(null)

		expect(cookie).toContain('Max-Age=0')
		expect(cookie).toContain(`${ADMIN_SESSION_COOKIE}=;`)
	})

	test('round-trips a token that needs escaping', () => {
		const token = 'a b;c'
		expect(parseCookie(buildSessionCookie(token).split(';')[0], ADMIN_SESSION_COOKIE)).toBe(token)
	})
})
