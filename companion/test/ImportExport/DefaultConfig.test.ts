import os from 'node:os'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
	detectNetworkPrefix,
	findDominantPrefix,
	findSourcePrefix,
	STARTER_CALL_LETTERS,
	STARTER_NETWORK_PREFIX,
	substituteStarterConfig,
} from '../../lib/ImportExport/DefaultConfig.js'

describe('findDominantPrefix', () => {
	test('picks the most common private prefix', () => {
		const json = '"10.49.251.208" "10.49.0.71" "10.49.3.5" "192.168.1.1"'
		expect(findDominantPrefix(json)).toBe('10.49')
	})

	test('ignores public addresses entirely', () => {
		expect(findDominantPrefix('"4.16.19.30" "8.8.8.8" "1.1.1.1"')).toBeNull()
	})

	test('returns null when there are no addresses at all', () => {
		expect(findDominantPrefix('{"label":"no addresses here"}')).toBeNull()
	})
})

describe('findSourcePrefix', () => {
	test('prefers the scrubbed placeholder', () => {
		expect(findSourcePrefix('"host":"0.0.251.208","stray":"10.49.1.1"')).toBe(STARTER_NETWORK_PREFIX)
	})

	test('falls back to the dominant private prefix for an unscrubbed export', () => {
		expect(findSourcePrefix('"a":"10.49.1.1","b":"10.49.1.2"')).toBe('10.49')
	})

	test('returns null when there is nothing to rebase', () => {
		expect(findSourcePrefix('"public":"4.16.19.30"')).toBeNull()
	})
})

describe('detectNetworkPrefix', () => {
	afterEach(() => vi.restoreAllMocks())

	function mockInterfaces(addresses: { address: string; internal: boolean }[]): void {
		vi.spyOn(os, 'networkInterfaces').mockReturnValue({
			eth0: addresses.map(({ address, internal }) => ({
				address,
				netmask: '255.255.255.0',
				family: 'IPv4',
				mac: '00:00:00:00:00:00',
				internal,
				cidr: null,
			})),
		})
	}

	test('prefers an explicit bind address', () => {
		mockInterfaces([{ address: '192.168.5.10', internal: false }])
		expect(detectNetworkPrefix('10.49.251.100')).toBe('10.49')
	})

	test('falls back to the first non-internal interface when bound to everything', () => {
		mockInterfaces([{ address: '192.168.5.10', internal: false }])
		expect(detectNetworkPrefix('0.0.0.0')).toBe('192.168')
		expect(detectNetworkPrefix('::')).toBe('192.168')
		expect(detectNetworkPrefix(null)).toBe('192.168')
	})

	test('skips loopback and other internal interfaces', () => {
		mockInterfaces([
			{ address: '127.0.0.1', internal: true },
			{ address: '10.20.0.5', internal: false },
		])
		expect(detectNetworkPrefix(null)).toBe('10.20')
	})

	test('returns null when only public or internal addresses exist', () => {
		mockInterfaces([{ address: '4.16.19.30', internal: false }])
		expect(detectNetworkPrefix(null)).toBeNull()
		expect(detectNetworkPrefix('127.0.0.1')).toBeNull()
	})
})

describe('substituteStarterConfig', () => {
	const subs = { networkPrefix: '10.80', callLetters: 'WXYZ' }

	test('rebases the placeholder network onto the detected prefix, keeping the last two octets', () => {
		const json = '"host":"0.0.251.208","other":"0.0.0.71"'
		const result = substituteStarterConfig(json, subs)

		expect(result.json).toContain('10.80.251.208')
		expect(result.json).toContain('10.80.0.71')
		expect(result.replacedAddresses).toBe(2)
		expect(result.fromPrefix).toBe(STARTER_NETWORK_PREFIX)
	})

	test('leaves public addresses and loopback alone', () => {
		const json = '"a":"0.0.1.1","public":"4.16.19.30","local":"127.0.0.1"'
		const result = substituteStarterConfig(json, subs)

		expect(result.json).toContain('4.16.19.30')
		expect(result.json).toContain('127.0.0.1')
		expect(result.replacedAddresses).toBe(1)
	})

	test('rebases an unscrubbed export from its own network, rather than leaving it pointing there', () => {
		// Safety net for a real export dropped in as the asset without running the scrub tool
		const json = '"a":"10.49.1.1","b":"10.49.1.2"'
		const result = substituteStarterConfig(json, subs)

		expect(result.fromPrefix).toBe('10.49')
		expect(result.replacedAddresses).toBe(2)
		expect(result.json).not.toContain('10.49.')
	})

	test('substitutes call letters in both cases, matching the source casing', () => {
		const json = `"path":"/Movies/${STARTER_CALL_LETTERS}/A.mov","url":"http://${STARTER_CALL_LETTERS.toLowerCase()}.example.com/"`
		const result = substituteStarterConfig(json, subs)

		expect(result.json).toContain('/Movies/WXYZ/A.mov')
		expect(result.json).toContain('http://wxyz.example.com/')
		expect(result.replacedCallLetters).toBe(2)
	})

	test('does not corrupt mixed-case runs inside base64 image data', () => {
		// These exports embed base64 image data. A case-insensitive replace would silently mangle any
		// image whose data happened to contain the placeholder's letters in some other case.
		const mixedCase = STARTER_CALL_LETTERS[0] + STARTER_CALL_LETTERS.slice(1).toLowerCase()
		const base64 = `Hw2qkd6EPh6CJcFcjnRkx${mixedCase}NvkbOr3fUbw5PwN5VQfNCNeZfKGudqi7MYafXWbhLuP9TKJXG`
		const json = `"image":"${base64}","path":"/Movies/${STARTER_CALL_LETTERS}/A.mov"`
		const result = substituteStarterConfig(json, subs)

		expect(result.json).toContain(base64)
		expect(result.replacedCallLetters).toBe(1)
	})

	test('leaves everything untouched when there is nothing to change', () => {
		const json = `"host":"0.0.1.1","path":"/Movies/${STARTER_CALL_LETTERS}/A.mov"`

		const noPrefix = substituteStarterConfig(json, { networkPrefix: null, callLetters: null })
		expect(noPrefix.json).toBe(json)
		expect(noPrefix.replacedAddresses).toBe(0)
		expect(noPrefix.replacedCallLetters).toBe(0)

		// Same prefix and same call letters means no work to do either
		const same = substituteStarterConfig(json, {
			networkPrefix: STARTER_NETWORK_PREFIX,
			callLetters: STARTER_CALL_LETTERS,
		})
		expect(same.json).toBe(json)
	})

	test('never rebases real loopback', () => {
		const json = '"a":"0.0.1.1","local":"127.0.0.1"'
		const result = substituteStarterConfig(json, subs)

		expect(result.json).toContain('127.0.0.1')
		expect(result.replacedAddresses).toBe(1)
	})

	test('rewrites only the source prefix, not every private address', () => {
		// A stray address on another range is deliberate, not a stale reference to rewrite
		const json = '"a":"0.0.1.1","b":"0.0.1.2","c":"0.0.1.3","stray":"192.168.9.9"'
		const result = substituteStarterConfig(json, subs)

		expect(result.replacedAddresses).toBe(3)
		expect(result.json).toContain('192.168.9.9')
	})
})
