"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

// idle : vit sa vie (clignements, regards, s'endort sans activité) ; thinking : Biirbou répond ; happy : proposition
// acceptée ; asleep : endormi (hors ligne, repos).
export type BiirbouMood = "idle" | "thinking" | "happy" | "asleep";

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

// Mascotte de Biirbou : hibou plein encre, yeux blancs,
// bec à l'accent ; partout le même, jamais d'autres couleurs.
// Décoratif : son nom est toujours écrit à côté. Animations en SVG + Motion, aucune si l'utilisateur les réduit,
// en pause quand l'onglet n'est pas visible.
export function Biirbou({ mood = "idle", className = "size-6" }: { mood?: BiirbouMood; className?: string }) {
  const reduce = useReducedMotion() ?? false;
  const [blink, setBlink] = useState(false);
  const [glance, setGlance] = useState({ x: 0, y: 0 });
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

    const glanceLoop = () =>
      later(() => {
        if (visible() && mood !== "thinking") {
          setGlance(GLANCES[Math.floor(Math.random() * GLANCES.length)]);
          later(() => setGlance({ x: 0, y: 0 }), 1_200);
        }
        glanceLoop();
      }, random(4_000, 9_000));

    blinkLoop();
    glanceLoop();
    return () => timers.forEach(clearTimeout);
  }, [alive, mood]);

  // S'endort sans activité, se réveille d'un petit saut au premier geste.
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

  const bodyColor = "fill-ink";
  const eyeColor = "fill-surface";
  const pupilColor = "fill-ink";
  const lineColor = "stroke-surface";
  const pupil = mood === "thinking" ? { x: 2, y: -3 } : glance;
  const showOpenEyes = !asleep && mood !== "happy";

  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={`shrink-0 overflow-visible ${className}`}>
      {/* Nouvelle clé = nouveau départ : petit saut au réveil et quand il est content. */}
      <motion.g
        key={`${hops}-${mood === "happy"}`}
        style={{ originX: 0.5, originY: 1 }}
        initial={(hops > 0 || mood === "happy") && !reduce ? { y: -6, scaleY: 1.05 } : false}
        animate={
          reduce
            ? undefined
            : mood === "thinking"
              ? { rotate: [-6, 6], y: 0, scaleY: 1, transition: { rotate: { duration: 0.8, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" } } }
              : asleep
                ? { rotate: 0, y: 0, scaleY: [1, 0.97], transition: { scaleY: { duration: 1.6, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" } } }
                : { rotate: 0, y: 0, scaleY: 1, transition: SPRING }
        }
      >
        <path
          d="M13.5 15.5 Q20 21 32 20.5 Q44 21 50.5 15.5 Q55 27 54 38 Q52.5 56 32 56 Q11.5 56 10 38 Q9 27 13.5 15.5 Z"
          className={bodyColor}
        />
        {showOpenEyes &&
          [24, 40].map((cx) => (
            <motion.g key={cx} style={{ originX: 0.5, originY: 0.5 }} animate={{ scaleY: blink ? 0.12 : 1 }} transition={{ duration: 0.07 }}>
              <circle cx={cx} cy="32" r="8.5" className={eyeColor} />
              <motion.circle cx={cx} cy="33" r="4" className={pupilColor} animate={reduce ? undefined : pupil} transition={SPRING} />
            </motion.g>
          ))}
        {/* Yeux fermés (dort) ou en accent circonflexe (content). */}
        {!showOpenEyes && (
          <g fill="none" strokeWidth="2.6" strokeLinecap="round" className={lineColor}>
            {asleep ? (
              <path d="M17 32 Q24 37 31 32 M33 32 Q40 37 47 32" />
            ) : (
              <path d="M17 34 Q24 27 31 34 M33 34 Q40 27 47 34" />
            )}
          </g>
        )}
        <path d="M29.6 40.5 L32 45 L34.4 40.5 Z" strokeWidth="1.4" strokeLinejoin="round" className="fill-accent stroke-accent" />
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
