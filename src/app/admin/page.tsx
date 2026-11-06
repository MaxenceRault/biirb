import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AdminView } from "@/components/AdminView";
import { Footer } from "@/components/Footer";
import { Navbar } from "@/components/Navbar";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin");

  return { title: t("metaTitle"), robots: { index: false } };
}

// Interface seulement : l'API vérifie le rôle admin à chaque requête.
export default function AdminPage() {
  return (
    <>
      <Navbar />
      <main className="w-full flex-1 pt-24 pb-20">
        {/* Plus large que les autres pages : Kanban à 4 colonnes à côté du menu sur un écran d'ordinateur. */}
        <div className="mx-auto max-w-400 px-4 md:px-6">
          <AdminView />
        </div>
      </main>
      <Footer />
    </>
  );
}
