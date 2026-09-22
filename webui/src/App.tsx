import { DragDropProvider } from '@dnd-kit/react'
import './loading.css'
import './App.css'
import { Outlet } from '@tanstack/react-router'
import { observer } from 'mobx-react-lite'
import { Suspense, useCallback, useContext, useEffect, useState } from 'react'
import { useIdleTimer } from 'react-idle-timer'
import { PuffLoader } from 'react-spinners'
import { ADMIN_PASSWORD_MIN_LENGTH } from '@companion-app/shared/Model/AdminAuth.js'
import { Grid } from '~/Components/Grid'
import { useEvictDeadCollapseState } from '~/Helpers/useEvictDeadCollapseState.js'
import { useMountEffect } from '~/Resources/util.js'
import { RootAppStoreContext } from '~/Stores/RootAppStore.js'
import { Button } from './Components/Button.js'
import { Form, FormLabel, InputGroup } from './Components/Form.js'
import { ProgressBar } from './Components/ProgressBar.js'
import { SecretTextInputField } from './Components/SecretTextInputField.js'
import { ContextData } from './ContextData.js'
import { EntityDragLayer } from './Controls/Components/EntityDragLayer.js'
import { AdminAuthProvider, useAdminAuth } from './Hooks/useAdminAuth.js'
import { TRPCConnectionStatus, useTRPCConnectionStatus } from './Hooks/useTRPCConnectionStatus.js'
import { MyHeader } from './Layout/Header.js'
import { MySidebar, SidebarStateProvider } from './Layout/Sidebar.js'
import { PRIMARY_COLOR, PRODUCT_FULL_NAME } from './Resources/Constants.js'
import { MyErrorBoundary } from './Resources/Error.js'
import { MonacoLoader } from './Resources/MonacoLoader.js'
import { SortableHysteresis } from './Resources/SortableHysteresis.js'
import { shouldAutoOpenWizard } from './Wizard/Constants.js'
import { WizardModal } from './Wizard/index.js'

export default function App(): React.JSX.Element {
	const trpcStatus = useTRPCConnectionStatus()

	const connected = trpcStatus.status === TRPCConnectionStatus.Connected
	const wasConnected = trpcStatus.wasConnected
	const shouldReload = connected && wasConnected

	useEffect(() => {
		if (shouldReload) {
			console.log('Reloading page after TRPC reconnect')
			// Reload the page to ensure that the UI is up-to-date and we don't have any stale data
			window.location.reload()
		}
	}, [shouldReload])

	return (
		<ContextData>
			{(loadingProgress, loadingComplete) => (
				<>
					<div id="error-container" className={wasConnected ? 'show-error' : ''}>
						<Grid.Row>
							<Grid.Col md={{ span: 6, offset: 3 }}>
								<div className="clearfix">
									<h4 className="pt-4">Houston, we have a problem!</h4>
									<p className="text-muted">It seems that we have lost connection to the companion app.</p>
									<ul className="text-muted">
										<li>Check that the application is still running</li>
										<li>If you're using the Admin GUI over a network - check your connection</li>
									</ul>
								</div>
							</Grid.Col>
						</Grid.Row>
					</div>
					<ImportTaskOverlay wasConnected={wasConnected} />
					<Suspense
						fallback={
							<Grid.Row className={'loading'}>
								<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '300px' }}>
									<PuffLoader loading={true} size={80} color={PRIMARY_COLOR} />
								</div>
							</Grid.Row>
						}
					>
						<MonacoLoader />
						{/*
						 * Single global dnd-kit provider for all drag and drop. Each feature subscribes to its
						 * own drags via useDragDropMonitor() and filters by drag `type`, so handlers stay scoped
						 * while dragging between different parts of the UI remains possible (one shared manager).
						 * Feedback mode is configured per-draggable where needed (e.g. presets drag a clone with
						 * no drop animation - see PresetIconPreview); everything else uses the defaults.
						 */}
						<DragDropProvider>
							<SortableHysteresis />
							<EntityDragLayer />
							<AdminAuthProvider>
								<AppMain
									connected={connected && !shouldReload}
									loadingComplete={loadingComplete}
									loadingProgress={loadingProgress}
								/>
							</AdminAuthProvider>
						</DragDropProvider>
					</Suspense>
				</>
			)}
		</ContextData>
	)
}

