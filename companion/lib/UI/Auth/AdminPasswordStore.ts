import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { ADMIN_PASSWORD_MIN_LENGTH } from '@companion-app/shared/Model/AdminAuth.js'
import type { DataStoreTableView } from '../../Data/StoreBase.js'
import type { Logger } from '../../Log/Controller.js'

/** The single row this store keeps. Only one admin account exists, so the key is fixed. */
const RECORD_KEY = 'admin'

/** scrypt cost parameters. N=16384 is the node default and takes ~50ms, which is the point. */
const SCRYPT_KEYLEN = 64
const SALT_BYTES = 16

interface StoredAdminPassword {
	/** Hex scrypt digest of the password, salted with `salt`. */
	hash: string
	/** Hex random salt, unique to this password. */
	salt: string
	/**
	 * Legacy marker from the build that seeded a default password in source. Any record still carrying
	 * it holds a password that was published, so it is treated as no password at all.
	 */
	isDefault?: boolean
	updatedAt: number
}

type AdminAuthTable = Record<string, StoredAdminPassword>

/**
 * Persistent store for the single admin password, backed by the `admin_auth` SQLite table.
 *
 * There is deliberately no default password anywhere in this source. A fresh install starts
 * *unclaimed*: no password exists, the web UI shows its first-run setup screen, and the first client
 * to reach it sets the password and takes ownership. A shipped default would be a published
 * credential, which is worse than a brief claim window.
 *
 * Unlike a REST API token (see `RestApiTokenStore`, which can use a fast SHA-256 because its tokens
 * are high-entropy random strings), this is a human-chosen password: it is guessable, so it is stored
 * as a salted scrypt digest. The deliberate cost of scrypt is what makes an offline dictionary attack
 * against a stolen database expensive. The plaintext is never persisted and never sent to a client.
 */
export class AdminPasswordStore {
	readonly #logger: Logger
	readonly #table: DataStoreTableView<AdminAuthTable>

	constructor(logger: Logger, table: DataStoreTableView<AdminAuthTable>) {
		this.#logger = logger
		this.#table = table

		if (this.isUnclaimed()) {
			this.#logger.warn(
				'No admin password is set. Open the web UI to choose one - until then, anyone who can reach it can.'
			)
		}
	}

	/** Hash `plaintext` with `salt`, returning the raw digest for constant-time comparison. */
	#deriveKey(plaintext: string, salt: string): Buffer {
		return scryptSync(plaintext, Buffer.from(salt, 'hex'), SCRYPT_KEYLEN)
	}

	#write(plaintext: string): void {
		const salt = randomBytes(SALT_BYTES).toString('hex')
		this.#table.set(RECORD_KEY, {
			hash: this.#deriveKey(plaintext, salt).toString('hex'),
			salt,
			updatedAt: Date.now(),
		})
	}

	/**
	 * Whether this Companion still has no admin password of its own.
	 *
	 * True for a fresh install, for a record left unusable by a partial write, and for a record carrying
	 * the legacy `isDefault` marker - that password was shipped in source, so it protects nothing and
	 * must be replaced rather than trusted.
	 */
	isUnclaimed(): boolean {
		const record = this.#table.get(RECORD_KEY)
		if (!record?.hash || !record?.salt) return true
		return record.isDefault === true
	}

	/**
	 * Check a candidate password against the stored digest, in constant time.
	 *
	 * Always false while unclaimed: with no password set there is nothing to log in against, and the
	 * setup flow - not the login form - is the way in.
	 */
	verify(plaintext: string): boolean {
		if (!plaintext || this.isUnclaimed()) return false

		const record = this.#table.get(RECORD_KEY)
		if (!record?.hash || !record?.salt) return false

		try {
			const expected = Buffer.from(record.hash, 'hex')
			const presented = this.#deriveKey(plaintext, record.salt)
			if (expected.length !== presented.length) return false
			return timingSafeEqual(expected, presented)
		} catch (e) {
			this.#logger.error(`Failed to verify admin password: ${e}`)
			return false
		}
	}

	#validate(plaintext: string): void {
		if (plaintext.length < ADMIN_PASSWORD_MIN_LENGTH) {
			throw new Error(`Password must be at least ${ADMIN_PASSWORD_MIN_LENGTH} characters`)
		}
	}

	/**
	 * Take ownership of an unclaimed Companion by setting its first password.
	 *
	 * Throws if a password already exists, so this can never be used to overwrite one - changing a
	 * known password goes through `setPassword`, which requires the current one.
	 */
	claim(plaintext: string): void {
		if (!this.isUnclaimed()) throw new Error('An admin password has already been set')

		this.#validate(plaintext)
		this.#write(plaintext)
		this.#logger.info('Admin password set - this Companion is now claimed')
	}

	/** Replace the stored password. The caller is responsible for checking the current one first. */
	setPassword(plaintext: string): void {
		this.#validate(plaintext)
		this.#write(plaintext)
		this.#logger.info('Admin password changed')
	}

	/**
	 * Clear the password, returning this Companion to the unclaimed state so a new one can be set.
	 *
	 * This is the recovery path for a forgotten admin password. It is reachable only from the command
	 * line on the host, which under Companion's threat model is already a trusted position - someone
	 * with a shell as that user can alter the config directly in any case.
	 */
	reset(): void {
		this.#table.delete(RECORD_KEY)
		this.#logger.warn('Admin password was cleared from the command line - the web UI will ask for a new one')
	}
}
