import { createFileRoute } from "@tanstack/react-router";
import LandingHeader from "@/components/landing/LandingHeader";
import Hero from "@/components/landing/Hero";
import Features from "@/components/landing/Features";
import Pricing from "@/components/landing/Pricing";
import LandingFooter from "@/components/landing/LandingFooter";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Orqacel — Clients, quotations and jobs for service businesses" },
      {
        name: "description",
        content:
          "Orqacel is the workspace for freelancers and small service businesses: manage clients, create quotations with line items and track jobs — in 11 languages.",
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-dvh bg-background">
      <LandingHeader />
      <main>
        <Hero />
        <Features />
        <Pricing />
      </main>
      <LandingFooter />
    </div>
  );
}