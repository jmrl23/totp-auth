import type { Metadata, Viewport } from "next";
import { Inter_Tight } from "next/font/google";
import { QueryProvider } from "@/lib/client";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CspNonce } from "@/components/common/csp-nonce";
import "./globals.css";

const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "totp-auth", template: "%s - totp-auth" },
  description: "Your self-hosted two-factor codes, encrypted in your browser.",
  applicationName: "totp-auth",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
  formatDetection: { telephone: false, email: false, address: false },
  appleWebApp: { capable: true, title: "totp-auth", statusBarStyle: "black" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#111111" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${interTight.variable} h-full`}>
      <body className="min-h-full">
        <CspNonce />
        <QueryProvider>
          <TooltipProvider delayDuration={400}>
            {children}
            <Toaster position="bottom-center" />
          </TooltipProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
