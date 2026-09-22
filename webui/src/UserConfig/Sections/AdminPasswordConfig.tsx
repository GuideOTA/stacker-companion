import { observer } from 'mobx-react-lite'
import { useCallback, useState } from 'react'
import { ADMIN_PASSWORD_MIN_LENGTH } from '@companion-app/shared/Model/AdminAuth.js'
import { StaticAlert } from '~/Components/Alert.js'
import { Button } from '~/Components/Button.js'
import { SecretTextInputField } from '~/Components/SecretTextInputField.js'
import { useAdminAuth } from '~/Hooks/useAdminAuth.js'
import { trpc, useMutationExt } from '~/Resources/TRPC.js'
import type { UserConfigProps } from '../Components/Common.js'
import { UserConfigHeadingRow } from '../Components/UserConfigHeadingRow.js'
import { UserConfigNumberInputRow } from '../Components/UserConfigNumberInputRow.js'

export const AdminPasswordConfig = observer(function AdminPasswordConfig(props: UserConfigProps) {
	const { isAdmin } = useAdminAuth()

	return (
		<>
			<UserConfigHeadingRow label="Admin Login" helpAction="/user-guide/config/settings#admin-ui-password" />

			<tr>
				<td colSpan={3}>
					<StaticAlert color="info">
						Anyone who can reach Companion may view the configuration and press buttons. Changing the configuration
						requires this admin login, and is enforced by Companion itself - not just hidden in this UI.
					</StaticAlert>
				</td>
			</tr>

			<UserConfigNumberInputRow
				userConfig={props}
				label="Session Timeout (minutes, 0 for no timeout)"
				field="admin_timeout"
				min={0}
				max={24 * 60}
			/>

			{isAdmin && <ChangePasswordRow />}
		</>
	)
})

/**
 * Change the admin password.
 *
 * The current password is required even though the form is only shown to a logged-in admin, so that
 * an unattended logged-in browser cannot be used to lock the real admin out. A successful change
 * revokes every session, including this one, so the page reloads back to the read-only view.
 */
const ChangePasswordRow = observer(function ChangePasswordRow() {
	const [currentPassword, setCurrentPassword] = useState('')
	const [newPassword, setNewPassword] = useState('')
	const [errorMessage, setErrorMessage] = useState<string | null>(null)

	const changePasswordMutation = useMutationExt(trpc.adminAuth.changePassword.mutationOptions())

	const tooShort = newPassword.length > 0 && newPassword.length < ADMIN_PASSWORD_MIN_LENGTH
	const canSubmit = !!currentPassword && newPassword.length >= ADMIN_PASSWORD_MIN_LENGTH

	const doChange = useCallback(() => {
		setErrorMessage(null)

		changePasswordMutation
			.mutateAsync({ currentPassword, newPassword })
			.then(() => {
				// Every session was just revoked, including this one
				window.location.reload()
			})
			.catch((e: Error) => {
				setErrorMessage(e.message || 'Failed to change the password')
			})
	}, [changePasswordMutation, currentPassword, newPassword])

	return (
		<tr>
			<td>Change Password</td>
			<td colSpan={2}>
				<div className="flex flex-col gap-2">
					<SecretTextInputField
						id="admin-current-password"
						value={currentPassword}
						setValue={setCurrentPassword}
						placeholder="Current password"
						immediateValue
					/>
					<SecretTextInputField
						id="admin-new-password"
						value={newPassword}
						setValue={setNewPassword}
						placeholder={`New password (at least ${ADMIN_PASSWORD_MIN_LENGTH} characters)`}
						checkValid={tooShort ? false : undefined}
						immediateValue
					/>
					<div>
						<Button color="primary" disabled={!canSubmit} onClick={doChange}>
							Change Password
						</Button>
					</div>
					{errorMessage ? <p className="text-danger">{errorMessage}</p> : null}
				</div>
			</td>
		</tr>
	)
})
