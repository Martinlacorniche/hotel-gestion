import dynamic from "next/dynamic";

export const dynamic = "force-dynamic";

const ClientPage = dynamic(() => import("./client-page").then(mod => mod.default), {
  ssr: false,
});

export default function Page() {
  return <ClientPage />;
}
