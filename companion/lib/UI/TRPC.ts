import { EventEmitter, on } from 'node:events'
import os from 'node:os'
import { trpcMiddleware as sentryTrpcMiddleware } from '@sentry/node'
import { initTRPC, TRPCError, type inferRouterInputs, type inferRouterOutputs } from '@trpc/server'
import type * as trpcExpress from '@trpc/server/adapters/express'
import type * as trpcWs from '@trpc/server/adapters/ws'
import { nanoid } from 'nanoid'
import proxyaddr from 'proxy-addr'
import type { ExportFullv6, ExportPageModelv6 } from '@companion-app/shared/Model/ExportModel.js'
import LogController from '../Log/Controller.js'
import type { Registry } from '../Registry.js'
import { isPackaged } from '../Resources/Util.js'
import type { AdminAuthController } from './Auth/AdminAuthController.js'
import { ADMIN_SESSION_COOKIE, parseCookie } from './Auth/Cookies.js'
import { isOperateMutation } from './Auth/OperateProcedures.js'

export interface TrpcContext {
	clientId: string
	clientIp: string | undefined

	/**
	 * The admin session token this connection presented, if any. Read once from the cookie when the
	 * connection is established; its validity is re-checked on every guarded call, so an expired or
	 * revoked session stops working without the client having to reconnect.
	 */
	adminSessionToken: string | undefined

	/** Whether this connection currently holds a valid admin session. */
	isAdmin: () => boolean

	/**
	 * Whether this client is connecting from the same machine as Companion.
	 * Lazily evaluated and cached for the lifetime of the context.
	 * Note: This is not guaranteed to be 100% accurate at all times.
	 */
	isLocalClient: () => boolean

	pendingImport?: {
		object: ExportFullv6 | ExportPageModelv6
		timeout: null
	}
}
/**
 * Parse the `trustedProxies` config string (comma or semicolon separated) into the list form used
 * by both express ("trust proxy") and proxy-addr.
 */
export function parseTrustedProxies(trustedProxies: string | undefined): string[] {
	return (trustedProxies ?? '')
		.split(/[,;]/)
		.map((v) => v.trim())
		.filter((v) => !!v)
}

/**
 * Build a predicate for "is this peer address one of the configured trusted proxies", using the same
 * proxy-addr matching (and config) that express's "trust proxy" uses. When no trusted proxies are
 * configured the predicate is always false, so nothing is treated as a proxy.
 */
export function makeIsTrustedProxyAddress(
	trustedProxies: string | undefined
): (address: string | undefined) => boolean {
	const parts = parseTrustedProxies(trustedProxies)
	if (parts.length === 0) return () => false

	const trust = proxyaddr.compile(parts)
	return (address) => {
		if (!address) return false
		try {
			return trust(address, 0)
		} catch (_e) {
			return false
		}
	}
}

// created for each request
// The express side already resolves req.ip via express's "trust proxy" setting, so we can use it directly.
export function createTrpcExpressContextFactory(adminAuth: AdminAuthController) {
	return ({ req, res: _res }: trpcExpress.CreateExpressContextOptions): TrpcContext => {
		const adminSessionToken = parseCookie(req.headers.cookie, ADMIN_SESSION_COOKIE)
		return {
			clientId: nanoid(),
			clientIp: req.ip,
			isLocalClient: makeIsLocalClient(req.ip),
			adminSessionToken,
			isAdmin: () => adminAuth.isValidSession(adminSessionToken),
		}
	}
}

/**
 * Build the websocket context creator.
 *
 * Unlike http requests, a websocket upgrade does not pass through express, so express's "trust proxy"
 * setting does not apply to it. To determine the real client ip behind a reverse proxy we have to
 * resolve X-Forwarded-For ourselves, using the same proxy-addr module (and trust config) that express
 * uses. When no trusted proxies are configured, X-Forwarded-For is ignored and the socket address is
 * used (so it can't be spoofed by untrusted clients).
 */
