/*
 * Build the vendored connection modules in `bundled-modules/` into the builtin-connections directory that
 * Companion loads at startup.
 *
 *   yarn build:bundled-modules [--force] [--only bmd-atem,generic-http]
 *
 * These modules are shipped with Companion rather than downloaded from the module store, so they can
 * be edited in this repository. Each one is an independent yarn project (its own lockfile, its own
 * pinned @companion-module/base, sometimes its own yarn patches), so it is installed and built in
 * place rather than being hoisted into the monorepo's workspaces - hoisting would collide their
 * pinned dependency versions with the host's.
 *
 * The three shapes a module comes in are all handled:
 *   - plain JavaScript (no build step) - packaged straight from src/
 *   - TypeScript with a `build` script - compiled first, then packaged
 *   - TypeScript with its own `dist` script - same, the script just wraps companion-module-build
 */
import { $, argv, fs, path } from 'zx'

$.verbose = false

// Yarn merges every .yarnrc.yml from the module directory up to the filesystem root, so these nested
// projects inherit the monorepo's. Two settings there break them, and both are neutralised per-call
// rather than by editing the vendored sources:
//   - `approvedGitRepositories` is newer than the Yarn some modules pin (4.12 - 4.17), and an
//     unrecognised setting is fatal unless strict settings are off.
//   - `enableScripts: false` is right for the host but wrong here: it silently skips the postinstall
//     steps modules need to build their native dependencies.
// The result is that each module installs exactly as it would standing alone in its own repository.
$.env = { ...process.env, YARN_ENABLE_STRICT_SETTINGS: 'false', YARN_ENABLE_SCRIPTS: 'true' }

const repoRoot = path.join(import.meta.dirname, '..')
const modulesDir = path.join(repoRoot, 'bundled-modules')
const outDir = path.join(repoRoot, '.cache', 'builtin-connections')

const force = !!argv.force
const only = argv.only
	? String(argv.only)
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
	: null

interface VendoredModule {
	id: string
	version: string
	hasBuildStep: boolean
}

const manifestPath = path.join(modulesDir, 'VENDORED.json')
if (!(await fs.pathExists(manifestPath))) {
	console.log('No vendored modules to build (bundled-modules/VENDORED.json is missing)')
	process.exit(0)
}

const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as { modules: VendoredModule[] }
const wanted = manifest.modules.filter((m) => !only || only.includes(m.id))

await fs.mkdirp(outDir)

let built = 0
let skipped = 0

for (const mod of wanted) {
	const moduleDir = path.join(modulesDir, mod.id)
	const destDir = path.join(outDir, mod.id)

	if (!(await fs.pathExists(moduleDir))) {
		throw new Error(`Vendored module "${mod.id}" is listed in VENDORED.json but missing from bundled-modules/`)
	}

	// Rebuild when any source file is newer than the last build, so an edit is picked up but an
	// unchanged module does not pay for a reinstall on every dev start.
	if (!force && (await fs.pathExists(destDir))) {
		const builtAt = (await fs.stat(destDir)).mtimeMs
		const newestSource = await newestSourceMtime(moduleDir)
		if (newestSource <= builtAt) {
			skipped++
			continue
		}
	}

	console.log(`Building ${mod.id} v${mod.version}`)
	$.cwd = moduleDir

	// The oldest modules are still on Yarn Classic, which refuses to install when a dependency's
	// `engines.node` does not match the Node running the build. That constraint describes the runtime
	// the module is *executed* with, not the one that builds it - Companion ships its own Node 18/22
	// runtimes and picks the one each manifest asks for - so it is not a real conflict here.
	const pkgJson = JSON.parse(await fs.readFile(path.join(moduleDir, 'package.json'), 'utf8'))
	const isYarnClassic = String(pkgJson.packageManager ?? '').startsWith('yarn@1')

	if (isYarnClassic) {
		await $`yarn install --ignore-engines`
	} else {
		await $`yarn install`
	}
	if (mod.hasBuildStep) await $`yarn build`
	await $`yarn companion-module-build`

	$.cwd = undefined

	// Where the package lands depends on the module's vintage of @companion-module/tools: v3 writes
	// pkg/<id>/, v2 writes pkg/ directly (and also drops a .tgz, which is not needed here).
	const pkgDir = await findBuiltPackage(moduleDir, mod.id)
	if (!pkgDir) {
		throw new Error(`Build of "${mod.id}" produced no package under ${path.join(moduleDir, 'pkg')}`)
	}

	await fs.remove(destDir)
	await fs.copy(pkgDir, destDir)
	built++
}

console.log(`Bundled modules ready in ${path.relative(repoRoot, outDir)} (${built} built, ${skipped} up to date)`)

/** Locate the built package, tolerating both tools v2 (pkg/) and v3 (pkg/<id>/) output layouts. */
async function findBuiltPackage(moduleDir: string, moduleId: string): Promise<string | null> {
	for (const candidate of [path.join(moduleDir, 'pkg', moduleId), path.join(moduleDir, 'pkg')]) {
		if (await fs.pathExists(path.join(candidate, 'companion', 'manifest.json'))) return candidate
	}

	return null
}

/** Newest mtime across a module's own sources, ignoring build output and dependencies. */
async function newestSourceMtime(moduleDir: string): Promise<number> {
	const ignored = new Set(['node_modules', 'pkg', 'dist', '.yarn', '.git'])
	let newest = 0

	async function walk(dir: string): Promise<void> {
		for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
			if (ignored.has(entry.name)) continue

			const full = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				await walk(full)
			} else {
				const { mtimeMs } = await fs.stat(full)
				if (mtimeMs > newest) newest = mtimeMs
			}
		}
	}

	await walk(moduleDir)
	return newest
}
