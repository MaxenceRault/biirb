import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ComponentType } from "react";
import { getTranslations } from "next-intl/server";
import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";
import { LoginForm } from "@/components/LoginForm";
import { RegisterForm } from "@/components/RegisterForm";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";
import { Card } from "@/components/ui/Card";

// Toute autre valeur de ?view= retombe sur la connexion.
const VIEWS = ["login", "register", "forgot", "reset"] as const;
type AuthView = (typeof VIEWS)[number];

function parseView(value: string | string[] | undefined): AuthView {
  return VIEWS.find((view) => view === value) ?? "login";
}

const SWITCH_HREF: Record<AuthView, string> = {
  login: "/login?view=register",
  register: "/login",
  forgot: "/login",
  reset: "/login",
};

const FORMS: Record<AuthView, ComponentType> = {
  login: LoginForm,
  register: RegisterForm,
  forgot: ForgotPasswordForm,
  // Lien reçu par email : /login?view=reset#token=…
  reset: ResetPasswordForm,
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth");

  return { title: t("metaTitle") };
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const t = await getTranslations("Metadata");

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10 md:px-8">
      <Card className="w-full max-w-115 p-6 md:p-10">
        <div className="mb-6 flex items-center justify-center gap-1">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-accent" />
          <span className="font-display text-headline-sm text-ink">{t("title")}</span>
        </div>

        {/* Dépend de l'URL : rendu dans un Suspense. */}
        <Suspense>
          <AuthPanel searchParams={searchParams} />
        </Suspense>
      </Card>
    </main>
  );
}

// Passer de la connexion à l'inscription garde la page de retour (?next=, revérifiée par nextPathAfterLogin).
function switchHref(view: AuthView, next: string | string[] | undefined) {
  if (typeof next !== "string" || !next.startsWith("/")) return SWITCH_HREF[view];
  const [path, query = ""] = SWITCH_HREF[view].split("?");
  const params = new URLSearchParams(query);
  params.set("next", next);
  return `${path}?${params}`;
}

async function AuthPanel({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const params = await searchParams;
  const view = parseView(params.view);
  const t = await getTranslations("Auth");
  const Form = FORMS[view];

  return (
    <>
      <div className="text-center">
        <h1 className="font-display text-headline-lg text-ink">{t(`${view}.title`)}</h1>
        <p className="mx-auto mt-1 max-w-85 text-body-md text-ink-soft">
          {t(`${view}.subtitle`)}
        </p>
      </div>

      <div className="mt-10">
        <Form />
      </div>

      <p className="mt-6 text-center text-body-md text-ink-soft">
        {t(`${view}.switchPrompt`)}{" "}
        <Link
          href={switchHref(view, params.next)}
          className="ml-1 font-display text-label-md text-ink transition hover:text-accent"
        >
          {t(`${view}.switchLink`)}
        </Link>
      </p>
    </>
  );
}
