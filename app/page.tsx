import type { Metadata } from "next";
import { RotorBench } from "./rotor-bench";

export const metadata: Metadata = {
  title: "RotorBench | 可変ピッチ機構ベンチマーク",
  description:
    "ヘリコプターのメインローター機構を、同期した単体・A/B表示で比較評価するインタラクティブ技術デモ。",
};

export default function Home() {
  return <RotorBench />;
}
