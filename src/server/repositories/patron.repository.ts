import "server-only";
import type { UserRole } from "@/lib/roles";
import { getDb } from "@/server/infra/db";

const PATRON_ROLE: UserRole = "patron";
const ADMIN_ROLE: UserRole = "admin";
const DEFAULT_ROLE: UserRole = "traveler";

export type PatronDonation = {
  bmcPaymentId: number;
  userId: string;
  amount: number;
  currency: string;
};

// Compte non banni uniquement : un compte banni ne reçoit pas de rôle.
export async function findActiveUserIdByEmail(email: string): Promise<string | null> {
  const db = await getDb();
  const { rows } = await db.query<{ id: string }>(
    "select id from users where email = $1 and banned_at is null",
    [email],
  );
  return rows[0]?.id ?? null;
}

export async function findUserEmail(userId: string): Promise<string | null> {
  const db = await getDb();
  const { rows } = await db.query<{ email: string | null }>("select email from users where id = $1", [userId]);
  return rows[0]?.email ?? null;
}

// Don + rôle dans une transaction. false : don déjà reçu (webhook renvoyé).
export async function recordDonationAndGrantPatron(donation: PatronDonation): Promise<boolean> {
  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query("begin");
    // Verrou : deux dons simultanés du même compte ne lisent pas le même rôle précédent.
    const { rows: users } = await client.query<{ role: UserRole }>(
      "select role from users where id = $1 for update",
      [donation.userId],
    );
    const currentRole = users[0]?.role;
    const promote = currentRole !== undefined && currentRole !== PATRON_ROLE && currentRole !== ADMIN_ROLE;

    const inserted = await client.query(
      `insert into patron_donation (bmc_payment_id, user_id, amount, currency, previous_role)
       values ($1, $2, $3, $4, $5)
       on conflict (bmc_payment_id) do nothing`,
      [donation.bmcPaymentId, donation.userId, donation.amount, donation.currency, promote ? currentRole : null],
    );
    if (inserted.rowCount === 0) {
      await client.query("rollback");
      return false;
    }

    if (promote) {
      await client.query("update users set role = $2 where id = $1", [donation.userId, PATRON_ROLE]);
    }
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// Remboursement : le rôle précédent est rendu s'il ne reste aucun don valide (et si le rôle est toujours « patron »).
// false : don inconnu ou déjà remboursé.
export async function refundDonationAndRevokePatron(bmcPaymentId: number): Promise<boolean> {
  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{ user_id: string | null }>(
      `update patron_donation set refunded_at = now()
       where bmc_payment_id = $1 and refunded_at is null
       returning user_id`,
      [bmcPaymentId],
    );
    if (rows.length === 0) {
      await client.query("rollback");
      return false;
    }
    // Compte supprimé depuis (don gardé sans lien, #112) : le remboursement est noté, il n'y a plus de rôle à rendre.
    const userId = rows[0].user_id;
    if (!userId) {
      await client.query("commit");
      return true;
    }

    await client.query("select 1 from users where id = $1 for update", [userId]);
    const { rows: remaining } = await client.query(
      "select 1 from patron_donation where user_id = $1 and refunded_at is null limit 1",
      [userId],
    );
    if (remaining.length === 0) {
      const { rows: first } = await client.query<{ previous_role: UserRole }>(
        `select previous_role from patron_donation
         where user_id = $1 and previous_role is not null order by id limit 1`,
        [userId],
      );
      await client.query("update users set role = $2 where id = $1 and role = $3", [
        userId,
        first[0]?.previous_role ?? DEFAULT_ROLE,
        PATRON_ROLE,
      ]);
    }
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
