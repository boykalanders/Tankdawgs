import type { Metadata } from "next";
import { Providers } from "./providers";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import "./globals.css";

export const metadata: Metadata = {
  title: "TankDawgs — wagered artillery for Deputy Dawgs",
  description:
    "Stake $DDawgs, aim and fire. Turn-based artillery battles in the Deputy Dawgs ecosystem.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>
          <SiteHeader />
          <main className="mx-auto w-full max-w-7xl px-4 py-3">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
