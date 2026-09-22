import { useId } from 'react'
import type { UserConfigModel } from '@companion-app/shared/Model/UserConfigModel.js'
import { StaticAlert } from '~/Components/Alert'
import { FormLabel } from '~/Components/Form'
import { Grid } from '~/Components/Grid'
import { TextInputField } from '~/Components/TextInputField'

interface StationStepProps {
	config: Partial<UserConfigModel>
	setValue: (key: keyof UserConfigModel, value: any) => void
}

export function StationStep({ config, setValue }: StationStepProps): React.JSX.Element {
	const callLettersId = useId()
	const callLetters = String(config.stationCallLetters ?? '')
	const pending = !!config.starterConfigPending

	return (
		<Grid.Row>
			<Grid.Col sm={12}>
				<h5>Station</h5>
				<p>
					The call letters of the station this Companion belongs to. They are shown in the header, so it is obvious at a
					glance which station's instance you are looking at when several are open at once.
				</p>
			</Grid.Col>

			<FormLabel htmlFor={callLettersId} sm={{ span: 4, offset: 1 }} column="sm" className="mb-2">
				Call Letters
			</FormLabel>
			<Grid.Col sm={5} className="mb-2">
				<TextInputField
					id={callLettersId}
					value={callLetters}
					placeholder="e.g. KJRH"
					setValue={(value) => setValue('stationCallLetters', String(value).trim().toUpperCase())}
					checkValid={callLetters.length > 0 && callLetters.length < 3 ? false : undefined}
				/>
			</Grid.Col>
			<Grid.Col sm={2}></Grid.Col>

			{pending && (
				<Grid.Col sm={12} className="mt-2">
					<StaticAlert color="info">
						This build ships a starter configuration - pages, connections and surfaces for a station like this one. It
						is applied when you finish this wizard, rewritten for these call letters and for the network this machine is
						on. Setting the call letters is what releases it.
					</StaticAlert>
				</Grid.Col>
			)}

			<Grid.Col sm={12}>
				<p className="text-muted mt-4 text-sm">You can change this later on the 'Settings' tab in the GUI.</p>
			</Grid.Col>
		</Grid.Row>
	)
}