// Reads the shared import/reset task status (driven by useImportTaskStatusSubscription) and shows the
// blocking overlay on still-connected clients while a task runs. A dropped client sees the
// disconnect screen instead, and reloads on reconnect.
const ImportTaskOverlay = observer(function ImportTaskOverlay({ wasConnected }: { wasConnected: boolean }) {
	const { importTaskStatus } = useContext(RootAppStoreContext)
	const taskRunning = importTaskStatus.get()?.status === 'running'

	return (
		<div id="current-import-container" className={!wasConnected && taskRunning ? 'show-error' : ''}>
			<Grid.Row>
				<Grid.Col md={{ span: 6, offset: 3 }}>
					<div className="clearfix">
						<h4 className="pt-4">Stand by, the config is being updated!</h4>
					</div>
				</Grid.Col>
			</Grid.Row>
		</div>
	)
})

interface AppMainProps {
	connected: boolean
	loadingComplete: boolean
	loadingProgress: number
}

const AppMain = observer(function AppMain({ connected, loadingComplete, loadingProgress }: AppMainProps) {
	const { userConfig, wizardOpen } = useContext(RootAppStoreContext)

	// Once everything has loaded, prune collapse-state keys for controls/connections that no longer exist
	useEvictDeadCollapseState(loadingComplete)

	const { isAdmin, isUnclaimed, logout } = useAdminAuth()
	const [showLogin, setShowLogin] = useState(false)

	// Logging out drops back to the read-only view, rather than to an unusable locked screen: anyone
	// who can reach Companion is allowed to watch it and press buttons.
	const handleLogout = useCallback(() => {
		setShowLogin(false)
		void logout()
	}, [logout])

	// const wizardModal = useRef<WizardModalRef>(null)
	// const showWizard = useCallback(() => {
	// 	if (unlocked) {

	// 		wizardModal.current?.show()
	// 	}
	// }, [unlocked])

	const setup_wizard = userConfig.properties?.setup_wizard
	// The setup wizard only changes configuration, so it is of no use to a viewer
	useEffect(() => {
		if (isAdmin && shouldAutoOpenWizard(setup_wizard)) {
			wizardOpen.set(true)
		}
	}, [isAdmin, setup_wizard, wizardOpen])

	const adminTimeout = userConfig.properties?.admin_timeout ?? 0

	return (
		<div className="c-app">
			<SidebarStateProvider>
				{isAdmin && adminTimeout > 0 ? <IdleTimerWrapper setLocked={handleLogout} timeoutMinutes={adminTimeout} /> : ''}
				<MySidebar />
				<div className="wrapper flex flex-col min-h-screen bg-app-frame-bg">
					<MyHeader isAdmin={isAdmin} onLogin={isUnclaimed ? null : () => setShowLogin(true)} onLogout={handleLogout} />
					<div className="body grow">
						{connected && loadingComplete ? (
							isUnclaimed ? (
								<AppFirstRunSetup />
							) : showLogin && !isAdmin ? (
								<AppAuthWrapper cancel={() => setShowLogin(false)} />
							) : (
								<AppContent />
							)
						) : (
							<AppLoading progress={loadingProgress} connected={connected} />
						)}
					</div>
				</div>
			</SidebarStateProvider>
		</div>
	)
})

interface IdleTimerWrapperProps {
	setLocked: () => void
	timeoutMinutes: number
}

