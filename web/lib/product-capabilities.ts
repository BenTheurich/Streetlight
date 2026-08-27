// Apartment support is preserved but deferred from this MVP. See docs/APARTMENTS_MVP_DEFERRAL.md.
export const APARTMENTS_ENABLED = false;

type ApartmentWorkspace = {
  apartmentComplexes: readonly unknown[];
  apartmentSites?: readonly unknown[];
};

export function applyMvpCapabilities<T extends ApartmentWorkspace>(
  workspace: T,
  apartmentsEnabled = APARTMENTS_ENABLED,
): T {
  if (apartmentsEnabled) return workspace;

  return {
    ...workspace,
    apartmentComplexes: [],
    ...(Object.hasOwn(workspace, 'apartmentSites') ? { apartmentSites: [] } : {}),
  };
}
