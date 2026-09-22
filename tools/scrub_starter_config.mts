/*
 * Turn a real Companion export into the bundled starter config, with this station's identity removed.
 *
 *   yarn tsx tools/scrub_starter_config.mts <source.companionconfig> [--prefixes 10.49,127.0] [--callsign WGBA] [--dest path]
 *
 * Two substitutions happen at install time (companion/lib/ImportExport/DefaultConfig.ts), and this
 * tool prepares the asset for both:
 *
 *   - Every device address is parked on 0.0.x.y, a prefix that can never route. The facility's real
 *     addressing stays out of the repository, and a failed substitution yields an obviously broken
 *     address rather than a plausible one quietly pointing at another site's hardware.
 *   - The station's call sign becomes CALLSIGN, so no single station's identity is baked in.
 *
 * Pass --prefixes when the export's device addresses are not all on one private range - for example an
 * export that has already been hand-edited onto 127.0.x.y, which is NOT genuine loopback and must
 * still be rebased. Without it, the dominant private prefix is scrubbed and everything else is
 * reported so nothing slips by unnoticed.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const DEFAULT_DEST = path.join('assets', 'default-config', 'starter.companionconfig')

/** Keep in sync with STARTER_NETWORK_PREFIX / STARTER_CALL_SIGN in DefaultConfig.ts */
const PLACEHOLDER_PREFIX = '0.0'
const PLACEHOLDER_CALLSIGN = 'CALLSIGN'

/** The one address that genuinely means "this machine" and must survive untouched. */
const REAL_LOOPBACK = '127.0.0.1'

const IPV4 = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3}\.\d{1,3})\b/g

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`)
	return i >= 0 ? process.argv[i + 1] : undefined
}

function isPrivate(a: number, b: number): boolean {
	if (a === 10) return true
	if (a === 192 && b === 168) return true
	if (a === 172 && b >= 16 && b <= 31) return true
	return false
}

const source = process.argv[2]
if (!source || source.startsWith('--')) {
	console.error('Usage: yarn tsx tools/scrub_starter_config.mts <source.companionconfig> [--prefixes a.b,c.d] [--callsign XXXX] [--dest path]')
	process.exit(1)
}

const dest = arg('dest') ?? DEFAULT_DEST
const callsign = arg('callsign')
const explicitPrefixes = arg('prefixes')
	?.split(',')
	.map((p) => p.trim())
	.filter(Boolean)

const raw = fs.readFileSync(source)
const isGz = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b
const json = (isGz ? zlib.gunzipSync(raw) : raw).toString('utf8')

// Report what is in the file before touching anything
const before = new Map<string, number>()
for (const m of json.matchAll(IPV4)) before.set(m[0], (before.get(m[0]) ?? 0) + 1)
console.log('Addresses found:')
for (const [ip, n] of [...before].sort()) console.log(`   ${ip.padEnd(18)} x${n}`)

let prefixes = explicitPrefixes
if (!prefixes) {
	const counts = new Map<string, number>()
	for (const m of json.matchAll(IPV4)) {
		const a = Number(m[1])
		const b = Number(m[2])
		if (!isPrivate(a, b)) continue
		const p = `${a}.${b}`
		counts.set(p, (counts.get(p) ?? 0) + 1)
	}
	const dominant = [...counts].sort((x, y) => y[1] - x[1])[0]?.[0]
	prefixes = dominant ? [dominant] : []
	console.log(`\nNo --prefixes given; scrubbing the dominant private prefix: ${dominant ?? '(none found)'}`)
}

let replacedAddresses = 0
let out = json.replace(IPV4, (whole, a: string, b: string, rest: string) => {
	if (whole === REAL_LOOPBACK) return whole

	const prefix = `${Number(a)}.${Number(b)}`
	if (prefix === PLACEHOLDER_PREFIX || !prefixes.includes(prefix)) return whole

	replacedAddresses++
	return `${PLACEHOLDER_PREFIX}.${rest}`
})

let replacedCallsign = 0
if (callsign) {
	const upper = callsign.toUpperCase()
	const lower = callsign.toLowerCase()
	replacedCallsign += (out.match(new RegExp(upper, 'g')) ?? []).length
	out = out.split(upper).join(PLACEHOLDER_CALLSIGN)
	replacedCallsign += (out.match(new RegExp(lower, 'g')) ?? []).length
	out = out.split(lower).join(PLACEHOLDER_CALLSIGN.toLowerCase())
}

// Fail loudly rather than shipping a corrupted asset
const parsed = JSON.parse(out)

// Point connections at the modules vendored into this repo rather than at a store download. A
// builtin module reports its version as 'builtin', so a config pinning an exact version like "4.1.2"
// would ignore the bundled copy and try to fetch that release instead.
let repinned = 0
const vendoredPath = path.join(import.meta.dirname, '..', 'bundled-modules', 'VENDORED.json')
if (fs.existsSync(vendoredPath)) {
	const vendored: Set<string> = new Set(
		JSON.parse(fs.readFileSync(vendoredPath, 'utf8')).modules.map((m: { id: string }) => m.id)
	)

	for (const instance of Object.values(parsed.instances ?? {}) as Record<string, unknown>[]) {
		if (!instance || typeof instance !== 'object') continue
		if (!vendored.has(String(instance.moduleId))) continue
		if (instance.moduleVersionId === 'builtin') continue

		instance.moduleVersionId = 'builtin'
		repinned++
	}

	out = JSON.stringify(parsed)
}

fs.mkdirSync(path.dirname(dest), { recursive: true })
fs.writeFileSync(dest, zlib.gzipSync(Buffer.from(out, 'utf8')))

console.log(`\nRebased ${replacedAddresses} address(es) from [${prefixes.join(', ')}] -> ${PLACEHOLDER_PREFIX}`)
if (callsign) console.log(`Replaced ${replacedCallsign} occurrence(s) of "${callsign}" -> ${PLACEHOLDER_CALLSIGN}`)
console.log(`Re-pinned ${repinned} connection(s) to their vendored (builtin) module`)
console.log(`Wrote ${dest}`)

// Anything left that is neither the placeholder nor real loopback would ship as-is - say so loudly
const leftover = [...new Set([...out.matchAll(IPV4)].map((m) => m[0]))].filter(
	(ip) => ip !== REAL_LOOPBACK && !ip.startsWith(`${PLACEHOLDER_PREFIX}.`)
)
if (leftover.length > 0) {
	console.log(`\nWARNING: these addresses are shipped unchanged and will NOT be rebased at install:`)
	for (const ip of leftover.sort()) console.log(`   ${ip}`)
	console.log(`Re-run with --prefixes including their first two octets if they are device addresses.`)
} else {
	console.log('\nAll addresses are placeholders or real loopback - nothing will slip by.')
}
