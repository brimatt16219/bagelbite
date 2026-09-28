import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { EnrollRequest } from '@shared/api'
import { api } from './api'

export const keys = {
  enrollments: ['enrollments'] as const,
  dashboard: ['dashboard'] as const,
  enrollment: (topicId: string) => ['enrollment', topicId] as const,
  next: (topicId: string) => ['next', topicId] as const,
  bite: (biteId: string) => ['bite', biteId] as const,
  dueReviews: (topicId?: string) => ['dueReviews', topicId ?? 'all'] as const,
  chat: (biteId: string) => ['chat', biteId] as const,
}

export const useEnrollments = () => useQuery({ queryKey: keys.enrollments, queryFn: api.enrollments })
export const useDashboard = () => useQuery({ queryKey: keys.dashboard, queryFn: api.dashboard })
export const useEnrollment = (topicId: string) => useQuery({ queryKey: keys.enrollment(topicId), queryFn: () => api.enrollment(topicId) })
export const useNextStep = (topicId: string, enabled = true) =>
  useQuery({ queryKey: keys.next(topicId), queryFn: () => api.next(topicId), enabled })
export const useDueReviews = (topicId?: string) => useQuery({ queryKey: keys.dueReviews(topicId), queryFn: () => api.dueReviews(topicId) })
export const useChatHistory = (biteId: string) => useQuery({ queryKey: keys.chat(biteId), queryFn: () => api.chatHistory(biteId) })

/** A bite may be generated on first open (up to a minute) — never auto-retry that request. */
export const useBite = (biteId: string) =>
  useQuery({ queryKey: keys.bite(biteId), queryFn: () => api.bite(biteId), retry: false, staleTime: 30_000 })

export function useEnroll() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: EnrollRequest) => api.enroll(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.enrollments })
      void queryClient.invalidateQueries({ queryKey: keys.dashboard })
    },
  })
}

/** Progress changes (answers, ratings, attempts) touch several views at once. */
export function useInvalidateProgress() {
  const queryClient = useQueryClient()
  return (biteId?: string) => {
    if (biteId) void queryClient.invalidateQueries({ queryKey: keys.bite(biteId) })
    for (const key of [['enrollments'], ['dashboard'], ['enrollment'], ['next'], ['dueReviews']]) {
      void queryClient.invalidateQueries({ queryKey: key })
    }
  }
}
