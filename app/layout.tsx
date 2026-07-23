import type { Metadata } from "next";
import "./globals.css";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://rotorbench.pages.dev";
const publicBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "RotorBench",
  description:
    "LLMが実装した可変ピッチ・ローターデモを、同じ入力条件で比較するローカルファーストのベンチマーク。",
  applicationName: "RotorBench",
  keywords: [
    "LLM benchmark",
    "helicopter",
    "variable pitch",
    "swashplate",
    "GitHub Pages",
  ],
  openGraph: {
    title: "RotorBench | 同じ入力で、実装の差を見る。",
    description:
      "可変ピッチ・ローター実装を同期A/B比較するLLMベンチマーク。",
    type: "website",
    locale: "ja_JP",
    images: [
      {
        url: "/og.png",
        width: 1536,
        height: 1024,
        alt: "RotorBench 可変ピッチ・ローター A/B ベンチマーク",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "RotorBench | 同じ入力で、実装の差を見る。",
    description:
      "可変ピッチ・ローター実装を同期A/B比較するLLMベンチマーク。",
    images: ["/og.png"],
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
