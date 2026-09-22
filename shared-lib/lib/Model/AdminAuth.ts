/**
 * The admin authentication state, as reported to the web UI.
 *
 * Companion's web UI is readable by anyone who can reach it, but every configuration change requires
 * an authenticated admin session. This is what the UI uses to decide whether to render editing
 * affordances - it is a convenience for the client, never the enforcement point. Enforcement lives on
 * the server, in the tRPC mutation guard.
 */
export interface AdminAuthStatus {
	/** Whether this client holds a valid admin session. */
	isAdmin: boolean
	/**
	 * Whether this Companion has never had an admin password set. While true, the web UI shows the
	 * first-run setup screen instead of the app, and the claim endpoint will accept a password from
	 * anyone who can reach it. It becomes false the moment a password is set, and cannot return to
	 * true except by an explicit reset from the command line.
	 */
	isUnclaimed: boolean
}

export interface AdminLoginRequest {
	password: string
}

export interface AdminLoginResponse {
	success: boolean
	/** Present when `success` is false, for display in the form. */
	message?: string
}

export interface AdminClaimRequest {
	password: string
}

export interface AdminChangePasswordRequest {
	currentPassword: string
	newPassword: string
}

/** Minimum length enforced on an admin password, on both the client and the server. */
export const ADMIN_PASSWORD_MIN_LENGTH = 8
