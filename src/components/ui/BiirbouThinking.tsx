"use client";

import { Biirbou } from "@/components/ui/Biirbou";
import { ReasoningText } from "@/components/ui/ReasoningText";

// Biirbou au travail (génération, réimagination, jour re-généré, réponse dans la discussion) : la mascotte qui réfléchit
// à côté des phrases en cascade. Un seul composant pour que ces attentes se ressemblent partout.
export function BiirbouThinking({ phrases, size = "md", className = "" }: { phrases: string[]; size?: "sm" | "md"; className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <Biirbou mood="thinking" className={size === "sm" ? "size-7" : "size-10"} />
      <ReasoningText phrases={phrases} />
    </div>
  );
}
