"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { isInTelegram } from "@/lib/telegram";
import { LaunchScreen } from "@/components/ui/Spinner";

export default function RootPage() {
  const router = useRouter();
  const { user, loading, isAdmin } = useAuth();

  useEffect(() => {
    if (loading) return;

    if (isInTelegram()) {
      router.replace("/shop");
    } else if (user && isAdmin) {
      router.replace("/dashboard");
    } else {
      router.replace("/login");
    }
  }, [user, loading, isAdmin, router]);

  return <LaunchScreen />;
}
