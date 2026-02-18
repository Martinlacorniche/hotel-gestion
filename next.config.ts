import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Note : Le bloc 'eslint' a été retiré car il n'est plus supporté 
     directement ici dans les dernières versions de Next.js.
  */
  
  // On garde TypeScript si tu as vraiment besoin d'ignorer les erreurs au build
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;