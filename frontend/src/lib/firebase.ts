/** Firebase Auth (Google sign-in) — loaded lazily so dev-mode builds never touch Firebase. */
import { getApps, initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, type Auth } from 'firebase/auth'
import { env } from './env'

let auth: Auth | null = null

export function getFirebaseAuth(): Auth {
  if (!auth) {
    const { apiKey, authDomain, projectId, appId } = env.firebase
    if (!apiKey || !authDomain || !projectId) {
      throw new Error('Firebase is not configured: set VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN and VITE_FIREBASE_PROJECT_ID.')
    }
    const app = getApps()[0] ?? initializeApp({ apiKey, authDomain, projectId, appId })
    auth = getAuth(app)
  }
  return auth
}

export { GoogleAuthProvider, onAuthStateChanged, signInWithPopup }
