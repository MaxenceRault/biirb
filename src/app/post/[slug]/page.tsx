import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { connection } from "next/server";
import { cache, Suspense, type ReactNode } from "react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Footer } from "@/components/Footer";
import { Navbar } from "@/components/Navbar";
import { PostBody } from "@/components/PostBody";
import { PostComments } from "@/components/PostComments";
import { PostReactions } from "@/components/PostReactions";
import { ProfileAvatarLink, ProfileNameLink, profileHref } from "@/components/ProfileLink";
import { ReportButton } from "@/components/ReportButton";
import { RoleBadge } from "@/components/RoleBadge";
import { ShareButton } from "@/components/ShareButton";
import { TrackEvent } from "@/components/TrackEvent";
import { Avatar } from "@/components/ui/Avatar";
import { buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/ui/Icon";
import { flagEmoji, placeHref } from "@/lib/country";
import { getPostDetail, getPostSlug, type PostDetail } from "@/server/services/post.service";
import { listComments } from "@/server/services/comment.service";
import { getLikeCount } from "@/server/services/reaction.service";
import { postIdSchema, postSlugSchema } from "@/schemas/post.schema";

type ResolvedPost = { post: PostDetail } | { redirectTo: string } | null;

// Partagée par generateMetadata et la page. « 30 » : ancien lien par id → redirection ;
// autre chose qu'un slug valide : introuvable, sans requête en base.
const resolvePost = cache(async (segment: string): Promise<ResolvedPost> => {
  const id = postIdSchema.safeParse(segment);
  if (id.success) {
    const slug = await getPostSlug(id.data);
    return slug ? { redirectTo: `/post/${slug}` } : null;
  }

  const slug = postSlugSchema.safeParse(segment);
  if (!slug.success) return null;
  const post = await getPostDetail(slug.data);
  return post ? { post } : null;
});

export async function generateMetadata({ params }: PageProps<"/post/[slug]">): Promise<Metadata> {
  const resolved = await resolvePost((await params).slug);
  if (!resolved || "redirectTo" in resolved) return {};
  const { post } = resolved;
  const t = await getTranslations("Metadata");
  const url = `/post/${post.slug}`;
  const images = [{ url: post.photoUrl, alt: post.photoAlt }];

  // openGraph remplace celui du layout et Next n'y recopie ni title ni description : tout est redonné ici.
  return {
    title: post.title,
    description: post.shortDescription,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      url,
      siteName: t("title"),
      locale: "fr_FR",
      title: post.title,
      description: post.shortDescription,
      publishedTime: new Date(post.createdAt).toISOString(),
      images,
    },
    twitter: { card: "summary_large_image", title: post.title, description: post.shortDescription, images },
  };
}

export default function PostPage({ params }: PageProps<"/post/[slug]">) {
  return (
    <>
      <Navbar />
      <Suspense fallback={<PostSkeleton />}>
        <PostContent params={params} />
      </Suspense>
      <Footer />
    </>
  );
}

