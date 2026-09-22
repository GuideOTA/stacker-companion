import { TRPCError } from '@trpc/server'
import { describe, expect, test } from 'vitest'
import { publicProcedure, router, type TrpcContext } from '../../../lib/UI/TRPC.js'

/**
 * A miniature router built from the real `publicProcedure`, so these tests exercise the actual
 * middleware chain rather than a reimplementation of it. The procedure paths deliberately mirror real
 * ones, because the operate allowlist is keyed by full router path.
 */
const testRouter = router({
	controls: router({
		// On the operate allowlist - an operator pressing a button
		hotPressControl: publicProcedure.mutation(() => 'pressed'),
		// Not on it - editing a button's configuration
		setOptionsField: publicProcedure.mutation(() => 'edited'),
	}),
	userConfig: router({
		getConfig: publicProcedure.query(() => 'config'),
		setConfigKey: publicProcedure.mutation(() => 'changed'),
	}),
})

function createContext(isAdmin: boolean): TrpcContext {
	return {
		clientId: 'test-client',
		clientIp: '192.168.1.20',
		isLocalClient: () => false,
		adminSessionToken: isAdmin ? 'a-valid-token' : undefined,
		isAdmin: () => isAdmin,
	}
}

const asAdmin = () => testRouter.createCaller(createContext(true))
const asViewer = () => testRouter.createCaller(createContext(false))

describe('admin mutation guard', () => {
	test('a viewer can read', async () => {
		await expect(asViewer().userConfig.getConfig()).resolves.toBe('config')
	})

	test('a viewer can run an allowlisted operate mutation', async () => {
		await expect(asViewer().controls.hotPressControl()).resolves.toBe('pressed')
	})

	test('a viewer cannot run a configuration mutation', async () => {
		await expect(asViewer().controls.setOptionsField()).rejects.toThrow(TRPCError)
		await expect(asViewer().userConfig.setConfigKey()).rejects.toThrow(/admin login/i)
	})

	test('the rejection is UNAUTHORIZED, not a generic failure', async () => {
		await expect(asViewer().userConfig.setConfigKey()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
	})

	test('an admin can run any mutation', async () => {
		await expect(asAdmin().controls.setOptionsField()).resolves.toBe('edited')
		await expect(asAdmin().userConfig.setConfigKey()).resolves.toBe('changed')
		await expect(asAdmin().controls.hotPressControl()).resolves.toBe('pressed')
	})

	test('session validity is re-checked per call, so an expiry takes effect immediately', async () => {
		// The context is created once per websocket connection, but `isAdmin()` is called on every
		// guarded mutation - so a session that expires mid-connection stops working without a reconnect.
		let sessionAlive = true
		const caller = testRouter.createCaller({
			clientId: 'test-client',
			clientIp: '192.168.1.20',
			isLocalClient: () => false,
			adminSessionToken: 'a-valid-token',
			isAdmin: () => sessionAlive,
		})

		await expect(caller.userConfig.setConfigKey()).resolves.toBe('changed')

		sessionAlive = false

		await expect(caller.userConfig.setConfigKey()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
		// Reading still works after the session ends
		await expect(caller.userConfig.getConfig()).resolves.toBe('config')
	})
})
