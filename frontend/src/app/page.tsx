"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/AuthProvider";
import { isInTelegram } from "@/lib/telegram";

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

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
      <div style={{ width: 32, height: 32, border: "3px solid var(--border)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
