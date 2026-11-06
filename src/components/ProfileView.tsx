"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { ProfileEditForm, type EditableProfile } from "@/components/ProfileEditForm";
import { DeleteAccountSection } from "@/components/DeleteAccountSection";
import { PROFILE_TABS_CLASS_NAME, ProfileHeader, ProfileStat, ProfileStats, profileTabClassName } from "@/components/ProfileHeader";
import { StoryCard, StoryGrid, storyTitleId, type StoryCardData } from "@/components/StoryCard";
import { TripCard, type TripSummary } from "@/components/TripCard";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon, type IconName } from "@/components/ui/Icon";
import { apiFetch, updateSessionUser } from "@/client/session";
import { ProfileBadgePicker } from "@/components/ProfileBadgePicker";

type Story = {
  id: number;
  title: string;
  slug: string;
  photo_url: string;
  photo_alt: string;
  destination_country_code: string;
  destination_state_code: string | null;
  destination_city: string | null;
  start_date: string;
  created_at: string;
  is_hidden: boolean;
  pending_review: boolean;
};

type ProfileData = { user: EditableProfile; stories: Story[]; storyCount: number; saved: StoryCardData[] };

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; profile: ProfileData };

const TABS = ["stories", "itineraries", "saved"] as const;
type Tab = (typeof TABS)[number];
const TAB_ICONS: Record<Tab, IconName> = { stories: "book", itineraries: "sparkles", saved: "bookmark" };

function parseTab(value: string | null): Tab {
  return TABS.find((tab) => tab === value) ?? "stories";
}

