import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { Icon, type IconName } from "@/components/ui/Icon";
import type { TicketStatus } from "@/schemas/ticket.schema";

const ICONS: Record<TicketStatus, IconName> = { open: "flag", in_progress: "refresh", resolved: "check", closed: "lock" };

// État d'un ticket de support : page Support et administration.
export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  const t = useTranslations("TicketStatus");
  return (
    <Badge tone={status === "open" ? "accent" : "neutral"}>
      <Icon name={ICONS[status]} className="size-3.5" />
      {t(status)}
    </Badge>
  );
}
