import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AuthGateError, requireSignedIn } from "@/components/auth/AuthGate";
import { SessionProvider } from "@/lib/SessionContext";
import AppShell from "@/components/AppShell";

export const Route = createFileRoute("/_authed")({
  ssr: false,
  beforeLoad: requireSignedIn,
  errorComponent: AuthGateError,
  component: AuthedLayout,
});

function AuthedLayout() {
  return (
    <SessionProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </SessionProvider>
  );
}