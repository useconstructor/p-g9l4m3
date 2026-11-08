import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import localFont from 'next/font/local';
import branding from '../../branding.json';
import './globals.css';
import { localBrandFaces } from '@/lib/brand-assets';
import { TooltipProvider } from '@/components/ui/tooltip';
import { NotesProvider } from '@/components/notes/provider';
import { Header, Footer, FragmentFocus, BrandFonts } from '@/components/notes/shell';
const plex = localFont({ src: [{ path: '../../public/fonts/ibm-plex-sans-latin.woff2', weight: '400 700', style: 'normal' }], variable: '--font-plex-local', display: 'swap', preload: true });
export const metadata: Metadata = { title: 'Inicio | Notas de Bolsillo', description: 'Una app ficticia de Esteban para probar Constructor', icons: { icon: [{ url: '/icon.svg', type: 'image/svg+xml' }, {url:'/icon-32.png',sizes:'32x32',type:'image/png'}], apple: [{url:'/icon-180.png',sizes:'180x180',type:'image/png'}] }, manifest: '/manifest.webmanifest' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const styles = { '--brand-background': branding.backgroundColor, '--brand-surface': branding.secondaryColor, '--brand-primary': branding.primaryColor, '--brand-accent': branding.accentColor, '--brand-text': branding.textColor, '--brand-font-heading': `"${branding.fontHeading}", var(--font-plex-local), sans-serif`, '--brand-font-body': `"${branding.fontBody}", var(--font-plex-local), sans-serif` } as CSSProperties;
  const faces = branding.brandbook.fontFaces.map(face => `@font-face{font-family:${JSON.stringify(face.family)};font-style:normal;font-weight:${face.weight};font-display:swap;src:url(${JSON.stringify(localBrandFaces[face.url] ?? face.url)})}`).join('\n');
  const api = process.env.NEXT_PUBLIC_CONSTRUCTOR_API?.replace(/\/$/, ''); const project = process.env.NEXT_PUBLIC_PROJECT_ID;
  const collector = api && project ? `${api}/v1/projects/${project}/analytics/script.js` : 'https://constructor-api-git-dev-useconstructor.vercel.app/v1/projects/P-G9L4M3/analytics/script.js';
  return <html lang="es" className={plex.variable} style={styles}><head><style>{faces}</style></head><body><TooltipProvider><NotesProvider><BrandFonts/><Header/><FragmentFocus/>{children}<Footer/></NotesProvider></TooltipProvider><script src={"https://constructor-api-git-dev-useconstructor.vercel.app/v1/projects/P-G9L4M3/analytics/script.js"} defer></script><script src="/constructor-editor.js" defer/><script src="/constructor-brand-identity.js" defer></script></body></html>;
}
