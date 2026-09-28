import { createBrowserRouter } from 'react-router-dom'
import { AppLayout } from '../App'
import HomePage from '../features/topics/HomePage'
import NotFoundPage from '../features/NotFoundPage'

// Pages load on demand — the bite page pulls in Sandpack, by far the heaviest dependency.
const page = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({ Component: (await load()).default })

// `/graph` (topic graph) is v1-deferred — see vault MVP-Synthesis flag 3.
export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/dashboard', lazy: page(() => import('../features/topics/DashboardPage')) },
      { path: '/reviews', lazy: page(() => import('../features/reviews/ReviewsPage')) },
      { path: '/topics/:topicId', lazy: page(() => import('../features/topics/TopicPage')) },
      { path: '/topics/:topicId/bites/:biteId', lazy: page(() => import('../features/bites/BitePage')) },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
