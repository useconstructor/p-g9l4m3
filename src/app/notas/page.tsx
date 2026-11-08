import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NotesWorkspace } from '@/components/notes/workspace';
export const metadata: Metadata = { title: 'Notas | Notas de Bolsillo', description: 'Lista y editor de notas de tu sesión.' };
export default function NotesPage() { return <Suspense fallback={<main className="shell loading-page" role="status">Cargando tus notas…</main>}><NotesWorkspace/></Suspense>; }
