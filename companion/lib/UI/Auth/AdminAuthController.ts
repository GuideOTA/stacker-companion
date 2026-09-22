import Express from 'express'
import { z } from 'zod'
import { ADMIN_PASSWORD_MIN_LENGTH, type AdminAuthStatus } from '@companion-app/shared/Model/AdminAuth.js'
import type { DataDatabase } from '../../Data/Database.js'
import LogController from '../../Log/Controller.js'
import { publicProcedure, router } from '../TRPC.js'
import { AdminPasswordStore } from './AdminPasswordStore.js'
import { AdminSessionStore } from './AdminSessionStore.js'
import { ADMIN_AUTH_BASE_PATH } from './Constants.js'
import { ADMIN_SESSION_COOKIE, buildSessionCookie, parseCookie } from './Cookies.js'

export { ADMIN_AUTH_BASE_PATH }

/**
 * Owns admin authentication for the web UI: the stored password, the live sessions, and the HTTP
 * endpoints the login form posts to.
 *
 * Login is an ordinary HTTP POST rather than a tRPC mutation because tRPC is mounted over WebSocket
 * only, and a WebSocket cannot set a cookie. The browser therefore posts the password here, receives
 * an `HttpOnly` session cookie, and reconnects - at which point the tRPC context picks the cookie up
 * from the upgrade request.
 */
export class AdminAuthController {
	readonly #logger = LogController.createLogger('UI/AdminAuth')
	readonly #passwords: AdminPasswordStore
	readonly #sessions: AdminSessionStore

	constructor(db: DataDatabase, getIdleTimeoutMinutes: () => number) {
		this.#passwords = new AdminPasswordStore(this.#logger, db.getTableView('admin_auth'))
		this.#sessions = new AdminSessionStore(this.#logger, getIdleTimeoutMinutes)
	}

	/**
	 * Whether the session token carried by a connection is currently valid. Called on every guarded
	 * mutation, so an expired or revoked session takes effect immediately - without waiting for the
	 * client to reconnect.
	 */
	isValidSession(token: string | undefined): boolean {
		return this.#sessions.validate(token)
	}

	/** The auth state to report to a client holding `token`. */
	getStatus(token: string | undefined): AdminAuthStatus {
		return {
			isAdmin: this.#sessions.validate(token),
			isUnclaimed: this.#passwords.isUnclaimed(),
		}
	}

	/**
	 * Clear the admin password and end every session, returning this Companion to the unclaimed state.
	 * The recovery path for a forgotten password - see `AdminPasswordStore.reset`.
	 */
	resetPassword(): void {
		this.#passwords.reset()
		this.#sessions.revokeAll()
	}

	createExpressRouter(): Express.Router {
		const router = Express.Router()

		// Take ownership of an unclaimed Companion. Deliberately unauthenticated - it is the only way in
		// on a fresh install, and it stops working the instant a password exists, so it cannot be used to
		// take over a configured system.
		router.post('/claim', (req, res) => {
			const password = typeof req.body?.password === 'string' ? req.body.password : ''

			if (!this.#passwords.isUnclaimed()) {
				this.#logger.warn(`Rejected a claim attempt from ${req.ip}: a password is already set`)
				res.status(409).json({ success: false, message: 'An admin password has already been set' })
				return
			}

			try {
				this.#passwords.claim(password)
			} catch (e) {
				res.status(400).json({ success: false, message: e instanceof Error ? e.message : 'Invalid password' })
				return
			}

			// Log the claimant straight in, so setup continues without a second password prompt
			const token = this.#sessions.create()
			res.setHeader('Set-Cookie', buildSessionCookie(token))
			this.#logger.info(`Companion claimed from ${req.ip}`)
			res.json({ success: true })
		})

		router.post('/login', (req, res) => {
			const password = typeof req.body?.password === 'string' ? req.body.password : ''

			if (!this.#passwords.verify(password)) {
				// Deliberately vague, and logged with the client ip so repeated failures are visible
				this.#logger.warn(`Failed admin login attempt from ${req.ip}`)
				res.status(401).json({ success: false, message: 'Incorrect password' })
				return
			}

			const token = this.#sessions.create()
			res.setHeader('Set-Cookie', buildSessionCookie(token))
			res.json({ success: true })
		})

		router.post('/logout', (req, res) => {
			this.#sessions.revoke(parseCookie(req.headers.cookie, ADMIN_SESSION_COOKIE))
			res.setHeader('Set-Cookie', buildSessionCookie(null))
			res.json({ success: true })
		})

		router.get('/status', (req, res) => {
			res.json(this.getStatus(parseCookie(req.headers.cookie, ADMIN_SESSION_COOKIE)))
		})

		return router
	}

	createTrpcRouter() {
		const self = this

		return router({
			// A query, not a mutation, so it stays readable without a session - the UI needs to know
			// whether it is admin in order to decide what to render.
			status: publicProcedure.query(({ ctx }): AdminAuthStatus => {
				return self.getStatus(ctx.adminSessionToken)
			}),

			// A mutation, and so admin-only by default via the mutation guard.
			changePassword: publicProcedure
				.input(
					z.object({
						currentPassword: z.string(),
						newPassword: z.string().min(ADMIN_PASSWORD_MIN_LENGTH),
					})
				)
				.mutation(({ input }) => {
					// Re-check the current password even though the caller already holds an admin session,
					// so that an unattended logged-in browser cannot be used to lock out the real admin.
					if (!self.#passwords.verify(input.currentPassword)) {
						throw new Error('Current password is incorrect')
					}

					self.#passwords.setPassword(input.newPassword)

					// A password change should evict everyone, including whoever is changing it
					self.#sessions.revokeAll()
				}),
		})
	}

	destroy(): void {
		this.#sessions.destroy()
	}
}
