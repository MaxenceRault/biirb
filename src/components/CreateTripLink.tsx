"use client";

import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";
import { analyticsAttributes } from "@/lib/analytics";
import { getSessionSnapshot, subscribeSession } from "@/client/session";

// Visiteur : inscription, puis retour direct au planificateur ; connecté : le planificateur.
// placement : où se trouve le bouton (mesure d'audience, aucune donnée personnelle).
export function CreateTripLink({ placement, className, children }: { placement: string; className: string; children: ReactNode }) {
  const session = useSyncExternalStore(subscribeSession, getSessionSnapshot, () => null);
  const href = session ? "/planner" : `/login?${new URLSearchParams({ view: "register", next: "/planner" })}`;

  return (
    <Link href={href} className={className} {...analyticsAttributes("create_trip_clicked", { placement })}>
      {children}
    </Link>
  );
}

