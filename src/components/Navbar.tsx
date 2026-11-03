import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { buttonClassName } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Logo } from "@/components/ui/Logo";
import { NavbarAccount } from "@/components/NavbarAccount";
import { NavbarLinks } from "@/components/NavbarLinks";
import { NavbarMobileMenu } from "@/components/NavbarMobileMenu";

export async function Navbar() {
  const t = await getTranslations("Navbar");

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-line bg-surface/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-300 items-center justify-between gap-4 px-4 md:gap-6 md:px-6">
        <Link href="/" aria-label={t("home")} className="group flex shrink-0 items-center gap-2.5">
          <Logo className="size-9 transition group-hover:scale-105" />
          <span className="font-display text-headline-sm text-ink">{t("brand")}</span>
        </Link>

        <div className="mx-auto hidden max-w-xl flex-1 md:block">
          <SearchForm />
        </div>

        <div className="flex shrink-0 items-center gap-2 md:gap-6">
          {/* Ces éléments lisent l'URL (page active) : Suspense requis par cacheComponents. */}
          <nav aria-label={t("mainNav")} className="hidden items-center gap-5 md:flex">
            <Suspense>
              <NavbarLinks variant="inline" />
            </Suspense>
          </nav>

          <Suspense fallback={<span aria-hidden="true" className="block h-9 w-28" />}>
            <NavbarAccount />
          </Suspense>
          <Suspense fallback={<span aria-hidden="true" className="block size-10 md:hidden" />}>
            <NavbarMobileMenu search={<SearchForm />} />
          </Suspense>
        </div>
      </div>
    </header>
  );
}

async function SearchForm() {
  const t = await getTranslations("Navbar");

  return (
    <form role="search" action="/explore" method="get">
      <div className="flex items-center rounded-lg border border-transparent bg-surface-muted p-1.5 transition focus-within:border-accent focus-within:bg-surface">
        <Icon name="search" className="ml-2 size-4.5 shrink-0 text-ink-soft" />
        <input
          type="search"
          name="q"
          aria-label={t("searchLabel")}
          placeholder={t("searchPlaceholder")}
          minLength={2}
          maxLength={100}
          required
          className="w-full min-w-0 bg-transparent px-2 py-1 text-body-sm text-ink outline-none placeholder:text-ink-soft/60"
        />
        <button type="submit" className={buttonClassName("sm", "h-8 shrink-0")}>
          <Icon name="search" className="size-4" />
          {t("search")}
        </button>
      </div>
    </form>
  );
}
