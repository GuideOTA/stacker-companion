import type { TrpcContext } from '../lib/UI/TRPC.js'

/**
 * Build a mock TrpcContext for tests, with sensible defaults that can be overridden.
 *
 * The default is an authenticated admin, so that a test of some feature's mutations does not have to
 * know anything about authorization. The guard itself - what a viewer may and may not do - is covered
 * directly in `UI/Auth/MutationGuard.test.ts`; override `isAdmin` here to exercise a viewer.
 */
export function createMockTrpcContext(overrides?: Partial<TrpcContext>): TrpcContext {
	return {
		clientId: 'test-client',
		clientIp: '127.0.0.1',
		isLocalClient: () => true,
		adminSessionToken: 'test-admin-session',
		isAdmin: () => true,
		...overrides,
	}
}
