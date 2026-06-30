/** Shared React Query settings for Access Control live lists (phone + desktop stay in sync). */
export const currentlyInsideQueryKey = ["/api/access-control/currently-inside"] as const;

export const currentlyInsideQueryOptions = {
  staleTime: 0,
  refetchInterval: 10_000,
  refetchIntervalInBackground: true,
  refetchOnWindowFocus: true,
} as const;