export function ProfileView() {
  const t = useTranslations("Profile");
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    apiFetch<ProfileData>("/api/v1/users/me").then((result) => {
      if (cancelled) return;
      if (!("error" in result)) return setState({ status: "ready", profile: result.data });
      if (result.error === "UNAUTHORIZED") return router.replace("/login");
      setState({ status: "error" });
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (state.status === "loading") return <ProfileSkeleton />;
  if (state.status === "error") {
    return <p className="py-16 text-center text-body-md text-ink-soft">{t("loadError")}</p>;
  }

  function updateProfile(change: (profile: ProfileData) => ProfileData) {
    setState((current) => (current.status === "ready" ? { status: "ready", profile: change(current.profile) } : current));
  }

  return (
    <Profile
      profile={state.profile}
      onUserChange={(user) => updateProfile((profile) => ({ ...profile, user }))}
      onStoryHiddenChange={(id, hidden) =>
        updateProfile((profile) => ({
          ...profile,
          stories: profile.stories.map((story) => (story.id === id ? { ...story, is_hidden: hidden } : story)),
        }))
      }
      onStoryDeleted={(id) =>
        updateProfile((profile) => ({
          ...profile,
          stories: profile.stories.filter((story) => story.id !== id),
          storyCount: profile.storyCount - 1,
        }))
      }
    />
  );
}

type StoryActions = {
  onStoryHiddenChange: (id: number, hidden: boolean) => void;
  onStoryDeleted: (id: number) => void;
};

function Profile({
  profile,
  onUserChange,
  onStoryHiddenChange,
  onStoryDeleted,
}: { profile: ProfileData; onUserChange: (user: EditableProfile) => void } & StoryActions) {
  const t = useTranslations("Profile");
  const format = useFormatter();
  const searchParams = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<Tab>(() => parseTab(searchParams.get("tab")));
  const [trips, setTrips] = useState<TripsState>("loading");

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ trips: TripSummary[] }>("/api/v1/trips").then((result) => {
      if (!cancelled) setTrips("error" in result ? "error" : result.data.trips);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const { user } = profile;

  function applyUser(updated: EditableProfile) {
    onUserChange(updated);
    updateSessionUser({
      id: updated.id,
      username: updated.username,
      display_name: updated.display_name,
      avatar_url: updated.avatar_url,
      avatar_seed: updated.avatar_seed,
      avatar_background_color: updated.avatar_background_color,
      role: updated.role,
    });
  }

  function handleSaved(updated: EditableProfile) {
    applyUser(updated);
    setEditing(false);
    setSaved(true);
  }

  return (
    <div className="flex flex-col gap-10">
      <ProfileHeader
        user={user}
        action={
          !editing && (
            <Button
              variant="secondary"
              size="sm"
              className="w-fit"
              onClick={() => {
                setSaved(false);
                setEditing(true);
              }}
            >
              <Icon name="edit" className="size-4" />
              {t("edit")}
            </Button>
          )
        }
      >
        <ProfileStats>
          <ProfileStat label={t("stats.location")} icon="pin">
            {user.location ?? t("noLocation")}
          </ProfileStat>
          <ProfileStat label={t("stats.stories")} icon="book">
            {t("stats.storiesValue", { count: profile.storyCount })}
          </ProfileStat>
          <ProfileStat label={t("stats.memberSince")} icon="calendar">
            {format.dateTime(new Date(user.created_at), { month: "long", year: "numeric" })}
          </ProfileStat>
        </ProfileStats>
      </ProfileHeader>

      <ProfileBadgePicker onChange={(badge) => applyUser({ ...user, badge })} />

      {saved && (
        <p role="status" className="-mt-6 text-body-md text-ink-soft">
          {t("form.saved")}
        </p>
      )}

      {editing && (
        <>
          <ProfileEditForm user={user} onSaved={handleSaved} onImageChange={applyUser} onCancel={() => setEditing(false)} />
          <DeleteAccountSection />
        </>
      )}

      <section className="flex flex-col gap-6">
        <div
          role="tablist"
          aria-label={t("tabsLabel")}
          className={PROFILE_TABS_CLASS_NAME}
        >
          {TABS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`profile-tab-${key}`}
              aria-selected={tab === key}
              aria-controls="profile-tabpanel"
              onClick={() => setTab(key)}
              className={profileTabClassName(tab === key)}
            >
              <Icon name={TAB_ICONS[key]} className={`size-4 ${tab === key ? "text-accent" : ""}`} />
              {t(`tabs.${key}`)}
              {key === "stories" && <span className="text-label-sm text-ink-soft/70">{profile.storyCount}</span>}
              {key === "saved" && <span className="text-label-sm text-ink-soft/70">{profile.saved.length}</span>}
              {key === "itineraries" && Array.isArray(trips) && (
                <span className="text-label-sm text-ink-soft/70">{trips.length}</span>
              )}
            </button>
          ))}
        </div>

        <div role="tabpanel" id="profile-tabpanel" aria-labelledby={`profile-tab-${tab}`}>
          {tab === "stories" && (
            <StoriesGrid
              stories={profile.stories}
              onStoryHiddenChange={onStoryHiddenChange}
              onStoryDeleted={onStoryDeleted}
            />
          )}
          {tab === "itineraries" && <ItinerariesTab trips={trips} />}
          {tab === "saved" &&
            (profile.saved.length === 0 ? (
              <EmptyState>{t("empty.saved")}</EmptyState>
            ) : (
              <StoryGrid>
                {profile.saved.map((story) => (
                  <li key={story.id}>
                    <StoryCard story={story} />
                  </li>
                ))}
              </StoryGrid>
            ))}
        </div>
      </section>
    </div>
  );
}


function StoriesGrid({ stories, ...actions }: { stories: Story[] } & StoryActions) {
  const t = useTranslations("Profile");

  if (stories.length === 0) return <EmptyState>{t("empty.stories")}</EmptyState>;

  return (
    <StoryGrid>
      {stories.map((story) => (
        <ProfileStory key={story.id} story={story} {...actions} />
      ))}
    </StoryGrid>
  );
}

const STORY_ERRORS = ["NOT_FOUND", "PENDING_REVIEW", "TOO_MANY_REQUESTS", "INTERNAL_ERROR"] as const;
type StoryError = (typeof STORY_ERRORS)[number];

