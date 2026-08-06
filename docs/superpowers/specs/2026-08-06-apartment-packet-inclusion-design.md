# Apartment packet inclusion

## Decision

Replace the apartment complex `Needs review`, `Ready`, and `Deferred` controls with one checkbox:
`Include in packet generation`. Imported apartment complexes are not included by default.

## Interaction

- Checking the control immediately makes the complex eligible to generate as one atomic apartment
  packet.
- Unchecking it immediately removes the complex from future packet generation.
- The change saves independently; Region Setup's Save and Cancel controls continue to govern only
  region and road edits.
- A complex without a usable starting address cannot be included. Its disabled checkbox explains
  that a starting address is required.

## Data flow and recovery

The client sends the selected complex ID and inclusion boolean to an authenticated, church-scoped
endpoint. The endpoint validates the exact request, verifies that the complex belongs to the current
church, rejects inclusion without an address, persists the change atomically, and returns the saved
complex state.

The checkbox updates optimistically and disables during the request. Success remains quiet. A
confirmed failure restores the previous value and shows an inline error with a retry action. An
uncertain response requires reload verification rather than claiming that the change succeeded.

The existing database status may remain an internal compatibility detail: `ready` means included;
all other values mean not included. Product copy and controls no longer expose the three statuses.

## Verification

- API checks cover authentication, church isolation, exact request validation, missing-address
  rejection, inclusion, exclusion, and replay-safe updates.
- UI checks cover the single checkbox, default-off presentation, disabled missing-address state,
  independent autosave, failure rollback, and removal of the three status choices.
- Existing packet generation checks continue to prove that only included complexes participate.
