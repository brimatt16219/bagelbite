import type { Config } from '../config'

export interface AuthIdentity {
  uid: string
  email: string
  displayName: string
  photoUrl: string
}

/** Turns a bearer token into an identity, or throws if the token is invalid/expired. */
export interface TokenVerifier {
  verify(token: string): Promise<AuthIdentity>
}

export class InvalidTokenError extends Error {}

/**
 * Local-development only (refused in production by config): accepts `dev:<uid>` so the app can run
 * end to end without a Firebase project. Never enable against real user data.
 */
export class DevTokenVerifier implements TokenVerifier {
  async verify(token: string): Promise<AuthIdentity> {
    const match = /^dev:([A-Za-z0-9_-]{1,64})$/.exec(token)
    if (!match) throw new InvalidTokenError('Malformed dev token')
    const uid = match[1]
    return { uid: `dev-${uid}`, email: `${uid}@dev.local`, displayName: `Dev ${uid}`, photoUrl: '' }
  }
}

/** Firebase Admin `verifyIdToken` — the same pattern as Voyager (Architecture.md). */
export class FirebaseTokenVerifier implements TokenVerifier {
  private constructor(private readonly verifyIdToken: (token: string) => Promise<Record<string, unknown>>) {}

  static async create(config: Config): Promise<FirebaseTokenVerifier> {
    const { initializeApp, getApps, cert, applicationDefault } = await import('firebase-admin/app')
    const { getAuth } = await import('firebase-admin/auth')
    const app =
      getApps()[0] ??
      initializeApp({
        projectId: config.FIREBASE_PROJECT_ID,
        credential: config.FIREBASE_SERVICE_ACCOUNT_JSON
          ? cert(parseServiceAccount(config.FIREBASE_SERVICE_ACCOUNT_JSON))
          : applicationDefault(),
      })
    const auth = getAuth(app)
    return new FirebaseTokenVerifier((token) => auth.verifyIdToken(token) as unknown as Promise<Record<string, unknown>>)
  }

  async verify(token: string): Promise<AuthIdentity> {
    let decoded: Record<string, unknown>
    try {
      decoded = await this.verifyIdToken(token)
    } catch {
      throw new InvalidTokenError('Firebase rejected the ID token')
    }
    const uid = String(decoded.uid ?? '')
    if (!uid) throw new InvalidTokenError('Token has no uid')
    return {
      uid,
      email: typeof decoded.email === 'string' ? decoded.email : '',
      displayName: typeof decoded.name === 'string' ? decoded.name : '',
      photoUrl: typeof decoded.picture === 'string' ? decoded.picture : '',
    }
  }
}

function parseServiceAccount(raw: string): Record<string, string> {
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
  return JSON.parse(text)
}
