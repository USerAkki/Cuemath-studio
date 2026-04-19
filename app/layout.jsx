import "./globals.css";

export const metadata = {
  title:       "Cuemath Social Studio",
  description: "AI-powered social media carousel creator for Cuemath content teams",
  robots:      "noindex, nofollow", // Private internal tool
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
