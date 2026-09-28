import { useState, type FormEvent } from 'react'
import { BagelMark } from '../../App'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { TextInput } from '../../components/ui/TextInput'
import { ErrorNotice } from '../../components/ui/feedback'
import { useAuth } from './auth-context'

export function SignInScreen() {
  const { mode, configError, signInWithGoogle, signInAsDev } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [devName, setDevName] = useState('')

  const google = async () => {
    setBusy(true)
    setError(null)
    try {
      await signInWithGoogle()
    } catch {
      setError("Couldn't sign in with Google. Try again.")
    } finally {
      setBusy(false)
    }
  }

  const dev = (e: FormEvent) => {
    e.preventDefault()
    signInAsDev(devName)
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-sm text-center">
        <BagelMark className="mx-auto h-12 w-12" />
        <h1 className="mt-3 text-xl font-semibold">Bagelbite</h1>
        <p className="mt-1 text-sm text-text-muted">Learn programming topics in small, spaced bites that actually stick.</p>

        {mode === 'firebase' ? (
          <div className="mt-6 space-y-3">
            {configError ? <ErrorNotice message={configError} /> : null}
            <Button variant="primary" className="w-full" onClick={google} loading={busy} disabled={Boolean(configError)}>
              Continue with Google
            </Button>
          </div>
        ) : (
          <form onSubmit={dev} className="mt-6 space-y-3 text-left">
            <p className="rounded-control bg-surface-muted px-3 py-2 text-xs text-text-muted">
              Development sign-in: no password, local use only. Production builds use Google sign-in.
            </p>
            <label className="block text-sm font-medium" htmlFor="dev-name">
              Name
            </label>
            <TextInput id="dev-name" value={devName} onChange={(e) => setDevName(e.target.value)} placeholder="e.g. brian" autoFocus />
            <Button type="submit" variant="primary" className="w-full">
              Continue as dev user
            </Button>
          </form>
        )}
        {error ? <ErrorNotice message={error} className="mt-3 text-left" /> : null}
      </Card>
    </div>
  )
}
