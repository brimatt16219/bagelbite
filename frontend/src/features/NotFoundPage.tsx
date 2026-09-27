import { Link } from 'react-router-dom'
import { Card } from '../components/ui/Card'

export default function NotFoundPage() {
  return (
    <Card className="mx-auto mt-12 max-w-md text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-text-muted">That page doesn't exist. Head back to your topics.</p>
      <Link to="/" className="mt-4 inline-block text-sm font-medium text-accent-strong underline">
        Go to home
      </Link>
    </Card>
  )
}