/** Wrap the idle timer in its own component, as it invalidates every second */
function IdleTimerWrapper({ setLocked, timeoutMinutes }: IdleTimerWrapperProps) {
	const { notifier } = useContext(RootAppStoreContext)

	const [, setIdleTimeout] = useState<NodeJS.Timeout | null>(null)

	const TOAST_ID = 'SESSION_TIMEOUT_TOAST'
	const TOAST_DURATION = 45 * 1000

	const handleOnActive = () => {
		// user is now active, abort the lock
		setIdleTimeout((v) => {
			if (v) {
				clearTimeout(v)
			}

			// close toast
			notifier.close(TOAST_ID)

			return null
		})
	}
	const handleAction = () => {
		// setShouldShowIdleWarning(false)
	}

	const handleIdle = () => {
		notifier.show(
			'Session timeout',
			'Your session is about to timeout, and Companion will be locked',
			undefined,
			TOAST_ID
		)

		setIdleTimeout((v) => {
			if (!v) {
				return setTimeout(() => {
					// close toast
					notifier.close(TOAST_ID)

					setLocked()
				}, TOAST_DURATION)
			}

			return v
		})
	}

	const cappedTimeout = Math.min(timeoutMinutes, 24 * 60) // cap to 24 hours

	useIdleTimer({
		timeout: cappedTimeout * 60 * 1000 - TOAST_DURATION,
		onIdle: handleIdle,
		onActive: handleOnActive,
		onAction: handleAction,
		debounce: 500,
	})

	useMountEffect(() => {
		return () => {
			setIdleTimeout((v) => {
				if (v) {
					clearTimeout(v)
				}
				return null
			})

			// close toast
			notifier.close(TOAST_ID)
		}
	})

	return null
}

interface AppLoadingProps {
	progress: number
	connected: boolean
}

function AppLoading({ progress, connected }: AppLoadingProps) {
	const message = connected ? 'Syncing' : 'Connecting'
	return (
		<Grid.Container className="fadeIn loading">
			<Grid.Row>
				<Grid.Col xxl={4} md={3} sm={2} xs={1}></Grid.Col>
				<Grid.Col xxl={4} md={6} sm={8} xs={10}>
					<h3>{message}</h3>
					{connected ? (
						<ProgressBar className="mt-6" value={progress} />
					) : (
						<div className="flex items-center justify-center mt-6">
							<PuffLoader loading={true} size={80} color={PRIMARY_COLOR} />
						</div>
					)}
				</Grid.Col>
			</Grid.Row>
		</Grid.Container>
	)
}

/**
 * First-run setup: choose the admin password on a Companion that has never had one.
 *
 * There is no default password anywhere in the source - a shipped credential would be a published
 * one - so a fresh install is "unclaimed" and the first client to reach it takes ownership here.
 * Setting the password also logs this client in, so setup continues straight into the wizard.
 */
const AppFirstRunSetup = observer(function AppFirstRunSetup() {
	const { claim } = useAdminAuth()

	const [password, setPassword] = useState('')
	const [confirm, setConfirm] = useState('')
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)

	const tooShort = password.length > 0 && password.length < ADMIN_PASSWORD_MIN_LENGTH
	const mismatch = confirm.length > 0 && confirm !== password
	const canSubmit = password.length >= ADMIN_PASSWORD_MIN_LENGTH && confirm === password && !busy

	const doClaim = useCallback(
		(e: React.FormEvent<HTMLFormElement>) => {
			e.preventDefault()
			if (!canSubmit) return false

			setBusy(true)
			claim(password)
				.then((result) => {
					// A success reloads the page, so there is nothing to do here but report failure
					if (!result.success) setErrorMessage(result.message ?? 'Could not set the password')
				})
				.catch(() => setErrorMessage('Could not reach Companion'))
				.finally(() => setBusy(false))

			return false
		},
		[canSubmit, claim, password]
	)

	return (
		<Grid.Container className="fadeIn loading">
			<Grid.Row>
				<Grid.Col xxl={4} md={3} sm={2} xs={1}></Grid.Col>
				<Grid.Col xxl={4} md={6} sm={8} xs={10}>
					<h3>Set up Companion</h3>
					<p className="text-muted">
						This Companion has no admin password yet. Choose one now - until you do, anyone who can reach this page can
						set it. Viewing and pressing buttons will not need a login; changing the configuration will.
					</p>
					<Form onSubmit={doClaim}>
						<FormLabel htmlFor="first-run-password">New password</FormLabel>
						<SecretTextInputField
							id="first-run-password"
							value={password}
							setValue={(v) => {
								setPassword(v)
								setErrorMessage(null)
							}}
							checkValid={tooShort ? false : undefined}
							immediateValue
						/>
						<FormLabel htmlFor="first-run-confirm">Confirm password</FormLabel>
						<SecretTextInputField
							id="first-run-confirm"
							value={confirm}
							setValue={(v) => {
								setConfirm(v)
								setErrorMessage(null)
							}}
							checkValid={mismatch ? false : undefined}
							immediateValue
						/>
						<Button type="submit" color="primary" disabled={!canSubmit} className="mt-2">
							Set password
						</Button>
					</Form>
					{tooShort ? (
						<p className="text-muted mt-2">Must be at least {ADMIN_PASSWORD_MIN_LENGTH} characters.</p>
					) : null}
					{mismatch ? <p className="text-danger mt-2">The passwords do not match.</p> : null}
					{errorMessage ? <p className="text-danger mt-2">{errorMessage}</p> : null}
				</Grid.Col>
			</Grid.Row>
		</Grid.Container>
	)
})

