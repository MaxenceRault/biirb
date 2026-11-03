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

// Joues : trois points en triangle sous chaque œil (symétriques).
const FRECKLES = [
  [-2, -0.5],
  [1, -1],
  [-0.5, 2],
].flatMap(([dx, dy]) => [
  [18 + dx, 36.5 + dy],
  [46 - dx, 36.5 + dy],
]);

const random = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

// Mascotte de Biirbou : hibou en œuf dessiné au trait encre comme le logo (intérieur blanc), yeux-points avec reflet,
// joues en points, bec en flèche GPS et écharpe nouée à l'accent ; partout le même, jamais d'autres couleurs.
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

  // Ordre : réflexion (en l'air), survol (il te regarde), regard ailleurs, sinon la souris.
  const look = mood === "thinking" ? { x: 2, y: -3 } : mood === "sad" ? { x: 0, y: 2.5 } : hovered || inflating ? { x: 0, y: 0.5 } : (glance ?? (followPointer ? gaze : { x: 0, y: 0 }));
  // Yeux en points : tout l'œil se déplace, moins loin qu'une pupille dans un grand œil blanc.
  const pupil = { x: look.x * 0.6, y: look.y * 0.6 };
  const eyeScale = (hovered || inflating) && !reduce ? 1.12 : 1;
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
              ? { rotate: [-6, 6], y: 0, scaleY: 1, transition: { rotate: { duration: 0.8, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" } } }
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
                  ? { rotate: -8, y: -3, scaleX: 1, scaleY: 1.04, transition: SPRING }
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
        {/* Corps en œuf au trait, comme le logo ; rempli de blanc pour rester lisible sur une photo ou du contenu. */}
        <g strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" className="stroke-ink">
          <path
            d="M24 55.5 C 15 52.5 11 44.5 11 35.5 C 11 23 15.5 14.5 21.5 11.5 C 24 14.5 27 16 32 16 C 37 16 40 14.5 42.5 11.5 C 48.5 14.5 53 23 53 35.5 C 53 44.5 49 52.5 40 55.5"
            className="fill-surface"
          />
          <path d="M27.5 55 l-1 3.6 M36.5 55 l1 3.6" fill="none" strokeWidth="3.4" />
        </g>
        {showOpenEyes &&
          [24.5, 39.5].map((cx) => (
            <motion.g
              key={cx}
              style={{ originX: 0.5, originY: 0.5 }}
              animate={{ scaleX: eyeScale, scaleY: eyeOpen * eyeScale }}
              transition={{ duration: blink ? 0.07 : 0.2 }}
            >
              <motion.g animate={reduce ? undefined : pupil} transition={SPRING}>
                <circle cx={cx} cy="30" r="4.1" className="fill-ink" />
                <circle cx={cx + 1.5} cy="28.5" r="1.35" className="fill-surface" />
              </motion.g>
            </motion.g>
          ))}
        {/* Yeux fermés (dort) ou en arc (content). */}
        {!showOpenEyes && (
          <g fill="none" strokeWidth="2.8" strokeLinecap="round" className="stroke-ink">
            {asleep ? (
              <path d="M20.5 30 Q24.5 33.5 28.5 30 M35.5 30 Q39.5 33.5 43.5 30" />
            ) : (
              <path d="M20.5 31.5 Q24.5 27 28.5 31.5 M35.5 31.5 Q39.5 27 43.5 31.5" />
            )}
          </g>
        )}
        {/* Joues : trois petits points sous chaque œil. */}
        {FRECKLES.map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="0.95" className="fill-accent opacity-85" />
        ))}
        {/* Bec : la flèche GPS du logo, pointée vers le bas. */}
        <path d="M32 40 L28.5 33.5 L32 35.97 L35.5 33.5 Z" strokeWidth="1.3" strokeLinejoin="round" className="fill-accent stroke-accent" />
        {/* Écharpe de voyage nouée sur le côté ; les pans flottent doucement tant qu'il est éveillé. */}
        <g fill="none" strokeLinecap="round" className="stroke-accent">
          <path d="M14 42 Q32 49 50 42" strokeWidth="4" />
          <motion.path
            d="M41 46 L38.5 53 M41 46 L45 52.5"
            strokeWidth="3.6"
            style={{ originX: 0.5, originY: 0 }}
            animate={alive ? { rotate: [-5, 6] } : { rotate: 0 }}
            transition={alive ? { duration: 1.4, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" } : undefined}
          />
        </g>
        <circle cx="41" cy="46" r="2.8" className="fill-accent" />
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
