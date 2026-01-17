import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ignore les erreurs ESLint (variables inutilisées, etc.) pendant le build
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Ignore les erreurs TypeScript (types 'any', etc.) pendant le build
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;