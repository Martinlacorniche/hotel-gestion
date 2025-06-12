import dynamic from "next/dynamic";

// Empêche Next.js de prérendre la page
export const dynamic = "force-dynamic";

const ClientPage = dynamic(() => import("./client-page"), { ssr: false });

export default function Page() {
  return <ClientPage />;
}
