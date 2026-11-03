"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

// idle : vit sa vie (clignements, regards, plumes ébouriffées, s'endort sans activité) ; thinking : Biirbou répond ;
// happy : content ; sad : déçu (proposition refusée) ; tired : fatigué (quota du jour épuisé) ; asleep : endormi.
export type BiirbouMood = "idle" | "thinking" | "happy" | "sad" | "tired" | "asleep";

// Inactivité avant de s'endormir (mood idle) : aucun mouvement de souris, toucher, touche ni défilement.
const SLEEP_AFTER_MS = 45_000;
const ACTIVITY_EVENTS = ["pointermove", "pointerdown", "keydown", "scroll"] as const;
const SPRING = { type: "spring", stiffness: 420, damping: 22 } as const;
// Regards possibles (décalage des pupilles, en unités du dessin).
const GLANCES = [
  { x: 3, y: 0 },
  { x: -3, y: 0 },
  { x: 0, y: -2 },
  { x: 2, y: 2 },
];

const random = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

// Mascotte de Biirbou : pigeon voyageur de profil, tout en rondeurs, plein encre, œil blanc,
// bec et pattes à l'accent ; partout le même, jamais d'autres couleurs.
// Décoratif : son nom est toujours écrit à côté. Animations en SVG + Motion, aucune si l'utilisateur les réduit,
// en pause quand l'onglet n'est pas visible.
// animated={false} : immobile (titres) ; seule la mascotte du bouton flottant vit sa vie.
// hovered : on le survole, il te remarque (petit sursaut, tête penchée, grands yeux). followPointer : ses yeux suivent
// la souris. bounce : un petit saut à chaque nouvelle valeur (réponse reçue). oops : un double clignement à chaque
// nouvelle valeur (changement annulé).
export function Biirbou({
  mood = "idle",
  animated = true,
  hovered = false,
  followPointer = false,
  bounce = 0,
  oops = 0,
  pressed = false,
  inflating = false,
  className = "size-6",
}: {
  mood?: BiirbouMood;
  animated?: boolean;
  hovered?: boolean;
  followPointer?: boolean;
  bounce?: number;
  oops?: number;
  // Écrasé (clic sur le bouton flottant, juste avant de s'envoler vers le panneau).
  pressed?: boolean;
  // Appui maintenu : il gonfle (prioritaire sur le survol), puis tremble une fois plein.
  inflating?: boolean;
  className?: string;
}) {
  const reduce = (useReducedMotion() ?? false) || !animated;
  const svg = useRef<SVGSVGElement>(null);
  const [blink, setBlink] = useState(false);
  const [glance, setGlance] = useState<{ x: number; y: number } | null>(null);
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const [ruffles, setRuffles] = useState(0);
  const [dozing, setDozing] = useState(false);
  const [hops, setHops] = useState(0);
  const dozingRef = useRef(false);

  const asleep = mood === "asleep" || (mood === "idle" && dozing);
  const alive = !reduce && !asleep;

  // Clignements à intervalle aléatoire, parfois doubles ; regards de temps en temps (pas pendant la réflexion).
  useEffect(() => {
    if (!alive) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms));
    const visible = () => document.visibilityState === "visible";

    const blinkLoop = () =>
      later(() => {
        if (visible()) {
          const once = (delay: number) => {
            later(() => setBlink(true), delay);
            later(() => setBlink(false), delay + 130);
          };
          once(0);
          if (Math.random() < 0.25) once(300);
        }
        blinkLoop();
      }, random(2_500, 6_000));

    // Regard ailleurs, et parfois (1 fois sur 6) il ébouriffe ses plumes.
    const glanceLoop = () =>
      later(() => {
        if (visible() && mood !== "thinking") {
          if (Math.random() < 1 / 6) setRuffles((count) => count + 1);
          else {
            setGlance(GLANCES[Math.floor(Math.random() * GLANCES.length)]);
            later(() => setGlance(null), 1_200);
          }
        }
        glanceLoop();
      }, random(4_000, 9_000));

    blinkLoop();
    glanceLoop();
    return () => timers.forEach(clearTimeout);
  }, [alive, mood]);

  // « Oups » : double clignement (après le rendu, jamais pendant).
  useEffect(() => {
    if (oops === 0 || reduce) return;
    const timers = [0, 300].flatMap((delay) => [setTimeout(() => setBlink(true), delay), setTimeout(() => setBlink(false), delay + 130)]);
    return () => timers.forEach(clearTimeout);
  }, [oops, reduce]);

  // Les yeux suivent la souris (une mise à jour par image au plus).
  useEffect(() => {
    if (!alive || !followPointer) return;
    let frame = 0;
    function onMove(event: PointerEvent) {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = svg.current?.getBoundingClientRect();
        if (!box) return;
        setGaze({
          x: clamp((event.clientX - (box.left + box.width / 2)) / 120, 3),
          y: clamp((event.clientY - (box.top + box.height / 2)) / 160, 2),
        });
      });
    }
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
    };
  }, [alive, followPointer]);

  // S'endort sans activité, se réveille d'un petit saut au premier geste (survoler le bouton suffit).
  useEffect(() => {
    if (mood !== "idle" || reduce) return;
    let timer = setTimeout(() => setDozingState(true), SLEEP_AFTER_MS);
    function setDozingState(value: boolean) {
      dozingRef.current = value;
      setDozing(value);
    }
    function onActivity() {
      clearTimeout(timer);
      if (dozingRef.current) {
        setDozingState(false);
        setHops((count) => count + 1);
      }
      timer = setTimeout(() => setDozingState(true), SLEEP_AFTER_MS);
    }
    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, onActivity, { passive: true }));
    return () => {
      clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, onActivity));
    };
  }, [mood, reduce]);

  // Un seul œil (vu de profil) : décalages du regard réduits pour que la pupille reste dans l'œil.
  const look = mood === "thinking" ? { x: 2, y: -3 } : mood === "sad" ? { x: 0, y: 2.5 } : hovered || inflating ? { x: 1, y: 0.5 } : (glance ?? (followPointer ? gaze : { x: 0, y: 0 }));
  const pupil = { x: look.x / 2, y: look.y / 2 };
  const eyeScale = (hovered || inflating) && !reduce ? 1.15 : 1;
  const eyeOpen = blink ? 0.12 : mood === "tired" ? 0.5 : mood === "sad" ? 0.8 : 1;
  const showOpenEyes = !asleep && mood !== "happy";

  return (
    <svg ref={svg} viewBox="0 0 64 64" aria-hidden="true" className={`shrink-0 overflow-visible ${className}`}>
      {/* Nouvelle clé = nouveau départ : petit saut au réveil et quand il est content. */}
      <motion.g
        key={`${hops}-${bounce}-${mood === "happy"}`}
        style={{ originX: 0.5, originY: 1 }}
        initial={(hops > 0 || bounce > 0 || mood === "happy") && !reduce ? { y: -6, scaleY: 1.05 } : false}
        animate={
          reduce
            ? undefined
            : mood === "thinking"
              ? { rotate: [-2, 2], y: 0, scaleY: 1, transition: { rotate: { duration: 0.6, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" } } }
              : asleep
                ? { rotate: 0, y: 0, scaleY: [1, 0.97], transition: { scaleY: { duration: 1.6, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" } } }
                : pressed
                  ? { rotate: 0, y: 2, scaleX: 1.1, scaleY: 0.82, transition: { duration: 0.12, ease: "easeOut" } }
                  : inflating
                  ? {
                      rotate: [-2, 2],
                      y: -2,
                      scaleX: 1.3,
                      scaleY: 1.3,
                      transition: {
                        default: { duration: 0.9, ease: "easeOut" },
                        rotate: { duration: 0.1, repeat: Infinity, repeatType: "mirror", delay: 0.8 },
                      },
                    }
                  : mood === "sad"
                  ? { rotate: [0, -5, 5, -3, 0], y: 1.5, scaleY: 0.96, transition: { rotate: { duration: 0.8, ease: "easeInOut" }, default: SPRING } }
                  : hovered
                  ? { rotate: -6, y: -3, scaleX: 1, scaleY: 1.04, transition: SPRING }
                  : { rotate: 0, y: 0, scaleX: 1, scaleY: 1, transition: SPRING }
        }
      >
        {/* Plumes ébouriffées : une secousse à chaque nouvelle clé. */}
        <motion.g
          key={ruffles}
          style={{ originX: 0.5, originY: 1 }}
          animate={ruffles > 0 && !reduce ? { rotate: [0, -7, 6, -4, 2, 0] } : { rotate: 0 }}
          transition={{ duration: 0.7, ease: "easeInOut" }}
        >
          <path d="M27 55 V60 M37 55 V60" fill="none" strokeWidth="3.5" strokeLinecap="round" className="stroke-accent" />
          <path d="M15 37 L5 45 L16 47 Z" strokeWidth="4" strokeLinejoin="round" className="fill-ink stroke-ink" />
          <ellipse cx="32" cy="41" rx="20" ry="15" className="fill-ink" />
          {/* Cou : tête et corps ne font qu'une silhouette, même quand la tête bouge. */}
          <path d="M29.5 25 Q27 31 20 33 L49.7 34 Q51 30 50.5 25 Z" className="fill-ink" />
          {/* Tête à part : elle hoche d'avant en arrière, comme un pigeon qui marche, quand il réfléchit. */}
          <motion.g
            animate={
              reduce
                ? undefined
                : mood === "thinking"
                  ? { x: [0, 3, 0], y: 0, transition: { x: { duration: 0.6, repeat: Infinity, ease: "easeInOut" } } }
                  : asleep
                    ? { x: -2, y: 3, transition: SPRING }
                    : mood === "sad" || mood === "tired"
                      ? { x: 0, y: 2, transition: SPRING }
                      : { x: 0, y: 0, transition: SPRING }
            }
          >
            <circle cx="40" cy="21" r="12" className="fill-ink" />
            {showOpenEyes ? (
              <motion.g
                style={{ originX: 0.5, originY: 0.5 }}
                animate={{ scaleX: eyeScale, scaleY: eyeOpen * eyeScale }}
                transition={{ duration: blink ? 0.07 : 0.2 }}
              >
                <circle cx="43" cy="19" r="5.5" className="fill-surface" />
                <motion.circle cx="43.5" cy="19" r="3" className="fill-ink" animate={reduce ? undefined : pupil} transition={SPRING} />
              </motion.g>
            ) : (
              <path
                d={asleep ? "M38.5 19 Q43 23.5 47.5 19" : "M38.5 21 Q43 15.5 47.5 21"}
                fill="none"
                strokeWidth="2.8"
                strokeLinecap="round"
                className="stroke-surface"
              />
            )}
            <path d="M51 17.5 L57 21 L51 24.5 Z" strokeWidth="3" strokeLinejoin="round" className="fill-accent stroke-accent" />
          </motion.g>
        </motion.g>
      </motion.g>
      <AnimatePresence>
        {asleep && !reduce && (
          <motion.g
            key="zz"
            fill="none"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="stroke-logo"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Deux « z » dessinés (décoratifs, pas du texte). */}
            {[
              { d: "M50 7 h6 l-6 7 h6", delay: 0 },
              { d: "M58 1 h4 l-4 4.5 h4", delay: 0.8 },
            ].map((z) => (
              <motion.path
                key={z.d}
                d={z.d}
                animate={{ y: [4, -4], opacity: [0, 1, 0] }}
                transition={{ duration: 2.4, delay: z.delay, repeat: Infinity, ease: "easeOut" }}
              />
            ))}
          </motion.g>
        )}
      </AnimatePresence>
    </svg>
  );
}
