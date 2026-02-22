import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Maine BMV Real ID Slots",
  description:
    "Live tracker for Maine BMV Driver's License & Real ID appointment availability. Find short-notice slots fast.",
  openGraph: {
    title: "Maine BMV Real ID Slots",
    description: "Live tracker for Maine BMV Real ID appointments.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
