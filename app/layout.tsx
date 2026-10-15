import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Daymark · Learning workspace",
  description: "Space for your studies, your projects, and what comes next.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
