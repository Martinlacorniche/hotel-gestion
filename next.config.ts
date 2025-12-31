import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Garde ça si tu veux que le build continue même avec des erreurs TS
    ignoreBuildErrors: true, 
  },
  // Le bloc "eslint" a été supprimé car il est interdit ici en Next.js 16
};

export default nextConfig;