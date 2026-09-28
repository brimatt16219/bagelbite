import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { setTokenProvider } from '../../lib/api'
import { env } from '../../lib/env'
import { AuthContext, type AuthState, type AuthUser } from './auth-context'

const DEV_USER_KEY = 'bagelbite.devUser'

function readDevUser(): string | null {
  try {
    return localStorage.getItem(DEV_USER_KEY)
  } catch {
    return null
  }
}

const devUser = (name: string): AuthUser => ({ uid: `dev-${name}`, displayName: `Dev ${name}`, email: `${name}@dev.local`, photoURL: null })

// Dev mode: register the token provider at module load — child components' queries can fire
// before this provider's effects run.
let devSession: string | null = env.authMode === 'dev' ? readDevUser() : null
if (env.authMode === 'dev') setTokenProvider(async () => (devSession ? `dev:${devSession}` : null))

/**
 * Firebase Auth (Google sign-in) in normal builds. With VITE_AUTH_MODE=dev (local development
 * against an API running AUTH_MODE=dev), a labelled dev sign-in sends `dev:<name>` tokens instead.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<AuthState['status']>(() =>
    env.authMode === 'dev' ? (readDevUser() ? 'signedIn' : 'signedOut') : 'loading',
  )
  const [user, setUser] = useState<AuthUser | null>(() => {
    const name = env.authMode === 'dev' ? readDevUser() : null
    return name ? devUser(name) : null
  })
  const [configError, setConfigError] = useState<string | null>(null)

  useEffect(() => {
    if (env.authMode === 'dev') return
    let unsubscribe = () => {}
    let cancelled = false
    void import('../../lib/firebase').then(({ getFirebaseAuth, onAuthStateChanged }) => {
      if (cancelled) return
      let auth: ReturnType<typeof getFirebaseAuth>
      try {
        auth = getFirebaseAuth()
      } catch (err) {
        setConfigError(err instanceof Error ? err.message : 'Sign-in is not configured.')
        setStatus('signedOut')
        return
      }
      setTokenProvider(async () => (auth.currentUser ? auth.currentUser.getIdToken() : null))
      unsubscribe = onAuthStateChanged(auth, (fbUser) => {
        setUser(
          fbUser
            ? { uid: fbUser.uid, displayName: fbUser.displayName ?? '', email: fbUser.email ?? '', photoURL: fbUser.photoURL }
            : null,
        )
        setStatus(fbUser ? 'signedIn' : 'signedOut')
      })
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const signInWithGoogle = useCallback(async () => {
    const { getFirebaseAuth, signInWithPopup, GoogleAuthProvider } = await import('../../lib/firebase')
    await signInWithPopup(getFirebaseAuth(), new GoogleAuthProvider())
  }, [])

  const signInAsDev = useCallback((name: string) => {
    const clean = name.trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'learner'
    try {
      localStorage.setItem(DEV_USER_KEY, clean)
    } catch {
      // storage unavailable — the in-memory state below still signs in for this tab
    }
    devSession = clean
    setUser(devUser(clean))
    setStatus('signedIn')
  }, [])

  const signOut = useCallback(async () => {
    if (env.authMode === 'dev') {
      try {
        localStorage.removeItem(DEV_USER_KEY)
      } catch {
        // ignore
      }
      devSession = null
      setUser(null)
      setStatus('signedOut')
    } else {
      const { getFirebaseAuth } = await import('../../lib/firebase')
      await getFirebaseAuth().signOut()
    }
    queryClient.clear()
  }, [queryClient])

  const value = useMemo<AuthState>(
    () => ({ status, user, mode: env.authMode, configError, signInWithGoogle, signInAsDev, signOut }),
    [status, user, configError, signInWithGoogle, signInAsDev, signOut],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
