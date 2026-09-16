import type { Metadata } from "next";
import { Figtree, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Ambient } from "@/components/ambient";

/**
 * The reference uses a proprietary grotesque (artlistSans) that can't be shipped.
 * Figtree is the closest free match: same geometric build, open apertures, and
 * it holds up at UI sizes.
 */
const sans = Figtree({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const mono = JetBrains_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "agentcut",
  description: "Short clips, cut by your coding agent. Local-first, no API keys.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <Ambient />
        {children}
      </body>
    </html>
  );
}
