import { useQuery } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useMemo } from 'react'
import type { AdminAuthStatus, AdminLoginResponse } from '@companion-app/shared/Model/AdminAuth.js'
import { trpc } from '~/Resources/TRPC.js'
import { makeAbsolutePath } from '~/Resources/util.js'

export interface AdminAuthContextValue extends AdminAuthStatus {
	/** True until the initial status has been fetched, so the UI can avoid flashing a read-only state. */
	isLoading: boolean
	/** Attempt a login. On success the page reloads, so the resolved value only matters on failure. */
	login: (password: string) => Promise<AdminLoginResponse>
	/** Set the first admin password on an unclaimed Companion, which also logs this client in. */
	claim: (password: string) => Promise<AdminLoginResponse>
	logout: () => Promise<void>
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null)

/**
 * Admin auth state for the web UI.
 *
 * This decides what the UI *offers*, never what it *allows* - every configuration change is checked
 * again on the server, so a client that lies about being an admin simply gets its mutations rejected.
 *
 * Login and logout are plain HTTP posts rather than tRPC calls: tRPC runs over a WebSocket, which
 * cannot set a cookie. After either, the page is reloaded so the WebSocket reconnects and its context
 * picks up the new session (the app already reloads on reconnect for the same reason).
 */
export function AdminAuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
	const statusQuery = useQuery({
		...trpc.adminAuth.status.queryOptions(),
		// A session can expire while the page is open; noticing within a minute is good enough to keep
		// the UI honest without polling hard.
		refetchInterval: 60_000,
	})

	// Both endpoints take a password and, on success, set the session cookie - so they differ only in
	// which one is valid at the time. Either way the page reloads, so the websocket reconnects and its
	// tRPC context picks the new session up.
	const postPassword = useCallback(
		async (path: string, password: string, failureMessage: string): Promise<AdminLoginResponse> => {
			const response = await fetch(makeAbsolutePath(path), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'same-origin',
				body: JSON.stringify({ password }),
			})

			const body = (await response.json().catch(() => ({}))) as AdminLoginResponse

			if (!response.ok || !body.success) {
				return { success: false, message: body.message ?? failureMessage }
			}

			window.location.reload()
			return { success: true }
		},
		[]
	)

	const login = useCallback(
		async (password: string) => postPassword('/admin-auth/login', password, 'Login failed'),
		[postPassword]
	)

	const claim = useCallback(
		async (password: string) => postPassword('/admin-auth/claim', password, 'Could not set the password'),
		[postPassword]
	)

	const logout = useCallback(async (): Promise<void> => {
		await fetch(makeAbsolutePath('/admin-auth/logout'), {
			method: 'POST',
			credentials: 'same-origin',
		}).catch(() => {
			// Even if the request fails, fall through to the reload - the session may already be gone
		})

		window.location.reload()
	}, [])

	const value = useMemo(
		(): AdminAuthContextValue => ({
			isAdmin: statusQuery.data?.isAdmin ?? false,
			// Default to "claimed" while loading, so a slow status fetch never flashes the setup screen
			// at someone on a configured system.
			isUnclaimed: statusQuery.data?.isUnclaimed ?? false,
			isLoading: statusQuery.isLoading,
			login,
			claim,
			logout,
		}),
		[statusQuery.data, statusQuery.isLoading, login, claim, logout]
	)

	return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
}

/**
 * Admin auth state. Throws outside the provider rather than defaulting to "not admin", so a missing
 * provider is a loud bug instead of a silently read-only page.
 */
export function useAdminAuth(): AdminAuthContextValue {
	const value = useContext(AdminAuthContext)
	if (!value) throw new Error('useAdminAuth must be used within an AdminAuthProvider')
	return value
}

/** Whether the current client may make configuration changes. */
export function useIsAdmin(): boolean {
	return useAdminAuth().isAdmin
}
