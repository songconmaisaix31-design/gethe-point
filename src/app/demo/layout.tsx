import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "都记得 · Fixture Demo",
  description: "同意优先的家庭责任四分钟演示。",
};

export default function DemoLayout({ children }: { readonly children: ReactNode }) {
  return children;
}
