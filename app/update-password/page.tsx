"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function UpdatePasswordPage() {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const searchParams = useSearchParams();

  useEffect(() => {
    const accessToken = searchParams.get("access_token");
    const refreshToken = searchParams.get("refresh_token");

    if (accessToken) {
      supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken || "",
      });
    }
  }, []);

  const handleSubmit = async () => {
    const { data, error } = await supabase.auth.updateUser({ password });
    if (error) {
      setStatus("❌ Erreur : " + error.message);
    } else {
      setStatus("✅ Mot de passe mis à jour !");
    }
  };

  return (
    <div className="max-w-md mx-auto mt-20 p-6 bg-white shadow-md rounded">
      <h1 className="text-2xl font-bold mb-4">🔐 Réinitialiser le mot de passe</h1>
      <input
        type="password"
        placeholder="Nouveau mot de passe"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full p-2 border rounded mb-4"
      />
      <button onClick={handleSubmit} className="bg-indigo-600 text-white px-4 py-2 rounded">
        Mettre à jour
      </button>
      {status && <p className="mt-4 text-center">{status}</p>}
    </div>
  );
}
