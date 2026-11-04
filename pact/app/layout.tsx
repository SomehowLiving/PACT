import { Providers } from "@/components/Providers";
import { Shell } from "@/components/Shell";
import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Serif, Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif",
});

const ibm = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ibm",
});

export const metadata: Metadata = {
  title: "pact — policy-aware copy",
  description:
    "Copy one leader’s Flash TWAP on Base. Follower signs. Policy can still BLOCK.",
  icons: { icon: "/mark.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${serif.variable} ${ibm.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
