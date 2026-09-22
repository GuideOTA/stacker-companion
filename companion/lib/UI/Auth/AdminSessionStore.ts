import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { Logger } from '../../Log/Controller.js'

/** Bytes of entropy per session token. 32 bytes is well beyond guessable. */
const TOKEN_BYTES = 32

/** How often expired sessions are swept out of memory. */
const SWEEP_INTERVAL_MS = 60_000

interface AdminSession {
	token: string
	createdAt: number
	lastUsedAt: number
}

/**
 * In-memory store of active admin sessions.
 *
 * Sessions are deliberately not persisted: a restart of Companion invalidates every session, so a
 * forgotten browser tab cannot carry admin rights across a restart. They are cheap to re-establish -
 * the operator logs in again.
 *
 * Every session is subject to the idle timeout configured as `admin_timeout` (in minutes; 0 disables
 * it). The timeout is read through a callback on each check rather than captured, so changing it in
 * the settings takes effect immediately on existing sessions.
 */
export class AdminSessionStore {
	readonly #logger: Logger
	readonly #sessions = new Map<string, AdminSession>()
	readonly #getIdleTimeoutMinutes: () => number
	readonly #sweepTimer: NodeJS.Timeout

	constructor(logger: Logger, getIdleTimeoutMinutes: () => number) {
		this.#logger = logger
		this.#getIdleTimeoutMinutes = getIdleTimeoutMinutes

		this.#sweepTimer = setInterval(() => this.#sweep(), SWEEP_INTERVAL_MS)
		// Don't hold the process open just to expire sessions
		this.#sweepTimer.unref()
	}

	/** Whether `session` has gone past the configured idle timeout. */
	#isExpired(session: AdminSession, now: number): boolean {
		const timeoutMinutes = this.#getIdleTimeoutMinutes()
		if (!timeoutMinutes || timeoutMinutes <= 0) return false

		return now - session.lastUsedAt > timeoutMinutes * 60_000
	}

	#sweep(): void {
		const now = Date.now()
		for (const [token, session] of this.#sessions) {
			if (this.#isExpired(session, now)) this.#sessions.delete(token)
		}
	}

	/** Mint a new session and return its token. The token is the only copy - it is not recoverable. */
	create(): string {
		const token = randomBytes(TOKEN_BYTES).toString('hex')
		const now = Date.now()

		this.#sessions.set(token, { token, createdAt: now, lastUsedAt: now })
		this.#logger.info('Admin logged in')

		return token
	}

	/**
	 * Check whether `token` names a live session, and if so slide its idle timeout forward.
	 *
	 * The lookup is a constant-time comparison over the candidate sessions rather than a map hit, so
	 * the time taken does not leak how much of a guessed token was correct.
	 */
	validate(token: string | undefined): boolean {
		if (!token) return false

		const presented = Buffer.from(token, 'utf8')
		const now = Date.now()

		for (const session of this.#sessions.values()) {
			const stored = Buffer.from(session.token, 'utf8')
			if (stored.length !== presented.length || !timingSafeEqual(stored, presented)) continue

			if (this.#isExpired(session, now)) {
				this.#sessions.delete(session.token)
				return false
			}

			session.lastUsedAt = now
			return true
		}

		return false
	}

	/** End a single session. Safe to call with an unknown or undefined token. */
	revoke(token: string | undefined): void {
		if (token && this.#sessions.delete(token)) this.#logger.info('Admin logged out')
	}

	/**
	 * End every session. Used when the password changes, so that a password rotation actually evicts
	 * anyone holding an old session rather than only affecting future logins.
	 */
	revokeAll(): void {
		if (this.#sessions.size === 0) return

		this.#logger.info(`Revoked ${this.#sessions.size} admin session(s)`)
		this.#sessions.clear()
	}

	/** Number of live sessions, for diagnostics and tests. */
	get activeCount(): number {
		return this.#sessions.size
	}

	destroy(): void {
		clearInterval(this.#sweepTimer)
		this.#sessions.clear()
	}
}
