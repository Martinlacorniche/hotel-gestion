import { supabase } from '@/lib/supabaseClient';

/**
 * Téléversement de photos vers un bucket public Supabase.
 *
 * Le motif existait déjà, recopié à la main dans `clim/page.tsx` : upload,
 * URL publique, et le chemin qu'il faut savoir reconstruire pour nettoyer le
 * storage à la suppression. Le sortir ici évite qu'une troisième copie parte
 * en dérive — la maintenance, l'app mobile et la clim écrivent au même endroit.
 */

/** Chemin dans le bucket à partir de l'URL publique. `null` si l'URL vient d'ailleurs. */
export function pathFromPublicUrl(url: string, bucket: string): string | null {
  const marker = `/object/public/${bucket}/`;
  const i = url.indexOf(marker);
  return i === -1 ? null : url.slice(i + marker.length);
}

/**
 * Téléverse et renvoie les URL publiques.
 *
 * Une photo qui échoue ne fait pas échouer les autres : on rend ce qui est
 * passé et la liste des refus, à l'appelant d'en faire un message. Perdre les
 * trois photos parce que la deuxième dépasse la taille serait une punition.
 */
export async function uploadPhotos(
  bucket: string,
  prefix: string,
  files: File[],
): Promise<{ urls: string[]; erreurs: string[] }> {
  const urls: string[] = [];
  const erreurs: string[] = [];
  for (const file of files) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${prefix}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });
    if (error) {
      erreurs.push(`${file.name} : ${error.message}`);
      continue;
    }
    urls.push(supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl);
  }
  return { urls, erreurs };
}

/** Supprime du storage les fichiers derrière ces URL. Best-effort : une photo
 *  orpheline coûte moins cher qu'une suppression bloquée. */
export async function removePhotos(bucket: string, urls: string[]): Promise<void> {
  const paths = urls.map(u => pathFromPublicUrl(u, bucket)).filter(Boolean) as string[];
  if (paths.length) await supabase.storage.from(bucket).remove(paths);
}