export function createTrpcWsContextFactory(trustedProxies: string | undefined, adminAuth: AdminAuthController) {
	const trustedParts = parseTrustedProxies(trustedProxies)
	const trust = trustedParts.length > 0 ? proxyaddr.compile(trustedParts) : undefined

	return ({ req, res: _res }: trpcWs.CreateWSSContextFnOptions): TrpcContext => {
		const clientIp = trust ? proxyaddr(req, trust) : req.socket.remoteAddress
		// A websocket upgrade carries the browser's cookies like any other same-origin request, so the
		// session established by the login POST is picked up here when the client reconnects.
		const adminSessionToken = parseCookie(req.headers.cookie, ADMIN_SESSION_COOKIE)
		return {
			clientId: nanoid(),
			clientIp,
			isLocalClient: makeIsLocalClient(clientIp),
			adminSessionToken,
			isAdmin: () => adminAuth.isValidSession(adminSessionToken),
		}
	}
}

/**
 * Build a lazily-cached predicate for whether `clientIp` is on the same machine as Companion.
 * Returns true for loopback addresses and for any address belonging to one of this machine's own
 * network interfaces (so opening the UI on the host's LAN address still counts as local).
 */
function makeIsLocalClient(clientIp: string | undefined): () => boolean {
	let cached: boolean | undefined
	return () => {
		if (cached === undefined) cached = computeIsLocalClient(clientIp)
		return cached
	}
}
export function computeIsLocalClient(clientIp: string | undefined): boolean {
	if (!clientIp) return false

	try {
		const normalize = (ip: string) => ip.replace(/^::ffff:/, '').replace(/%.*$/, '')
		const normalized = normalize(clientIp)
		if (normalized === '127.0.0.1' || normalized === '::1') return true

		const interfaces = os.networkInterfaces()
		for (const addresses of Object.values(interfaces)) {
			if (!addresses) continue
			for (const addr of addresses) {
				if (normalize(addr.address) === normalized) return true
			}
		}
		return false
	} catch {
		// If we fail to get the network interfaces for some reason, assume it's not local.
		return false
	}
}

/**
 * Initialization of tRPC backend
 * Should be done only once per backend!
 */
const t = initTRPC.context<TrpcContext>().create()

const loggerMiddleware = t.middleware(async ({ ctx, next, path, type }) => {
	const start = Date.now()

	const result = await next()

	const end = Date.now()

	// TODO - putting this outside results in a 'before initialization' loop
	const trpcCallLogger = LogController.createLogger('TRPC/Call')

	// Log the request at varying levels depending on whether companion is packaged or not
	const logLine = `${ctx.clientIp ?? ''} - ${ctx.clientId ?? '-'} "${path}/${type}" ${result.ok ? 200 : result.error.code} in ${end - start}ms`
	if (isPackaged()) {
		trpcCallLogger.silly(logLine)
	} else {
		trpcCallLogger.debug(logLine)
	}

	return result
})

const tidyZodMiddleware = t.middleware(async ({ next, path, type }) => {
	const result = await next()

	if (!result.ok && result.error instanceof TRPCError && result.error.code === 'BAD_REQUEST') {
		throw new Error(`Invalid or malformed input provided for "${path}/${type}"`, {
			cause: result.error.cause,
		})
	}

	return result
})

const sentryMiddleware = t.middleware(
	sentryTrpcMiddleware({
		attachRpcInput: true,
	})
)

/**
 * Export reusable router and procedure helpers
 * that can be used throughout the router
 */
export const router = t.router

/**
 * Deny-by-default authorization for every configuration change.
 *
 * Companion's web UI is readable by anyone who can reach it - queries and subscriptions are left
 * open, so an operator can watch the whole system - but a `.mutation` changes state and so requires
 * an authenticated admin session. The exceptions are the "operate" mutations in
 * `OperateProcedures.ts`: pressing a button is a mutation too, and an operator running a show must
 * be able to do that without admin rights.
 *
 * This is applied centrally rather than per-procedure on purpose. Every mutation added later - by us
 * or by an upstream merge - is protected from the moment it exists, with nothing to remember. The
 * failure mode of forgetting the allowlist is a locked button, not an open door.
 */
