import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NotesWorkspace } from '@/components/notes/workspace';
// Constructor: server-rendered website settings
import constructorWebsiteSettings from "../../../public/constructor-settings.json";
type constructorWebsiteSettingsMetadataValue<T> = Omit<NonNullable<T>, 'title' | 'description'> & { title: string; description: string };
function constructorWebsiteSettingsMetadata<T extends object | null | undefined>(value: PromiseLike<T>): Promise<constructorWebsiteSettingsMetadataValue<T>>;
function constructorWebsiteSettingsMetadata<T extends object | null | undefined>(value: T): constructorWebsiteSettingsMetadataValue<T>;
function constructorWebsiteSettingsMetadata(value: object | null | undefined | PromiseLike<object>): object | Promise<object> {
  if (value && 'then' in value && typeof value.then === 'function') return Promise.resolve(value).then(original => constructorWebsiteSettingsMetadata(original));
  return { ...value, title: constructorWebsiteSettings.title, description: constructorWebsiteSettings.description };
}


export const metadata: Metadata = constructorWebsiteSettingsMetadata(({ title: 'Notas | Notas de Bolsillo', description: 'Lista y editor de notas de tu sesión.' }));
export default function NotesPage() { return <Suspense fallback={<main className="shell loading-page" role="status">Cargando tus notas…</main>}><NotesWorkspace/></Suspense>; }
