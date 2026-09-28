/** Build-time configuration (Vite `VITE_*` env vars). See README → Environment variables. */
export const env = {
  apiUrl: (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:8080',
  /** 'dev' enables the local dev sign-in (pairs with the API's AUTH_MODE=dev). */
  authMode: (import.meta.env.VITE_AUTH_MODE as string | undefined) === 'dev' ? ('dev' as const) : ('firebase' as const),
  firebase: {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
    appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  },
}
