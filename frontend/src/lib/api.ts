import type {
  ApiErrorBody,
  AttemptRequest,
  AttemptResult,
  BiteDto,
  ChatMessageDto,
  DashboardDto,
  DueReviewsResponse,
  EnrollRequest,
  EnrollResponse,
  EnrollmentDetail,
  EnrollmentSummary,
  FlagRequest,
  FlagResult,
  NextStep,
  RatingResult,
  RetrievalResponseRequest,
  RetrievalResponseResult,
  ReviewRating,
  RevealSolutionResult,
  UserDto,
} from '@shared/api'
import { env } from './env'

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

type TokenProvider = () => Promise<string | null>
let tokenProvider: TokenProvider = async () => null

/** Set by the AuthProvider so every request carries the current ID token. */
export function setTokenProvider(provider: TokenProvider) {
  tokenProvider = provider
}

export async function authHeaders(): Promise<Record<string, string>> {
  const token = await tokenProvider()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${env.apiUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: { ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(await authHeaders()) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, 'network_error', "Couldn't reach Bagelbite. Check your connection and try again.")
  }
  if (!res.ok) {
    let body: ApiErrorBody | null = null
    try {
      body = (await res.json()) as ApiErrorBody
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, body?.error.code ?? 'http_error', body?.error.message ?? 'Something went wrong. Try again.')
  }
  return (await res.json()) as T
}

export const api = {
  me: () => request<UserDto>('/users/me'),
  enroll: (body: EnrollRequest) => request<EnrollResponse>('/topics/enroll', { method: 'POST', body }),
  enrollments: () => request<EnrollmentSummary[]>('/users/me/enrollments'),
  enrollment: (topicId: string) => request<EnrollmentDetail>(`/topics/${topicId}/enrollment`),
  next: (topicId: string) => request<NextStep>(`/topics/${topicId}/next`),
  dashboard: () => request<DashboardDto>('/users/me/dashboard'),
  dueReviews: (topicId?: string) =>
    request<DueReviewsResponse>(`/users/me/reviews/due${topicId ? `?topicId=${encodeURIComponent(topicId)}` : ''}`),
  bite: (biteId: string) => request<BiteDto>(`/bites/${biteId}`),
  respond: (biteId: string, promptId: string, body: RetrievalResponseRequest) =>
    request<RetrievalResponseResult>(`/bites/${biteId}/retrieval-prompts/${promptId}/response`, { method: 'POST', body }),
  rate: (logId: string, rating: ReviewRating) => request<RatingResult>(`/review-logs/${logId}/rating`, { method: 'POST', body: { rating } }),
  attempt: (biteId: string, body: AttemptRequest) => request<AttemptResult>(`/bites/${biteId}/attempts`, { method: 'POST', body }),
  revealSolution: (biteId: string) => request<RevealSolutionResult>(`/bites/${biteId}/reveal-solution`, { method: 'POST' }),
  flag: (biteId: string, body: FlagRequest) => request<FlagResult>(`/bites/${biteId}/flag`, { method: 'POST', body }),
  chatHistory: (biteId: string) => request<ChatMessageDto[]>(`/bites/${biteId}/chat`),
}
