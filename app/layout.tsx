import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import "./globals.css";

const sans = IBM_Plex_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400"],
});

export const metadata: Metadata = {
  title: "CareOS",
  description: "Care handoffs that don't get dropped.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        {/* Grey accent on purpose. Red is spent on one thing only — see globals.css.
            Solid panels, not translucent: the page is already near-white, so a
            translucent card lands on top of it invisibly. */}
        <Theme
          appearance="light"
          accentColor="gray"
          grayColor="slate"
          radius="small"
          panelBackground="solid"
        >
          {children}
        </Theme>
      </body>
    </html>
  );
}
