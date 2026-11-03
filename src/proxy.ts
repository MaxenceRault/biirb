import { NextResponse, type NextRequest } from "next/server";
import { getUserIdFromRequest } from "@/server/jwt";
import { getPostSlug } from "@/server/services/post.service";
import { postIdSchema } from "@/schemas/post.schema";

// 1. Anciens liens /post/{id} : redirection 308 avant le rendu (depuis la page, rendue en streaming, ce serait 200).
// 2. Anciens liens du feed sur l'accueil (/?q=, /?archetype=) : redirection 308 vers la page Explorer, mêmes paramètres.
// 3. Routes API privées : refus immédiat sans token valide (chaque controller revérifie aussi).
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/post/")) {
    const id = postIdSchema.safeParse(pathname.slice("/post/".length));
    const slug = id.success ? await getPostSlug(id.data) : null;
    // Sans révéler l'existence d'un post masqué.
    return slug ? NextResponse.redirect(new URL(`/post/${slug}`, request.url), 308) : NextResponse.next();
  }

  if (pathname === "/") return NextResponse.redirect(new URL(`/explore${request.nextUrl.search}`, request.url), 308);

  // Le feed (GET /api/v1/posts) est public.
  if (request.method === "GET" && pathname === "/api/v1/posts") return NextResponse.next();
  // Le profil public d'un utilisateur (GET /api/v1/users/{pseudo}) se lit sans compte.
  // « me » (2 lettres) ne peut pas être un pseudo (3 à 30 caractères) : /api/v1/users/me reste privé.
  if (request.method === "GET" && /^\/api\/v1\/users\/[a-z0-9_]{3,30}$/.test(pathname)) return NextResponse.next();
  // Les commentaires d'un récit se lisent sans compte.
  if (request.method === "GET" && /^\/api\/v1\/posts\/\d+\/comments$/.test(pathname)) return NextResponse.next();

  if (!(await getUserIdFromRequest(request))) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/post/:id(\\d+)",
    // Seulement avec ces paramètres : l'accueil sans paramètre ne passe pas par le proxy.
    { source: "/", has: [{ type: "query", key: "q" }] },
    { source: "/", has: [{ type: "query", key: "archetype" }] },
    // Les pages ne reçoivent pas le token (navigateur, pas de cookie).
    "/api/v1/users/:path*",
    "/api/v1/posts/:path*",
    "/api/v1/trips/:path*",
    "/api/v1/admin/:path*",
    "/api/v1/tickets/:path*",
  ],
};
