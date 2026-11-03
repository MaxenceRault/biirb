"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Biirbou, type BiirbouMood } from "@/components/ui/Biirbou";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { ReasoningText } from "@/components/ui/ReasoningText";

// Mêmes durées que le panneau Biirbou du planning (TripCopilot).
const THINK_MS = 1_400;
const CHEER_MS = 2_500;
const SAD_MS = 1_500;

type Phase = "pending" | "thinking" | "answered";

// Démo de l'accueil : rien n'est envoyé ni enregistré, Biirbou réagit comme dans le panneau du planning.
export function LandingCopilotDemo() {
  const t = useTranslations("Landing.copilot.demo");
  const reduce = useReducedMotion() ?? false;
  const [phase, setPhase] = useState<Phase>("pending");
  const [accepted, setAccepted] = useState(false);
  const [mood, setMood] = useState<BiirbouMood>("idle");
  const [answers, setAnswers] = useState(0);
  const [hovered, setHovered] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function later(fn: () => void, ms: number) {
    timers.current.push(setTimeout(fn, ms));
  }

  function answer(choice: boolean) {
    setAccepted(choice);
    setPhase("thinking");
    setMood("thinking");
    setHovered(false);
    later(() => {
      setPhase("answered");
      setAnswers((count) => count + 1);
      setMood(choice ? "happy" : "sad");
      later(() => setMood("idle"), choice ? CHEER_MS : SAD_MS);
    }, THINK_MS);
  }

  function replay() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase("pending");
    setMood("idle");
  }

  // La hauteur s'anime aussi (entrée et sortie) : la carte grandit et se rétracte en douceur, sans saut.
  const bubble = {
    initial: reduce ? false : { opacity: 0, height: 0 },
    animate: { opacity: 1, height: "auto" },
    exit: reduce ? { opacity: 0, height: 0, transition: { duration: 0 } } : { opacity: 0, height: 0 },
    transition: { duration: 0.3, ease: [0.23, 1, 0.32, 1] },
  } as const;

  return (
    <figure className="flex flex-col gap-3">
      <Card className="flex flex-col gap-4 p-5 shadow-sm">
        <div aria-hidden="true" className="flex items-center gap-2 border-b border-line pb-3">
          <Biirbou mood={mood} bounce={answers} hovered={hovered} followPointer className="size-10" />
          <span className="font-display text-label-lg text-ink">{t("name")}</span>
        </div>
        <p className="ml-auto max-w-[85%] rounded-lg rounded-br-none bg-ink px-3.5 py-2.5 text-body-sm text-surface">{t("question")}</p>
        <p className="max-w-[90%] rounded-lg rounded-bl-none bg-surface-muted px-3.5 py-2.5 text-body-sm text-ink">{t("answer")}</p>
        <div className="flex flex-col">
          <div
            className={`flex flex-col gap-3 rounded-lg border border-line p-3.5 transition-opacity ${
              phase !== "pending" && !accepted ? "opacity-60" : ""
            }`}
          >
            <p className="flex items-center gap-2 font-display text-label-md text-ink">
              <Icon name="sparkles" className="size-4 text-accent" />
              {t("proposal")}
            </p>
            {phase === "pending" ? (
              <div className="flex gap-2" onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
                <Button size="sm" onClick={() => answer(true)}>
                  <Icon name="check" className="size-4" />
                  {t("accept")}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => answer(false)}>
                  {t("refuse")}
                </Button>
              </div>
            ) : (
              <span className={`flex items-center gap-1.5 text-label-sm ${accepted ? "text-accent" : "text-ink-soft"}`}>
                {accepted && <Icon name="check" className="size-4" />}
                {t(accepted ? "accepted" : "refused")}
              </span>
            )}
          </div>
          {/* Hors du gap de la carte : vide, la zone ne prend aucune place ; l'espacement (pt-4) suit la hauteur animée. */}
          <div aria-live="polite" className="flex flex-col">
            <AnimatePresence initial={false}>
              {phase === "thinking" && (
                <motion.div key="thinking" {...bubble} className="overflow-hidden">
                  <div className="pt-4">
                    <div className="max-w-[90%] rounded-lg rounded-bl-none bg-surface-muted px-3.5 py-2.5">
                      <ReasoningText phrases={t.raw("reasoning") as string[]} />
                    </div>
                  </div>
                </motion.div>
              )}
              {phase === "answered" && (
                <motion.div key="reply" {...bubble} className="overflow-hidden">
                  <div className="flex flex-col items-start gap-2 pt-4">
                    <p className="max-w-[90%] rounded-lg rounded-bl-none bg-surface-muted px-3.5 py-2.5 text-body-sm text-ink">
                      {t(accepted ? "replyAccepted" : "replyRefused")}
                    </p>
                    <button
                      type="button"
                      onClick={replay}
                      className="flex items-center gap-1 text-label-sm text-ink-soft transition hover:text-ink focus-visible:underline focus-visible:outline-none"
                    >
                      <Icon name="refresh" className="size-4" />
                      {t("replay")}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </Card>
      <figcaption className="text-center text-label-sm text-ink-soft">{t("caption")}</figcaption>
    </figure>
  );
}
