/** Shared React Query settings for Access Control live lists (phone + desktop stay in sync). */
export const currentlyInsideQueryKey = ["/api/access-control/currently-inside"] as const;

export const accessOverviewQueryKey = ["/api/access-control/overview"] as const;

export function accessActivityQueryKey(destinationId?: number) {
  return ["/api/access-control/activity", destinationId ?? "all"] as const;
}

export const currentlyInsideQueryOptions = {
  staleTime: 0,
  refetchInterval: 10_000,
  refetchIntervalInBackground: true,
  refetchOnWindowFocus: true,
} as const;

export const accessOverviewQueryOptions = {
  staleTime: 0,
  refetchInterval: 15_000,
  refetchIntervalInBackground: true,
  refetchOnWindowFocus: true,
} as const;
