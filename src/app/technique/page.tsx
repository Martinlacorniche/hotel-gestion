"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ThemedBackground } from "@/components/ThemedBackground";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/context/AuthContext";
import { useHotelScope } from "@/hooks/useHotelScope";
import { Wrench, Tv2, Wifi, Monitor, Wind, ChevronRight } from "lucide-react";

type Cond = "always" | "corniche" | "voiles" | "superadmin";
type TechTool = {
  id: string; label: string; desc: string; href: string;
  icon: typeof Wrench; bg: string; text: string; cond: Cond;
};

const TOOLS: TechTool[] = [
  { id: "maintenance", label: "Maintenance", desc: "Tickets & interventions techniques", href: "/maintenance", icon: Wrench, bg: "bg-yellow-50", text: "text-yellow-700", cond: "always" },
  { id: "chromecast", label: "Chromecasts", desc: "Pilotage des Chromecasts des chambres", href: "/chromecast", icon: Tv2, bg: "bg-slate-100", text: "text-slate-700", cond: "corniche" },
  { id: "wifi-admin", label: "Wifi Client", desc: "Réseau & portail invité", href: "/wifi-admin", icon: Wifi, bg: "bg-sky-50", text: "text-sky-700", cond: "always" },
  { id: "clim", label: "Clim", desc: "Journal des incidents climatisation", href: "/clim", icon: Wind, bg: "bg-sky-50", text: "text-sky-700", cond: "voiles" },
  { id: "ecran", label: "Écran", desc: "Messages sur l'écran SmallTV", href: "/ecran", icon: Monitor, bg: "bg-slate-100", text: "text-slate-700", cond: "superadmin" },
];

export default function TechniquePage() {
  const { user } = useAuth();
  const { currentHotel } = useHotelScope();
  const isSuperadmin = user?.role === "superadmin";
  const isCorniche = currentHotel?.nom?.toLowerCase().includes("corniche");
  const isVoiles = currentHotel?.nom?.toLowerCase().includes("voiles");

  useEffect(() => {
    const hotelName = currentHotel?.nom ? ` — ${currentHotel.nom}` : "";
    document.title = `Technique${hotelName}`;
  }, [currentHotel]);

  const visible = TOOLS.filter((t) => {
    if (t.cond === "corniche") return isCorniche;
    if (t.cond === "voiles") return isVoiles;
    if (t.cond === "superadmin") return isSuperadmin;
    return true;
  });

  return (
    <div className="min-h-screen font-sans text-slate-900 relative">
      <ThemedBackground />

      <div className="max-w-3xl mx-auto px-6 py-10">
        <PageHeader
          icon={Wrench}
          title="Technique"
          subtitle={`Maintenance & équipements${currentHotel?.nom ? ` — ${currentHotel.nom}` : ''}`}
          iconClassName="bg-yellow-50 text-yellow-700"
        />

        <div className="grid sm:grid-cols-2 gap-4">
          {visible.map((t) => (
            <Link
              key={t.id}
              href={t.href}
              className="group bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md hover:border-slate-300 transition-all flex items-center gap-4"
            >
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${t.bg} ${t.text}`}>
                <t.icon className="w-7 h-7" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-bold text-slate-800 text-lg">{t.label}</h2>
                <p className="text-xs text-slate-500 mt-0.5 leading-snug">{t.desc}</p>
              </div>
              <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-slate-400 transition shrink-0" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