async function PostContent({ params }: Pick<PageProps<"/post/[slug]">, "params">) {
  const { slug } = await params;
  // Dates relatives : calculées à chaque requête.
  await connection();
  const resolved = await resolvePost(slug);
  if (!resolved) notFound();
  // Les liens déjà partagés restent valides.
  if ("redirectTo" in resolved) permanentRedirect(resolved.redirectTo);
  const { post } = resolved;
  const [likeCount, comments] = await Promise.all([getLikeCount(post.id), listComments(post.id).catch(() => [])]);

  const t = await getTranslations("Post");
  const format = await getFormatter();
  const { destination } = post;
  const destinationLabel = [destination.city ?? destination.state, destination.country].filter(Boolean).join(", ");
  const dates = format.dateTimeRange(new Date(post.startDate), new Date(post.endDate), {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <>
      <TrackEvent event="story_viewed" data={{ archetype: post.archetype.slug, country: destination.countryCode }} />
      {/* Photo du récit en haut de page : floutée, elle s'efface vers le bas et laisse place au fond global.
          absolute (et non fixed) : elle défile avec la page. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-screen overflow-hidden [mask-image:linear-gradient(to_bottom,black_35%,transparent)]"
      >
        <Image src={post.photoUrl} alt="" fill sizes="100vw" className="scale-110 object-cover blur-sm" />
        <div className="absolute inset-0 bg-ink/30" />
      </div>

      <main className="relative w-full flex-1 pt-24 pb-12">
        <div className="mx-auto grid max-w-340 items-start gap-8 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
          <Card className="p-6 shadow-xl md:p-10 lg:col-span-8">
            <article>
              <div className="mb-8 flex flex-col justify-between gap-4 border-b border-line pb-4 sm:flex-row sm:items-center">
                <nav aria-label={t("breadcrumb")} className="min-w-0">
                  <ol className="flex flex-wrap items-center gap-2 font-display text-label-md text-ink-soft/70">
                    <li>
                      <Link href="/" className="group flex items-center gap-1.5 transition hover:text-ink">
                        <Icon name="arrowBack" className="size-4 transition group-hover:-translate-x-0.5" />
                        {t("back")}
                      </Link>
                    </li>
                    <Crumb href={placeHref({ country: destination.countryCode })}>{destination.country}</Crumb>
                    {destination.city && (
                      <Crumb
                        href={placeHref({
                          country: destination.countryCode,
                          state: destination.stateCode,
                          city: destination.city,
                        })}
                      >
                        {destination.city}
                      </Crumb>
                    )}
                    <Crumb current>{post.title}</Crumb>
                  </ol>
                </nav>
                <div className="flex flex-wrap items-center gap-2">
                  <PostReactions postId={post.id} initialLikeCount={likeCount} />
                  <ShareButton title={post.title} />
                  <ReportButton postId={post.id} authorId={post.author.id} />
                </div>
              </div>

              <header className="mb-8 flex flex-col">
                <span className="mb-4 inline-flex items-center gap-2 self-start rounded-lg bg-surface-muted px-3 py-1 font-display text-label-sm text-ink-soft uppercase">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
                  {post.archetype.label}
                </span>
                <h1 className="mb-4 font-display text-headline-xl-mobile text-ink md:text-headline-xl">{post.title}</h1>
                <p className="mb-6 text-body-xl text-ink-soft">{post.shortDescription}</p>

                <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-surface-muted px-4 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <ProfileAvatarLink username={post.author.username} name={post.author.displayName}>
                      <Avatar src={post.author.avatarUrl} name={post.author.avatarSeed ?? post.author.id}
                        backgroundColor={post.author.avatarBackgroundColor} alt="" size={44} />
                    </ProfileAvatarLink>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-label-lg text-ink">
                          <ProfileNameLink username={post.author.username}>{post.author.displayName}</ProfileNameLink>
                        </span>
                        <RoleBadge role={post.author.role} />
                        <span className="rounded bg-surface px-1.5 py-0.5 font-display text-label-sm text-ink-soft/70">
                          @{post.author.username}
                        </span>
                      </div>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-ink-soft/70">
                        <span className="flex items-center gap-1">
                          <Icon name="pin" className="size-3.5" />
                          {destinationLabel}
                        </span>
                        <span aria-hidden="true">•</span>
                        <span>{dates}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 font-display text-label-md text-ink-soft/70">
                    <span className="flex items-center gap-1.5 rounded-lg bg-surface px-2.5 py-1">
                      <Icon name="clock" className="size-4" />
                      {t("readingTime", { minutes: post.readingMinutes })}
                    </span>
                    <time dateTime={post.createdAt}>{format.relativeTime(new Date(post.createdAt), new Date())}</time>
                  </div>
                </div>
              </header>

              <figure className="mb-10">
                <div className="relative aspect-16/10 w-full overflow-hidden rounded-lg bg-surface-muted">
                  <Image
                    src={post.photoUrl}
                    alt={post.photoAlt}
                    fill
                    preload
                    sizes="(min-width: 1360px) 830px, (min-width: 1024px) 60vw, 100vw"
                    className="object-cover"
                  />
                </div>
              </figure>

              {post.body ? (
                <PostBody body={post.body} fallbackAlt={t("bodyPhotoAlt", { title: post.title })} />
              ) : (
                /* Ancien récit : texte brut, jamais interprété comme du HTML. */
                <div className="space-y-6 text-body-lg whitespace-pre-line text-ink-soft">
                  {post.paragraphs.map((paragraph, index) => (
                    <p
                      key={index}
                      className={
                        index === 0
                          ? "flow-root text-body-xl text-ink first-letter:float-left first-letter:pr-3 first-letter:font-display first-letter:text-5xl first-letter:leading-none first-letter:text-accent"
                          : undefined
                      }
                    >
                      {paragraph}
                    </p>
                  ))}
                </div>
              )}

              <footer className="mt-12 flex flex-col gap-6 pt-8">
                {post.tags.length > 0 && (
                  <ul aria-label={t("tagsLabel")} className="flex flex-wrap items-center gap-2">
                    {post.tags.map((tag) => (
                      <li key={`${tag.countryCode}-${tag.stateCode}-${tag.city}`}>
                        <Link
                          href={placeHref({ country: tag.countryCode, state: tag.stateCode, city: tag.city })}
                          className="block rounded-lg bg-surface-muted px-3.5 py-1.5 font-display text-label-md text-ink-soft transition hover:bg-line hover:text-ink"
                        >
                          #{tag.label} <span aria-hidden="true">{flagEmoji(tag.countryCode)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex flex-wrap items-center gap-4 rounded-lg bg-surface-muted p-6">
                  <ProfileAvatarLink username={post.author.username} name={post.author.displayName}>
                    <Avatar src={post.author.avatarUrl} name={post.author.avatarSeed ?? post.author.id}
                      backgroundColor={post.author.avatarBackgroundColor} alt="" size={64} />
                  </ProfileAvatarLink>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-headline-sm text-ink">
                      {t("writtenBy", { name: post.author.displayName })}
                    </p>
                    <p className="mt-1 text-body-md text-ink-soft/70">@{post.author.username}</p>
                  </div>
                  {/* Lien explicite vers le profil de l'auteur, en fin de lecture. */}
                  <Link
                    href={profileHref(post.author.username)}
                    className={buttonClassName("sm", "", "secondary")}
                  >
                    {t("viewAuthorProfile")}
                  </Link>
                </div>
              </footer>
            </article>
            <PostComments postId={post.id} initialComments={comments} />
          </Card>

          <aside className="flex flex-col gap-6 lg:sticky lg:top-24 lg:col-span-4">
            <Card className="p-6 shadow-xl">
              <h2 className="mb-4 font-display text-headline-sm text-ink">{t("tripInfo")}</h2>
              <dl className="grid grid-cols-2 gap-3">
                <TripFact icon="pin" label={t("destination")}>
                  {destination.city ?? destination.country}{" "}
                  <span aria-hidden="true">{flagEmoji(destination.countryCode)}</span>
                </TripFact>
                <TripFact icon="calendar" label={t("duration")}>
                  {t("durationValue", { days: post.durationDays })}
                </TripFact>
                <TripFact icon="clock" label={t("dates")} wide>
                  {dates}
                </TripFact>
                <TripFact icon="book" label={t("archetype")} wide>
                  {post.archetype.label}
                </TripFact>
              </dl>
            </Card>

            <Card className="p-6 shadow-xl">
              <h2 className="mb-1.5 flex items-center gap-2 font-display text-headline-sm text-ink">
                <Icon name="sparkles" className="size-5 text-accent" />
                {t("aiTitle")}
              </h2>
              <p className="mb-4 text-body-sm text-ink-soft/70">{t("aiText")}</p>
              <Link href="/planner" className={buttonClassName("md", "w-full gap-2")}>
                <Icon name="add" className="size-4" />
                {t("openPlanner")}
              </Link>
            </Card>
          </aside>
        </div>
      </main>
    </>
  );
}

function Crumb({ children, href, current = false }: { children: ReactNode; href?: string; current?: boolean }) {
  return (
    <>
      <li aria-hidden="true" className="text-line">
        /
      </li>
      <li aria-current={current ? "page" : undefined} className={current ? "max-w-xs truncate text-ink md:max-w-md" : undefined}>
        {href ? (
          <Link href={href} className="transition hover:text-ink">
            {children}
          </Link>
        ) : (
          children
        )}
      </li>
    </>
  );
}

function TripFact({ icon, label, wide = false, children }: { icon: IconName; label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`flex flex-col gap-1 rounded-lg bg-surface-muted p-3 ${wide ? "col-span-2" : ""}`}>
      <dt className="flex items-center gap-1 font-display text-label-sm text-ink-soft/70">
        <Icon name={icon} className="size-3.5" />
        {label}
      </dt>
      <dd className="font-display text-label-lg text-ink">{children}</dd>
    </div>
  );
}

function PostSkeleton() {
  return (
    <main aria-hidden="true" className="w-full flex-1 pt-24 pb-12">
      <div className="mx-auto grid max-w-340 animate-pulse gap-8 px-4 sm:px-6 lg:grid-cols-12 lg:px-8">
        <Card className="h-200 p-10 lg:col-span-8">
          <div className="mb-6 h-10 w-3/4 rounded-lg bg-surface-muted" />
          <div className="aspect-16/10 rounded-lg bg-surface-muted" />
        </Card>
        <Card className="h-80 lg:col-span-4" />
      </div>
    </main>
  );
}
