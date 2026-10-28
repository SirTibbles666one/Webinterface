import { Routes, Route } from 'react-router-dom'
import Login from './components/Login'
import AuthorizedLayout from './components/AuthorizedLayout'
import Admin from '@/pages/Admin'
import NotFound from '@/pages/NotFound'
import Toaster from '@/components/Toaster'
import Settings from '@/pages/Settings'
import ResetPassword from './components/ResetPassword'
import RecoverAccount from './components/RecoverAccount'
import ProtectedRoute from './components/ProtectedRoute'

function App() {
  return (
    <>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/setup" element={<Login />} />
      <Route path="/reset" element={<ResetPassword />} />
      <Route path="/recover" element={<RecoverAccount />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AuthorizedLayout />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={<Settings />}
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <Admin />
          </ProtectedRoute>
        }
      />
          <Route path="*" element={<NotFound />} />
</Routes>
      <Toaster />
    </>
  )
}

export default App
