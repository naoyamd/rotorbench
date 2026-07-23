import type { Metadata } from "next";
import "./globals.css";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://rotorbench.pages.dev";
const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const socialImageUrl = `${siteUrl.replace(/\/$/, "")}/og.png`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "RotorBench",
  description:
    "同じ共通プロンプトから生まれた、モデル固有の独立Webページを収集・公開するアーカイブ。",
  applicationName: "RotorBench",
  keywords: [
    "LLM benchmark",
    "helicopter",
    "variable pitch",
    "swashplate",
    "GitHub Pages",
  ],
  openGraph: {
    title: "RotorBench | Model Output Archive",
    description:
      "同じ課題から生まれた、違う答えを並べる。",
    type: "website",
    locale: "ja_JP",
    images: [
      {
        url: socialImageUrl,
        width: 1672,
        height: 941,
        alt: "RotorBench Model Output Archive",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "RotorBench | Model Output Archive",
    description:
      "同じ課題から生まれた、違う答えを並べる。",
    images: [socialImageUrl],
  },
  icons: {
    icon: `${publicBasePath}/favicon.svg`,
    shortcut: `${publicBasePath}/favicon.svg`,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
