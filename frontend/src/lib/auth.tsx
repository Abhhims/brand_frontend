"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { API_ENABLED, api, session, type User } from "@/lib/api"

/** Signed-in user while the backend is off (API_ENABLED=false), so every page opens without a login. */
const DEMO_USER: User = {
  id: "demo",
  email: "demo@example.com",
  name: "Demo Analyst",
  role: "admin",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
}

interface AuthState {
  /** undefined while reading storage on first client render */
  user: User | null | undefined
  isAdmin: boolean
  login: (email: string, password: string) => Promise<User>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb)
  return () => window.removeEventListener("storage", cb)
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  // Hydration-safe read of the stored session: null on the server, the stored value on the client.
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
  const [override, setOverride] = useState<User | null | undefined>(undefined)
  const user = !API_ENABLED
    ? DEMO_USER
    : !hydrated
      ? undefined
      : override !== undefined
        ? override
        : session.token()
          ? session.user()
          : null

  // Refresh the profile once per load so role/active changes take effect; a 401 logs out via the API client.
  useEffect(() => {
    if (!API_ENABLED || !hydrated || !session.token()) return
    let cancelled = false
    api
      .me()
      .then((me) => {
        if (cancelled) return
        const token = session.token()
        if (token) session.save(token, me)
        setOverride(me)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [hydrated])

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password)
    session.save(res.access_token, res.user)
    setOverride(res.user)
    return res.user
  }, [])

  const logout = useCallback(() => {
    session.clear()
    setOverride(null)
    queryClient.clear()
  }, [queryClient])

  const value = useMemo<AuthState>(
    () => ({ user, isAdmin: user?.role === "admin", login, logout }),
    [user, login, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider")
  return ctx
}
