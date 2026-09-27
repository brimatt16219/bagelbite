import { createBrowserRouter } from 'react-router-dom'
import { AppLayout } from '../App'
import HomePage from '../features/topics/HomePage'
import DashboardPage from '../features/topics/DashboardPage'
import TopicPage from '../features/topics/TopicPage'
import BitePage from '../features/bites/BitePage'
import ReviewsPage from '../features/reviews/ReviewsPage'
import NotFoundPage from '../features/NotFoundPage'

// `/graph` (topic graph) is v1-deferred — see vault MVP-Synthesis flag 3.
export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/dashboard', element: <DashboardPage /> },
      { path: '/reviews', element: <ReviewsPage /> },
      { path: '/topics/:topicId', element: <TopicPage /> },
      { path: '/topics/:topicId/bites/:biteId', element: <BitePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
