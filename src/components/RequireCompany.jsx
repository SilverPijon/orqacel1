import React from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useSession } from "@/lib/SessionContext";

export default function RequireCompany({ children }) {
  const { isLoading, activeCompany } = useSession();
  const location = useLocation();
  const navigate = useNavigate();

  React.useEffect(() => {
    if (!isLoading && !activeCompany && location.pathname !== "/onboarding") {
      navigate({ to: "/onboarding" });
    }
  }, [isLoading, activeCompany, location.pathname, navigate]);

  if (isLoading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!activeCompany && location.pathname !== "/onboarding") return null;

  return children;
}