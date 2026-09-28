import { createContext, useContext } from 'react'

export interface AuthUser {
  uid: string
  displayName: string
  email: string
  photoURL: string | null
}

export interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn'
  user: AuthUser | null
  mode: 'firebase' | 'dev'
  /** Set when sign-in can't work at all (e.g. Firebase env vars missing). */
  configError: string | null
  signInWithGoogle: () => Promise<void>
  signInAsDev: (name: string) => void
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
