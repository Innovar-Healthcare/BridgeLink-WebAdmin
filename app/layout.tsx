import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { InlineScript } from "@/components/inline-script";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "BridgeLink WebAdmin",
  description: "BridgeLink Web Administrator",
  icons: {
    icon: [{ url: "/bridgelink-icon.png", type: "image/png", sizes: "32x32" }],
    apple: "/bridgelink-icon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply dark class before first paint to prevent flash */}
        <InlineScript
          html={`(function(){try{var t=localStorage.getItem('bl-theme');if(t==='dark')document.documentElement.classList.add('dark')}catch(e){}})()`}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
