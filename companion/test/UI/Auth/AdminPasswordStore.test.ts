import { DatabaseSync } from 'node:sqlite'
import { describe, expect, test } from 'vitest'
import { DataStoreTableView } from '../../../lib/Data/StoreBase.js'
import LogController from '../../../lib/Log/Controller.js'
import { AdminPasswordStore } from '../../../lib/UI/Auth/AdminPasswordStore.js'

function createStore() {
	const logger = LogController.createLogger('test/admin-password')
	const db = new DatabaseSync(':memory:')
	const table = new DataStoreTableView<any>(logger, db, 'admin_auth', {
		onDirty: () => {},
		onOperation: () => {},
	})
	return { store: new AdminPasswordStore(logger, table), table, logger }
}

describe('AdminPasswordStore', () => {
	test('a fresh install is unclaimed, with no password in source to fall back on', () => {
		const { store } = createStore()

		expect(store.isUnclaimed()).toBe(true)
		// There is no default password, so nothing can authenticate yet
		expect(store.verify('')).toBe(false)
		expect(store.verify('admin')).toBe(false)
		expect(store.verify('password')).toBe(false)
	})

	test('claim sets the first password and takes ownership', () => {
		const { store } = createStore()

		store.claim('a-good-password')

		expect(store.isUnclaimed()).toBe(false)
		expect(store.verify('a-good-password')).toBe(true)
		expect(store.verify('something-else')).toBe(false)
	})

	test('claim cannot be used to overwrite an existing password', () => {
		const { store } = createStore()
		store.claim('the-real-password')

		expect(() => store.claim('an-attackers-password')).toThrow(/already been set/)
		expect(store.verify('the-real-password')).toBe(true)
		expect(store.verify('an-attackers-password')).toBe(false)
	})

	test('claim rejects a password below the minimum length, leaving it unclaimed', () => {
		const { store } = createStore()

		expect(() => store.claim('short')).toThrow(/at least 8 characters/)
		expect(store.isUnclaimed()).toBe(true)
	})

	test('never stores the password in plaintext', () => {
		const { store, table } = createStore()
		store.claim('correct horse battery staple')

		const serialised = JSON.stringify(table.get('admin'))
		expect(serialised).not.toContain('correct horse battery staple')
	})

	test('salts each password, so the same password hashes differently', () => {
		const { store, table } = createStore()

		store.claim('identical-password')
		const first = { ...table.get('admin') }
		store.setPassword('identical-password')
		const second = { ...table.get('admin') }

		expect(first.salt).not.toBe(second.salt)
		expect(first.hash).not.toBe(second.hash)
		expect(store.verify('identical-password')).toBe(true)
	})

	test('setPassword replaces an existing password', () => {
		const { store } = createStore()
		store.claim('the-first-password')

		store.setPassword('the-second-password')

		expect(store.verify('the-second-password')).toBe(true)
		expect(store.verify('the-first-password')).toBe(false)
		expect(store.isUnclaimed()).toBe(false)
	})

	test('setPassword rejects a password below the minimum length', () => {
		const { store } = createStore()
		store.claim('the-first-password')

		expect(() => store.setPassword('short')).toThrow(/at least 8 characters/)
		expect(store.verify('the-first-password')).toBe(true)
	})

	test('reset clears the password and returns to unclaimed', () => {
		const { store } = createStore()
		store.claim('forgotten-password')

		store.reset()

		expect(store.isUnclaimed()).toBe(true)
		expect(store.verify('forgotten-password')).toBe(false)
		// ...and a new password can then be claimed
		store.claim('a-replacement-password')
		expect(store.verify('a-replacement-password')).toBe(true)
	})

	test('a legacy record from the seeded-default build is treated as no password at all', () => {
		// That password shipped in source, so it was public. An upgraded install must be re-claimed
		// rather than left running on a published credential.
		const { store, table } = createStore()
		const legacy = { ...table.get('admin') }
		store.claim('the-old-seeded-default')
		table.set('admin', { ...legacy, ...table.get('admin'), isDefault: true })

		expect(store.isUnclaimed()).toBe(true)
		expect(store.verify('the-old-seeded-default')).toBe(false)
	})

	test('a corrupted record denies access rather than granting it', () => {
		const { store, table } = createStore()
		table.set('admin', { hash: 'not-hex', salt: '', updatedAt: 0 })

		expect(store.isUnclaimed()).toBe(true)
		expect(store.verify('anything')).toBe(false)
		expect(store.verify('')).toBe(false)
	})
})
