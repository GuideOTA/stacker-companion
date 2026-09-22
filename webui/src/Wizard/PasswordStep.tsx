import { useId } from 'react'
import type { JsonValue } from 'type-fest'
import type { UserConfigModel } from '@companion-app/shared/Model/UserConfigModel.js'
import { StaticAlert } from '~/Components/Alert'
import { FormLabel } from '~/Components/Form'
import { Grid } from '~/Components/Grid'
import { NumberInputField } from '~/Components/NumberInputField'

interface PasswordStepProps {
	config: Partial<UserConfigModel>
	setValue: (key: keyof UserConfigModel, value: JsonValue) => void
}

export function PasswordStep({ config, setValue }: PasswordStepProps): React.JSX.Element {
	const timeoutFieldId = useId()

	return (
		<Grid.Row>
			<Grid.Col sm={12}>
				<h5>Admin Login</h5>
				<p>
					Anyone who can reach this interface may view the configuration and press buttons. Changing the configuration
					always requires an admin login - it cannot be turned off, and it is enforced by Companion itself rather than
					only hidden in this interface.
				</p>
				<StaticAlert color="info">
					You set the admin password when you first opened this Companion. You can change it later from Settings.
				</StaticAlert>
			</Grid.Col>

			<FormLabel htmlFor={timeoutFieldId} sm={{ span: 4, offset: 1 }} column="sm" className="mb-2">
				Session Timeout
			</FormLabel>
			<Grid.Col sm={5} className="mb-2">
				<NumberInputField
					id={timeoutFieldId}
					value={config.admin_timeout}
					min={0}
					step={1}
					setValue={(val) => setValue('admin_timeout', val)}
					immediateValue
				/>
				<span className="text-muted">(minutes of inactivity before an admin is logged out, 0 for none)</span>
			</Grid.Col>
			<Grid.Col sm={2}></Grid.Col>
		</Grid.Row>
	)
}
