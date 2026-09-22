import os from 'node:os'
import path from 'node:path'
import fs from 'fs-extra'
import type { ClientImportOrResetSelection } from '@companion-app/shared/Model/ImportExport.js'
import { isPackaged } from '../Resources/Util.js'

/** The bundled starter config, shipped in `assets/default-config`. */
const DEFAULT_CONFIG_FILENAME = 'starter.companionconfig'

/**
 * Locate the bundled default config.
 *
 * Mirrors how the other runtime assets are resolved (see `Graphics/Fonts.ts`): packaged builds put
 * `assets/` alongside the bundled code, while in the repo it sits at the root.
 */
export function getDefaultConfigPath(): string {
	const assetsPath = isPackaged() ? 'assets/default-config' : '../../../assets/default-config'
	return path.join(import.meta.dirname, assetsPath, DEFAULT_CONFIG_FILENAME)
}

/** Whether a bundled default config is present in this build. */
export async function hasDefaultConfig(): Promise<boolean> {
	return fs.pathExists(getDefaultConfigPath())
}

/** Read the bundled default config as a raw buffer, for the normal import parser to handle. */
export async function readDefaultConfig(): Promise<Buffer> {
	return fs.readFile(getDefaultConfigPath())
}

/**
 * What to import from the default config on a fresh install.
 *
 * Everything the file carries is imported wholesale - the database is empty, so there is nothing to
 * merge with and nothing to lose. `userconfig` is left alone rather than reset: the settings are
 * already at their defaults on a fresh database, and resetting them here would fight with anything
 * set during first-run setup.
 */
export const DEFAULT_CONFIG_IMPORT_SELECTION: ClientImportOrResetSelection = {
	buttons: 'reset-and-import',
	surfaces: {
		known: 'reset-and-import',
		instances: 'reset-and-import',
		remote: 'reset-and-import',
	},
	triggers: 'reset-and-import',
	customVariables: 'reset-and-import',
	expressionVariables: 'reset-and-import',
	// `connections` is a reset-type, not an import-type: 'reset' means replace rather than merge
	connections: 'reset',
	userconfig: 'unchanged',
	imageLibrary: 'reset-and-import',
}

/**
 * The call-sign placeholder in the bundled starter config, put there by
 * `tools/scrub_starter_config.mts` so no single station's identity ships in the repository.
 *
 * Substitution is case-sensitive on purpose: these exports embed base64 image data, and a
 * case-insensitive replace would corrupt any image whose data happened to contain the same letters in
 * a different case. Only the exact upper- and lower-case forms are real references.
 */
export const STARTER_CALL_LETTERS = 'CALLSIGN'

/**
 * The placeholder network the bundled starter config is stored on.
 *
 * `0.0.x.y` can never route anywhere, which is the point: the facility's real addressing never enters
 * the repository, and if substitution ever fails the result is an obviously broken address rather
 * than a plausible one quietly pointing at another site's production hardware.
 *
 * Produced by `tools/scrub_starter_config.mts` - keep the two in sync.
 */
export const STARTER_NETWORK_PREFIX = '0.0'

/** Matches an IPv4 address's first two octets, e.g. the "10.49" of "10.49.251.208". */
const IPV4_PREFIX = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3}\.\d{1,3})\b/g

/** Whether a two-octet prefix is in RFC1918 private space, and so safe to rewrite. */
function isPrivatePrefix(a: number, b: number): boolean {
	if (a === 10) return true
	if (a === 192 && b === 168) return true
	if (a === 172 && b >= 16 && b <= 31) return true
	return false
}

/**
 * The first two octets of the address Companion is reachable on, e.g. "10.49".
 *
 * Prefers the bind address when one was configured explicitly, since that is the interface the
 * operator pointed Companion at. Falls back to the first non-internal IPv4 interface. Returns null
 * when nothing usable is found (loopback-only, or bound to all interfaces on a host with no private
 * address), in which case the starter config's own addresses are left untouched.
 */