function ProfileStory({ story, onStoryHiddenChange, onStoryDeleted }: { story: Story } & StoryActions) {
  const t = useTranslations("Profile");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<StoryError | null>(null);
  const titleId = storyTitleId(story.id);

  function handleError(code: string) {
    if (code === "UNAUTHORIZED") return router.replace("/login");
    setError(STORY_ERRORS.find((known) => known === code) ?? "INTERNAL_ERROR");
  }

  async function toggleHidden() {
    setPending(true);
    setError(null);
    const result = await apiFetch<{ id: number; hidden: boolean }>(`/api/v1/posts/${story.id}`, {
      method: "PATCH",
      body: { hidden: !story.is_hidden },
    });
    setPending(false);

    if ("error" in result) return handleError(result.error);
    onStoryHiddenChange(story.id, result.data.hidden);
  }

  async function remove() {
    setPending(true);
    setError(null);
    const result = await apiFetch<null>(`/api/v1/posts/${story.id}`, { method: "DELETE" });
    setPending(false);

    // Déjà supprimé ailleurs : on le retire aussi de la grille.
    if ("error" in result && result.error !== "NOT_FOUND") return handleError(result.error);
    onStoryDeleted(story.id);
  }

  return (
    <li>
      <StoryCard
        story={story}
        hidden={story.is_hidden}
        pendingReview={story.pending_review}
        actions={
          <>
            {confirmingDelete ? (
              <>
                <p className="w-full text-body-sm text-ink">{t("stories.confirmDelete")}</p>
                <Button size="sm" variant="danger" disabled={pending} onClick={remove} aria-describedby={titleId}>
                  {t("stories.confirmDeleteYes")}
                </Button>
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => setConfirmingDelete(false)}>
                  {t("form.cancel")}
                </Button>
              </>
            ) : (
              <>
                {/* En attente de modération : seul un admin peut le publier. */}
                {!story.pending_review && (
                  <Button size="sm" variant="secondary" disabled={pending} onClick={toggleHidden} aria-describedby={titleId}>
                    <Icon name={story.is_hidden ? "visibility" : "visibilityOff"} className="size-4" />
                    {story.is_hidden ? t("stories.show") : t("stories.hide")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => {
                    setError(null);
                    setConfirmingDelete(true);
                  }}
                  aria-describedby={titleId}
                >
                  <Icon name="delete" className="size-4 text-error" />
                  {t("stories.delete")}
                </Button>
              </>
            )}
            <p role="status" aria-live="polite" className="w-full text-body-sm text-error empty:hidden">
              {error && t(`errors.${error}`)}
            </p>
          </>
        }
      />
    </li>
  );
}

type TripsState = "loading" | "error" | TripSummary[];

function ItinerariesTab({ trips }: { trips: TripsState }) {
  const t = useTranslations("Profile");

  if (trips === "loading") {
    return (
      <div aria-hidden="true" className="grid gap-3 md:grid-cols-2">
        {[0, 1].map((index) => (
          <Card key={index} className="h-28 animate-pulse bg-surface-muted" />
        ))}
      </div>
    );
  }
  if (trips === "error") return <EmptyState>{t("itinerariesError")}</EmptyState>;
  if (trips.length === 0) {
    return (
      <EmptyState>
        {t("empty.itineraries")}
        <Link href="/planner" className={buttonClassName("sm", "mt-4")}>
          <Icon name="add" className="size-4" />
          {t("createItinerary")}
        </Link>
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Link href="/planner" className={buttonClassName("sm", "self-end")}>
        <Icon name="add" className="size-4" />
        {t("createItinerary")}
      </Link>
      <ul className="grid gap-3 md:grid-cols-2">
        {trips.map((trip) => (
          <li key={trip.id}>
            <TripCard trip={trip} />
          </li>
        ))}
      </ul>
    </div>
  );
}


function ProfileSkeleton() {
  return (
    <div aria-hidden="true" className="flex animate-pulse flex-col gap-10">
      <Card className="overflow-hidden">
        <div className="h-40 bg-surface-muted sm:h-56" />
        <div className="flex items-end gap-4 px-6 pb-6">
          <div className="-mt-12 size-28 rounded-xl bg-surface-muted ring-4 ring-surface" />
          <div className="h-6 w-48 rounded-lg bg-surface-muted" />
        </div>
      </Card>
      <div className="h-11 w-96 max-w-full rounded-lg bg-surface-muted" />
    </div>
  );
}
