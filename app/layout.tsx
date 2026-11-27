import "./globals.css";
import { Inter, Inter_Tight } from "next/font/google";
import { THEME_INIT } from "@/utils/siteTheme";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
// Inter Tight is a variable font, so we don't pass an explicit `weight`
// array (that's only for static, non-variable fonts and is what was
// crashing the Vercel build). Specific weights (500/600/700/800) are
// still applied via Tailwind's font-weight classes wherever this
// typeface is used.
const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-inter-tight",
});

export const metadata = {
  title: "DevAudit — Your Code, Audited",
  description: "The command center for errors, pushes and post-mortems.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${interTight.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