export function detectNetworkPrefix(bindIp: string | null): string | null {
	const fromAddress = (address: string): string | null => {
		const parts = address.split('.')
		if (parts.length !== 4) return null

		const a = Number(parts[0])
		const b = Number(parts[1])
		if (!Number.isFinite(a) || !Number.isFinite(b)) return null
		if (!isPrivatePrefix(a, b)) return null

		return `${a}.${b}`
	}

	// An explicit bind address is the best signal - but 0.0.0.0/:: means "everything", not an interface
	if (bindIp && bindIp !== '0.0.0.0' && bindIp !== '::') {
		const prefix = fromAddress(bindIp)
		if (prefix) return prefix
	}

	for (const addresses of Object.values(os.networkInterfaces())) {
		for (const addr of addresses ?? []) {
			if (addr.internal || addr.family !== 'IPv4') continue

			const prefix = fromAddress(addr.address)
			if (prefix) return prefix
		}
	}

	return null
}

/** The most common private two-octet prefix in a starter config, i.e. the network it was exported from. */
export function findDominantPrefix(json: string): string | null {
	const counts = new Map<string, number>()

	for (const match of json.matchAll(IPV4_PREFIX)) {
		const a = Number(match[1])
		const b = Number(match[2])
		if (!isPrivatePrefix(a, b)) continue

		const prefix = `${a}.${b}`
		counts.set(prefix, (counts.get(prefix) ?? 0) + 1)
	}

	let best: string | null = null
	let bestCount = 0
	for (const [prefix, count] of counts) {
		if (count > bestCount) {
			best = prefix
			bestCount = count
		}
	}

	return best
}

/**
 * The prefix a starter config's addresses should be rewritten *from*.
 *
 * Normally the scrubbed placeholder. Falls back to the dominant private prefix so that an export
 * dropped in as the asset without being scrubbed is still rebased onto this machine's network, rather
 * than silently keeping the addresses of wherever it came from.
 */
export function findSourcePrefix(json: string): string | null {
	if (new RegExp(`\\b${STARTER_NETWORK_PREFIX.replace(/\./g, '\\.')}\\.\\d`).test(json)) {
		return STARTER_NETWORK_PREFIX
	}

	return findDominantPrefix(json)
}

export interface StarterSubstitutions {
	/** The two-octet prefix to rewrite the starter config's private addresses to, or null to leave them. */
	networkPrefix: string | null
	/** The call letters to substitute for the bundled ones, or null to leave them. */
	callLetters: string | null
}

export interface StarterSubstitutionResult {
	json: string
	replacedAddresses: number
	replacedCallLetters: number
	fromPrefix: string | null
}

/**
 * Rewrite a starter config for the station it is being installed at.
 *
 * Works on the raw JSON text rather than the parsed object so that every occurrence is caught - these
 * values appear inside deeply nested action options, expression strings, surface ids and labels, not
 * just in tidy config fields.
 *
 * Only private addresses sharing the config's dominant prefix are rewritten: a public address or a
 * loopback reference in the config means what it says and is left alone.
 */
export function substituteStarterConfig(json: string, subs: StarterSubstitutions): StarterSubstitutionResult {
	let replacedAddresses = 0
	let replacedCallLetters = 0

	const fromPrefix = subs.networkPrefix ? findSourcePrefix(json) : null

	let out = json
	if (fromPrefix && subs.networkPrefix && fromPrefix !== subs.networkPrefix) {
		out = out.replace(IPV4_PREFIX, (whole, a: string, b: string, rest: string) => {
			if (`${Number(a)}.${Number(b)}` !== fromPrefix) return whole

			replacedAddresses++
			return `${subs.networkPrefix}.${rest}`
		})
	}

	if (subs.callLetters && subs.callLetters !== STARTER_CALL_LETTERS) {
		const upper = subs.callLetters.toUpperCase()
		const lower = subs.callLetters.toLowerCase()

		out = out.split(STARTER_CALL_LETTERS).join(upper)
		replacedCallLetters += (json.match(new RegExp(STARTER_CALL_LETTERS, 'g')) ?? []).length

		const lowerSource = STARTER_CALL_LETTERS.toLowerCase()
		out = out.split(lowerSource).join(lower)
		replacedCallLetters += (json.match(new RegExp(lowerSource, 'g')) ?? []).length
	}

	return { json: out, replacedAddresses, replacedCallLetters, fromPrefix }
}
