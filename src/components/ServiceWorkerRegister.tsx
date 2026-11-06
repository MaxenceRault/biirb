"use client";

import { useEffect } from "react";
// Chargé sur toutes les pages : capte la proposition d'installation avant l'affichage du bouton (accueil).
import "@/client/install";

// Production seulement : en dev, le cache gênerait le rechargement à chaud.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js").catch(() => null);
  }, []);
  return null;
}
