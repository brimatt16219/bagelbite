import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // One retry smooths over a transient network blip without hammering a failing endpoint.
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
