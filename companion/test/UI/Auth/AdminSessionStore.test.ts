import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import LogController from '../../../lib/Log/Controller.js'
import { AdminSessionStore } from '../../../lib/UI/Auth/AdminSessionStore.js'

function createStore(timeoutMinutes = 0) {
	const logger = LogController.createLogger('test/admin-session')
	let timeout = timeoutMinutes
	const store = new AdminSessionStore(logger, () => timeout)
	return { store, setTimeoutMinutes: (v: number) => (timeout = v) }
}

describe('AdminSessionStore', () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	test('a created session validates, an unknown token does not', () => {
		const { store } = createStore()
		const token = store.create()

		expect(store.validate(token)).toBe(true)
		expect(store.validate('not-a-session')).toBe(false)
		expect(store.validate(undefined)).toBe(false)
		expect(store.validate('')).toBe(false)
	})

	test('tokens are unique and high-entropy', () => {
		const { store } = createStore()
		const tokens = new Set(Array.from({ length: 20 }, () => store.create()))

		expect(tokens.size).toBe(20)
		for (const token of tokens) expect(token).toMatch(/^[0-9a-f]{64}$/)
	})

	test('revoke ends only the named session', () => {
		const { store } = createStore()
		const first = store.create()
		const second = store.create()

		store.revoke(first)

		expect(store.validate(first)).toBe(false)
		expect(store.validate(second)).toBe(true)
	})

	test('revokeAll ends every session', () => {
		const { store } = createStore()
		const first = store.create()
		const second = store.create()

		store.revokeAll()

		expect(store.validate(first)).toBe(false)
		expect(store.validate(second)).toBe(false)
		expect(store.activeCount).toBe(0)
	})

	test('a session expires once idle past the timeout', () => {
		const { store } = createStore(10)
		const token = store.create()

		vi.advanceTimersByTime(9 * 60_000)
		expect(store.validate(token)).toBe(true)

		vi.advanceTimersByTime(11 * 60_000)
		expect(store.validate(token)).toBe(false)
	})

	test('using a session slides its idle timeout forward', () => {
		const { store } = createStore(10)
		const token = store.create()

		// Keep using it just inside the window; it should stay alive well past the original expiry
		for (let i = 0; i < 5; i++) {
			vi.advanceTimersByTime(9 * 60_000)
			expect(store.validate(token)).toBe(true)
		}
	})

	test('a timeout of zero means sessions never expire on their own', () => {
		const { store } = createStore(0)
		const token = store.create()

		vi.advanceTimersByTime(365 * 24 * 60 * 60_000)

		expect(store.validate(token)).toBe(true)
	})

	test('changing the configured timeout applies to existing sessions', () => {
		const { store, setTimeoutMinutes } = createStore(0)
		const token = store.create()

		vi.advanceTimersByTime(60 * 60_000)
		expect(store.validate(token)).toBe(true)

		// Tightening the timeout must not retroactively kill a session that was just used...
		setTimeoutMinutes(10)
		expect(store.validate(token)).toBe(true)

		// ...but it does apply from now on
		vi.advanceTimersByTime(11 * 60_000)
		expect(store.validate(token)).toBe(false)
	})

	test('expired sessions are swept out of memory', () => {
		const { store } = createStore(1)
		store.create()
		expect(store.activeCount).toBe(1)

		vi.advanceTimersByTime(5 * 60_000)

		expect(store.activeCount).toBe(0)
	})
})
