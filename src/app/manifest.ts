import type { MetadataRoute } from 'next';
import branding from '../../branding.json';
export default function manifest(): MetadataRoute.Manifest { return { name: branding.logoText, short_name: branding.logoText, description: 'Una app ficticia de Esteban para probar Constructor', start_url: '/', display: 'standalone', background_color: branding.backgroundColor, theme_color: branding.primaryColor, lang: 'es', icons: [{src:'/icon-192.png', sizes:'192x192', type:'image/png'}, {src:'/icon-512.png', sizes:'512x512', type:'image/png'}] }; }
