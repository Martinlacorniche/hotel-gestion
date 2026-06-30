import type { MetadataRoute } from 'next';

// Outil interne : aucun moteur de recherche ne doit indexer l'app.
// Double protection avec le `metadata.robots` (noindex) du layout racine.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: '/',
    },
  };
}
