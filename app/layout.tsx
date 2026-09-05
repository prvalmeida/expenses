import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Expenses App",
  description: "Controle de despesas e receitas pessoais",
};

// viewportFit: 'cover' is required for the env(safe-area-inset-*) padding the
// shell uses; maximumScale is deliberately left unset so pinch-zoom keeps working.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f9fafb",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The font variables belong on <html>: Tailwind's @theme resolves
    // --font-sans from --font-geist-sans at :root, so declaring them any lower
    // leaves --font-sans referencing an undefined variable and makes every
    // font-family that uses it invalid at computed-value time.
    <html lang="pt-BR" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
