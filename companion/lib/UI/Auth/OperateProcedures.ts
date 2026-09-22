/**
 * The tRPC mutations that do not require an admin session.
 *
 * Companion's authorization model is deny-by-default: every `.mutation` requires an authenticated
 * admin *except* the paths listed here, which are "operate" actions rather than configuration
 * changes. Pressing a button is a mutation in the same way that editing a connection's config is,
 * but an operator running a show must be able to do the former without holding admin rights.
 *
 * Deny-by-default is the important property for a fork that tracks upstream: when upstream adds a
 * new mutation (which happens constantly) it is protected the moment it is merged, with no action
 * from us. Forgetting to add something to this list fails closed.
 *
 * `OperateProcedures.test.ts` asserts that every path here still exists on the router, so a rename
 * upstream surfaces as a failing test rather than as a silently re-locked button.
 */
export const OPERATE_MUTATION_PATHS: ReadonlySet<string> = new Set([
	// Pressing, rotating and aborting a button from the web UI's button grid or a preview
	'controls.hotPressControl',
	'controls.hotRotateControl',
	'controls.hotAbortControl',

	// The emulator is a surface an operator drives, so it behaves like pressing a physical panel
	'surfaces.emulatorPressed',
	'surfaces.emulatorPinEntry',
])

/**
 * Whether a tRPC mutation at `path` is an operate action, and so available without an admin session.
 */
export function isOperateMutation(path: string): boolean {
	return OPERATE_MUTATION_PATHS.has(path)
}
