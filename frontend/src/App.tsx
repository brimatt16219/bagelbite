import { NavLink, Outlet } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { cn } from './lib/cn'
import { useAuth } from './features/auth/auth-context'
import { SignInScreen } from './features/auth/SignInScreen'
import { IconButton } from './components/ui/Button'
import { useDashboard } from './lib/queries'

export function AppLayout() {
  const auth = useAuth()
  if (auth.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center" aria-busy>
        <BagelMark className="h-10 w-10 animate-pulse" />
      </div>
    )
  }
  if (auth.status === 'signedOut') return <SignInScreen />
  return <SignedInLayout />
}

function SignedInLayout() {
  const auth = useAuth()
  const dashboard = useDashboard()
  const due = dashboard.data?.dueReviewCount ?? 0
  const navItems = [
    { to: '/', label: 'Learn', end: true, badge: 0 },
    { to: '/reviews', label: 'Reviews', end: false, badge: due },
    { to: '/dashboard', label: 'Progress', end: false, badge: 0 },
  ]

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <NavLink to="/" className="flex items-center gap-2 text-lg font-semibold text-text">
          <BagelMark />
          Bagelbite
        </NavLink>
        <div className="flex items-center gap-3">
          <nav aria-label="Main" className="flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors',
                    isActive ? 'bg-surface font-medium text-text' : 'text-text-muted hover:text-text',
                  )
                }
              >
                {item.label}
                {item.badge ? (
                  <span className="rounded-full bg-accent px-1.5 text-xs font-semibold text-text" aria-label={`${item.badge} due`}>
                    {item.badge}
                  </span>
                ) : null}
              </NavLink>
            ))}
          </nav>
          <span className="text-sm text-text-muted" title={auth.user?.email}>
            {auth.user?.displayName || auth.user?.email}
          </span>
          <IconButton label="Sign out" onClick={() => void auth.signOut()}>
            <LogOut className="h-4 w-4" aria-hidden />
          </IconButton>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 pb-16">
        <Outlet />
      </main>
    </div>
  )
}

export function BagelMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('h-7 w-7', className)} aria-hidden>
      <circle cx="16" cy="16" r="12" fill="#e39a5c" />
      <circle cx="16" cy="16" r="4.5" fill="#fdf6ee" />
      <path d="M9 12.5l1.5-.8M20.5 9.5l1.4.6M22.5 18l.9 1.2M11.5 21.5l1.2.9M15.5 7.8l1.2-.2" stroke="#fdf6ee" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}
