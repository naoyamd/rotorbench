import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://rotorbench-lab.naoyamd.chatgpt.site";
const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Engineering Design Benchmark Framework", template: "%s" },
  description: "A static, task-neutral framework for publishing engineering design benchmark evidence.",
  applicationName: "Engineering Design Benchmark Framework",
  keywords: ["engineering design", "benchmark framework", "CAD", "STEP", "static evidence"],
  openGraph: {
    title: "Engineering Design Benchmark Framework",
    description: "A static, task-neutral framework for future engineering design benchmark evidence.",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: `${publicBasePath}/og-stage0.png`,
        width: 1728,
        height: 909,
        alt: "Engineering Design Benchmark — Prepare, Design, Publish",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Engineering Design Benchmark Framework",
    description: "A static, task-neutral framework for future engineering design benchmark evidence.",
    images: [`${publicBasePath}/og-stage0.png`],
  },
  icons: { icon: `${publicBasePath}/favicon.svg`, shortcut: `${publicBasePath}/favicon.svg` },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
