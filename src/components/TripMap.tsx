"use client";

import { useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";

// Villes du planning (coordonnées calculées par le serveur) et leurs jours sur place ; stays vide : étape sans dates.
export type TripMapData = {
  pins: { name: string; latitude: number; longitude: number; stays: { start: string; end: string }[] }[];
  // Ordre des visites [longitude, latitude].
  route: [number, number][];
};

// Carte vectorielle « plan » (pas de satellite), gratuite et sans clé.
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
// Copié depuis node_modules par scripts/copy-maplibre-worker.mjs : même origine que le site (CSP).
const WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";
const ROUTE_SOURCE = "trip-route";

// Midi local : la date ne glisse pas selon le fuseau horaire.
const parseDay = (day: string) => new Date(`${day}T12:00:00`);

export function TripMap({ map: data }: { map: TripMapData }) {
  const t = useTranslations("Planner");
  const format = useFormatter();
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // La carte n'est recréée que si les villes ou leurs dates changent (pas à chaque modification du planning).
  const dataKey = JSON.stringify(data);

  useEffect(() => {
    const node = container.current;
    const { pins, route } = JSON.parse(dataKey) as TripMapData;
    if (!node || pins.length === 0) return;
    let cancelled = false;
    let remove = () => {};

    const stayDates = (stays: TripMapData["pins"][number]["stays"]) =>
      stays
        .map(({ start, end }) =>
          start === end
            ? format.dateTime(parseDay(start), { day: "numeric", month: "short" })
            : format.dateTimeRange(parseDay(start), parseDay(end), { day: "numeric", month: "short" }),
        )
        .join(", ");

    import("maplibre-gl")
      .then(({ Map, Marker, Popup, setWorkerUrl }) => {
        if (cancelled) return;
        setWorkerUrl(WORKER_URL);
        // Couleur du tracé : token du design system (le canvas ne lit pas les classes Tailwind).
        const accent = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
        const map = new Map({
          container: node,
          style: STYLE_URL,
          center: [pins[0].longitude, pins[0].latitude],
          zoom: 9,
          attributionControl: { compact: true },
          cooperativeGestures: true,
        });
        remove = () => map.remove();
        // Style injoignable : message plutôt qu'un cadre vide (une tuile manquante n'empêche pas l'affichage).
        map.on("error", () => {
          if (!map.isStyleLoaded()) setFailed(true);
        });

        if (pins.length > 1) {
          const longitudes = pins.map((pin) => pin.longitude);
          const latitudes = pins.map((pin) => pin.latitude);
          map.fitBounds(
            [
              [Math.min(...longitudes), Math.min(...latitudes)],
              [Math.max(...longitudes), Math.max(...latitudes)],
            ],
            { padding: 48, maxZoom: 11, duration: 0 },
          );
        }

        map.on("load", () => {
          // Noms des villes et pays en français quand la carte les a (sinon en alphabet latin, sinon le nom local).
          for (const layer of map.getStyle().layers) {
            if (layer.type === "symbol" && "source-layer" in layer && layer["source-layer"] === "place") {
              map.setLayoutProperty(layer.id, "text-field", ["coalesce", ["get", "name:fr"], ["get", "name:latin"], ["get", "name"]]);
            }
          }
          if (route.length < 2) return;
          map.addSource(ROUTE_SOURCE, { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route } } });
          map.addLayer({
            id: ROUTE_SOURCE,
            type: "line",
            source: ROUTE_SOURCE,
            paint: { "line-color": accent, "line-width": 2, "line-dasharray": [2, 1.5], "line-opacity": 0.7 },
          });
        });

        for (const pin of pins) {
          const dates = stayDates(pin.stays);
          // MapLibre place l'élément du repère avec transform : l'effet de survol est sur l'enfant, sinon le repère saute.
          const element = document.createElement("button");
          element.type = "button";
          element.className = "group cursor-pointer p-1 focus-visible:outline-none";
          element.setAttribute("aria-label", dates ? `${pin.name}, ${dates}` : pin.name);
          const dot = document.createElement("span");
          dot.className =
            "block size-4 rounded-full border-2 border-white bg-accent shadow-md transition group-hover:scale-125 group-focus-visible:scale-125";
          element.append(dot);

          // Nom de la ville et dates seulement, insérés comme texte (jamais comme HTML).
          const content = document.createElement("div");
          const name = document.createElement("p");
          name.className = "font-display text-label-lg text-ink";
          name.textContent = pin.name;
          content.append(name);
          if (dates) {
            const days = document.createElement("p");
            days.className = "text-body-sm text-ink-soft";
            days.textContent = dates;
            content.append(days);
          }

          const popup = new Popup({ closeButton: false, closeOnClick: true, offset: 14 }).setLngLat([pin.longitude, pin.latitude]).setDOMContent(content);
          new Marker({ element }).setLngLat([pin.longitude, pin.latitude]).addTo(map);
          const show = () => {
            if (!popup.isOpen()) popup.addTo(map);
          };
          const hide = () => popup.remove();
          element.addEventListener("mouseenter", show);
          element.addEventListener("mouseleave", hide);
          element.addEventListener("focus", show);
          element.addEventListener("blur", hide);
          // Écran tactile : pas de survol, un appui affiche la bulle (un appui sur la carte la ferme).
          element.addEventListener("click", (event) => {
            event.stopPropagation();
            show();
          });
        }
      })
      .catch(() => setFailed(true));

    return () => {
      cancelled = true;
      remove();
    };
  }, [dataKey, format]);

  if (data.pins.length === 0) return null;

  return (
    <Card className="flex flex-col gap-3 p-6">
      <h2 className="flex items-center gap-2 font-display text-headline-sm text-ink">
        <Icon name="pin" className="size-5 text-accent" />
        {t("map.title")}
      </h2>
      {failed ? (
        <p className="text-body-sm text-ink-soft">{t("map.error")}</p>
      ) : (
        <div ref={container} role="region" aria-label={t("map.label")} className="h-80 overflow-hidden rounded-lg bg-surface-muted md:h-96" />
      )}
    </Card>
  );
}
