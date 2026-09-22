import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { isOperateMutation, OPERATE_MUTATION_PATHS } from '../../../lib/UI/Auth/OperateProcedures.js'

const LIB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../lib')

type ProcedureType = 'mutation' | 'query' | 'subscription'

/** Every `<name>: publicProcedure ... .<type>(` declaration in the backend, by procedure name. */
function collectProcedures(): Map<string, Set<ProcedureType>> {
	const found = new Map<string, Set<ProcedureType>>()

	const walk = (dir: string): void => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				walk(full)
			} else if (entry.name.endsWith('.ts')) {
				const source = fs.readFileSync(full, 'utf-8')
				const declaration = /(\w+):\s*publicProcedure/g

				let match: RegExpExecArray | null
				while ((match = declaration.exec(source)) !== null) {
					// Look ahead only as far as the next procedure declaration, so a name is never
					// attributed the type of the procedure that follows it.
					const rest = source.slice(match.index + match[0].length)
					const nextDeclaration = rest.search(/\w+:\s*publicProcedure/)
					const window = nextDeclaration < 0 ? rest : rest.slice(0, nextDeclaration)

					const type = /\.(mutation|query|subscription)\(/.exec(window)?.[1] as ProcedureType | undefined
					if (!type) continue

					const types = found.get(match[1]) ?? new Set<ProcedureType>()
					types.add(type)
					found.set(match[1], types)
				}
			}
		}
	}

	walk(LIB_DIR)
	return found
}

describe('OperateProcedures', () => {
	const procedures = collectProcedures()

	test('the scan finds the backend procedures at all', () => {
		// Guards the rest of this file: a broken scan must not silently pass every assertion
		expect(procedures.size).toBeGreaterThan(100)
		expect(procedures.get('setConfigKey')).toContain('mutation')
	})

	test.each([...OPERATE_MUTATION_PATHS])('%s still exists and is still a mutation', (routerPath) => {
		const name = routerPath.split('.').at(-1)!
		const types = procedures.get(name)

		// If this fails, upstream has renamed or removed the procedure. The allowlist entry is now dead,
		// which means the button it was meant to keep working is silently admin-only again.
		expect(types, `no procedure named "${name}" found in the backend`).toBeDefined()

		// If a mutation became a query upstream it no longer needs allowlisting - and leaving it here
		// would be misleading.
		expect(types).toContain('mutation')
	})

	test('configuration-changing mutations are never allowlisted', () => {
		// A spot-check that the allowlist has not been widened into config editing, which would defeat
		// the entire point of the guard.
		const mustBeProtected = [
			'controls.setOptionsField',
			'controls.resetControls',
			'controls.importPreset',
			'userConfig.setConfigKey',
			'userConfig.setConfigKeys',
			'importExport.importFull',
			'importExport.resetConfiguration',
			'instances.connections.add',
			'instances.connections.setConfig',
			'adminAuth.changePassword',
		]

		for (const routerPath of mustBeProtected) {
			expect(isOperateMutation(routerPath), `${routerPath} must require an admin session`).toBe(false)
		}
	})

	test('the allowlist stays small enough to review by eye', () => {
		// Not a correctness property, but a deliberate tripwire: every addition here widens what an
		// unauthenticated client can do, and should be a conscious decision.
		expect(OPERATE_MUTATION_PATHS.size).toBeLessThanOrEqual(8)
	})
})
