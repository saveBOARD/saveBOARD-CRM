import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import "./globals.css";

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: { default: "saveBOARD CRM", template: "%s · saveBOARD CRM" },
  description: "Enquiries, deals and follow-ups for saveBOARD NZ and AUS.",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "saveBOARD CRM", statusBarStyle: "default" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-NZ" className={`${roboto.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
