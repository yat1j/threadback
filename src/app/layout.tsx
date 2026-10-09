import "./globals.css";
export const metadata = {
  title: "Threadback — Catch up on what matters",
  description: "Turn exported WhatsApp conversations into a catch-up briefing. Your chat stays on your device.",
  applicationName: "Threadback",
  robots: { index: true, follow: true },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><head><link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous"/><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;700;800;900&display=swap" /></head><body>{children}</body></html>;
}
