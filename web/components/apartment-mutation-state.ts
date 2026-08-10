import type {
  ApartmentSite,
  ApartmentSiteConfigurationInput,
  ApartmentSiteMembershipInput,
  TerritoryWorkspace,
} from '../lib/database.ts';
import { apartmentSiteReady, withApartmentSiteConfiguration } from '../lib/territory-client.ts';
import type { MutationResult } from './operation-state.ts';

export type ApartmentMutation =
  | { kind: 'configuration'; input: ApartmentSiteConfigurationInput }
  | { kind: 'membership'; input: ApartmentSiteMembershipInput };

export type ApartmentSaveFailure = {
  id: string;
  mutation: ApartmentMutation;
  message: string;
  recovery: 'retry' | 'reload';
};

export function optimisticApartmentConfiguration(
  previousWorkspace: TerritoryWorkspace,
  input: ApartmentSiteConfigurationInput,
): TerritoryWorkspace | null {
  const current = previousWorkspace.apartmentSites.find(({ id }) => id === input.id);
  if (!current) return null;
  const packetReady = apartmentSiteReady(input);
  const optimistic: ApartmentSite = {
    ...current,
    ...input,
    packetReady,
    includedInPackets: packetReady && input.includedInPackets,
  };
  return withApartmentSiteConfiguration(previousWorkspace, optimistic);
}

export function resolveApartmentMutation(
  previousWorkspace: TerritoryWorkspace,
  mutation: ApartmentMutation,
  result: MutationResult<TerritoryWorkspace>,
): { workspace: TerritoryWorkspace; failure: ApartmentSaveFailure | null } {
  if (result.status === 'success') {
    return { workspace: result.value, failure: null };
  }
  return {
    workspace: previousWorkspace,
    failure: {
      id: mutation.input.id ?? 'new',
      mutation,
      message:
        result.status === 'rejected'
          ? result.message
          : mutation.kind === 'configuration'
            ? 'Streetlight could not confirm whether the apartment site was saved.'
            : 'Streetlight could not confirm whether the apartment grouping was saved.',
      recovery: result.recovery,
    },
  };
}