interface AppAuthWrapperProps {
	cancel: () => void
}

/**
 * The admin login form.
 *
 * Note that unlike the lock screen this replaces, the password is never compared here - it is posted
 * to Companion, which holds only a salted hash of it. The old screen compared the password in the
 * browser against a copy broadcast to every client, so it protected nothing.
 */
const AppAuthWrapper = observer(function AppAuthWrapper({ cancel }: AppAuthWrapperProps) {
	const { login } = useAdminAuth()

	const [password, setPassword] = useState('')
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)

	const passwordChanged = useCallback((newValue: string) => {
		setPassword(newValue)
		setErrorMessage(null)
	}, [])

	const tryLogin = useCallback(
		(e: React.FormEvent<HTMLFormElement>) => {
			e.preventDefault()
			setBusy(true)

			login(password)
				.then((result) => {
					// A successful login reloads the page, so there is nothing to do here but report failure
					if (!result.success) setErrorMessage(result.message ?? 'Login failed')
				})
				.catch(() => setErrorMessage('Could not reach Companion'))
				.finally(() => setBusy(false))

			return false
		},
		[login, password]
	)

	return (
		<Grid.Container className="fadeIn loading">
			<Grid.Row>
				<Grid.Col xxl={4} md={3} sm={2} xs={1}></Grid.Col>
				<Grid.Col xxl={4} md={6} sm={8} xs={10}>
					<h3>Admin login</h3>
					<p className="text-muted">
						Companion is read-only until you log in. Viewing the configuration and pressing buttons do not need a login
						- changing the configuration does.
					</p>
					<Form onSubmit={tryLogin}>
						<InputGroup>
							<SecretTextInputField
								id={undefined}
								value={password}
								setValue={passwordChanged}
								checkValid={errorMessage ? false : undefined}
								immediateValue
							/>
							<Button type="submit" color="primary" disabled={busy}>
								Log in
							</Button>
							<Button type="button" color="secondary" onClick={cancel} disabled={busy}>
								Cancel
							</Button>
						</InputGroup>
					</Form>
					{errorMessage ? <p className="text-danger mt-2">{errorMessage}</p> : null}
				</Grid.Col>
			</Grid.Row>
		</Grid.Container>
	)
})

const AppContent = observer(function AppContent() {
	const { userConfig } = useContext(RootAppStoreContext)

	useEffect(() => {
		document.title =
			userConfig.properties?.installName && userConfig.properties?.installName.length > 0
				? `${userConfig.properties?.installName} - Admin (${PRODUCT_FULL_NAME})`
				: `${PRODUCT_FULL_NAME} - Admin`
	}, [userConfig.properties?.installName])

	return (
		<Grid.Container className="fadeIn">
			<WizardModal />

			<MyErrorBoundary>
				<Outlet />
			</MyErrorBoundary>
		</Grid.Container>
	)
})
