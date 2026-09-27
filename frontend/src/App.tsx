import { NavLink, Outlet } from 'react-router-dom'
import { cn } from './lib/cn'

const navItems = [
  { to: '/', label: 'Learn', end: true },
  { to: '/reviews', label: 'Reviews', end: false },
  { to: '/dashboard', label: 'Progress', end: false },
]

export function AppLayout() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <NavLink to="/" className="flex items-center gap-2 text-lg font-semibold text-text">
          <BagelMark />
          Bagelbite
        </NavLink>
        <nav aria-label="Main" className="flex items-center gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'rounded-full px-3 py-1.5 text-sm transition-colors',
                  isActive ? 'bg-surface font-medium text-text' : 'text-text-muted hover:text-text',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
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
