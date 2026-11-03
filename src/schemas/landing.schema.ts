import { z } from "zod";
import { LANDING_ANGLES } from "@/lib/landing";

// ?angle= de l'accueil : valeur inconnue → accueil normal.
export const landingAngleSchema = z.enum(LANDING_ANGLES);