const adminMutationGuard = t.middleware(async ({ ctx, next, path, type }) => {
	if (type !== 'mutation' || isOperateMutation(path)) return next()

	if (!ctx.isAdmin()) {
		throw new TRPCError({
			code: 'UNAUTHORIZED',
			message: 'This change requires an admin login',
		})
	}

	return next()
})

/**
 * The base procedure every router builds on.
 *
 * Note that despite the name - kept as upstream's, so the ~40 router files do not have to be touched
 * and every future upstream merge stays clean - this is only "public" for queries and subscriptions.
 * Its mutations are admin-gated by `adminMutationGuard` above.
 */
export const publicProcedure = t.procedure
	.use(sentryMiddleware)
	.use(loggerMiddleware)
	.use(tidyZodMiddleware)
	.use(adminMutationGuard)

/**
 * Create the root TRPC router
 * @param registry
 * @returns
 */
export function createTrpcRouter(registry: Registry) {
	return router({
		adminAuth: registry.adminAuth.createTrpcRouter(),

		appInfo: registry.ui.update.createTrpcRouter(),

		bonjour: registry.services.bonjourDiscovery.createTrpcRouter(),
		restApiKeys: registry.services.restApi.createTrpcRouter(),

		actionRecorder: registry.instance.actionRecorder.createTrpcRouter(),
		surfaces: registry.surfaces.createTrpcRouter(),

		controls: registry.controls.createTrpcRouter(),

		variables: registry.variables.createTrpcRouter(),
		customVariables: registry.variables.custom.createTrpcRouter(),
		pages: registry.page.createTrpcRouter(),
		importExport: registry.importExport.createTrpcRouter(),
		logs: LogController.createTrpcRouter(),

		userConfig: registry.userconfig.createTrpcRouter(),
		instances: registry.instance.createTrpcRouter(),
		cloud: registry.cloud.createTrpcRouter(),

		preview: registry.preview.createTrpcRouter(),
		imageLibrary: registry.graphics.imageLibrary.createTrpcRouter(),
	})
}

// Export type router type signature,
// NOT the router itself.
export type AppRouter = ReturnType<typeof createTrpcRouter>

type TEventMap<TEmitter extends EventEmitter> = TEmitter extends EventEmitter<infer E> ? E : never

export function toIterable<TEmitter extends EventEmitter, TKey extends string & keyof TEventMap<TEmitter>>(
	ee: TEmitter,
	key: TKey,
	signal: AbortSignal | undefined
): NodeJS.AsyncIterator<TEventMap<TEmitter>[TKey]> {
	return on(ee, key, { signal }) as NodeJS.AsyncIterator<TEventMap<TEmitter>[TKey]>
}

/**
 * A single event source to merge, as an emitter+key with an optional predicate on the event args.
 */
export interface EventTriggerSource {
	ee: EventEmitter<any>
	key: string
	/** Only forward the event as a trigger when this returns true. If omitted, every event triggers. */
	filter?: (...args: any[]) => boolean
}

/**
 * Merge several EventEmitter event streams into a single async iterator that yields once whenever any
 * source fires (optionally filtered). Useful for subscriptions that must react to multiple unrelated
 * events without duplicating the wiring. The listeners are removed automatically when `signal` aborts.
 */
export function mergeEventTriggers(signal: AbortSignal, sources: EventTriggerSource[]): NodeJS.AsyncIterator<[]> {
	const local = new EventEmitter<{ trigger: [] }>()
	for (const { ee, key, filter } of sources) {
		const listener = (...args: any[]) => {
			if (!filter || filter(...args)) local.emit('trigger')
		}
		ee.on(key, listener)
		signal.addEventListener('abort', () => ee.off(key, listener), { once: true })
	}
	return toIterable(local, 'trigger', signal)
}

export type RouterInput = inferRouterInputs<AppRouter>
export type RouterOutput = inferRouterOutputs<AppRouter>
