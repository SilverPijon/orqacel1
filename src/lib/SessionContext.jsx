import React, { createContext, useCallback, useContext, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getSession } from "@/lib/tenant-fns";
import { useAuth } from "@/lib/AuthContext";

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const queryClient = useQueryClient();
  const fetchSession = useServerFn(getSession);

  const query = useQuery({
    queryKey: ["session"],
    queryFn: () => fetchSession(),
    enabled: isAuthenticated && !isLoadingAuth,
    staleTime: 30_000,
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries();
  }, [queryClient]);

  const value = useMemo(() => {
    const session = query.data ?? null;
    return {
      session,
      companies: session?.companies ?? [],
      activeCompany: session?.activeCompany ?? null,
      permissions: session?.permissions ?? { canManage: false, isOwner: false },
      user: session?.user ?? null,
      isLoading: isLoadingAuth || query.isLoading,
      error: query.error ?? null,
      refresh,
    };
  }, [query.data, query.isLoading, query.error, isLoadingAuth, refresh]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}