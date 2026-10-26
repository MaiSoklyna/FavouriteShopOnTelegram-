import type { Metadata } from "next";
import { Manrope, Kantumruy_Pro } from "next/font/google";
import "./globals.css";
import "./tokens.css";
import { AuthProvider } from "@/providers/AuthProvider";
import { BrandSplash } from "@/components/brand/Splash";

// Design-handoff fonts, exposed as CSS variables for tailwind.tokens.ts (font-sans / font-khmer)
const manrope = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-manrope", display: "swap" });
const kantumruy = Kantumruy_Pro({ subsets: ["khmer", "latin"], weight: ["400", "500", "600", "700"], variable: "--font-kantumruy", display: "swap" });

export const metadata: Metadata = {
  title: "Byme24",
  description: "Byme24 — Your Favourite Shop",
  icons: { icon: "/brand/favicon.svg", apple: "/brand/app-icon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${manrope.variable} ${kantumruy.variable}`}>
      <head>
        {/* Inter + the literal 'Kantumruy Pro' family name are still used by screens not yet redesigned */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Kantumruy+Pro:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        {/* Telegram WebApp SDK */}
        <script src="https://telegram.org/js/telegram-web-app.js" />
        {/* Theme restoration before paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");if(t)document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        <BrandSplash />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
