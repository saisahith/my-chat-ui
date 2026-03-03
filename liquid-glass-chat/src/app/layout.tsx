import "./globals.css";

export const metadata = {
  title: "Liquid Glass Chat",
  description: "Streaming chat demo with Liquid Glass UI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}