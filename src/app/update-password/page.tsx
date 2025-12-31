'use client'

import dynamic from "next/dynamic";
import { Suspense } from "react";

const UpdatePasswordPage = dynamic(() => import("./client-page"), { ssr: false });

export default function Page() {
  return (
    <Suspense fallback={<div>Chargement...</div>}>
      <UpdatePasswordPage />
    </Suspense>
  );
}
