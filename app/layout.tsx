import type { Metadata } from "next";
import "./globals.css";
import { absoluteSiteUrl } from "./site-url";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://rotorbench-lab.naoyamd.chatgpt.site";
const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Engineering Design Benchmark Framework", template: "%s" },
  description: "A live-verified engineering design benchmark for comparing LLM robot-arm and powered-gripper design capability.",
  applicationName: "Engineering Design Benchmark Framework",
  keywords: ["engineering design", "benchmark framework", "CAD", "STEP", "static evidence"],
  openGraph: {
    title: "Engineering Design Benchmark Framework",
    description: "Compare LLM engineering design through one fixed robot-arm and powered-gripper task, immutable process evidence, and multidimensional evaluation.",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: absoluteSiteUrl("engineering-benchmark-og.png"),
        width: 1728,
        height: 910,
        alt: "Industrial robot arm and powered gripper under CAD, load, and manufacturing review",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Engineering Design Benchmark Framework",
    description: "One fixed engineering task, staged evidence, and multidimensional evaluation for LLM mechanical-system design.",
    images: [absoluteSiteUrl("engineering-benchmark-og.png")],
  },
  icons: { icon: `${publicBasePath}/favicon.svg`, shortcut: `${publicBasePath}/favicon.svg` },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
