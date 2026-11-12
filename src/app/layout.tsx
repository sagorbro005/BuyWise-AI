import type { Metadata } from 'next';
import './globals.css';
import './theme.css';
export const metadata: Metadata = { title: 'BuyWise — purchasing, with principles.', description: 'An AI purchasing workspace with explicit spending mandates, independent policy enforcement, and PayPal sandbox checkout.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Apply a saved preference before the first paint. CSS follows the system
  // preference when storage is unavailable or the user has never chosen one.
  const restoreTheme = `try{const t=localStorage.getItem('buywise-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch{}`;
  return <html lang="en" suppressHydrationWarning><head><script>{restoreTheme}</script></head><body suppressHydrationWarning>{children}</body></html>;
}
