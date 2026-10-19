import "server-only";
import { DatabaseError } from "pg";
import { getDb } from "@/server/infra/db";

export type ArchetypeRow = {
  id: number;
  slug: string;
  label: string;
  description: string | null;
  is_active: boolean;
};

export type ArchetypeWithStats = ArchetypeRow & { post_count: number; created_at: string };

export type ArchetypeChanges = Partial<{ label: string; description: string | null; is_active: boolean }>;

export class ArchetypeTakenError extends Error {
  constructor() {
    super("archetype_taken");
  }
}

const COLUMNS = "id, slug, label, description, is_active";
// Noms de colonnes issus de cette liste, jamais de l'entrée utilisateur.
const EDITABLE_COLUMNS = ["label", "description", "is_active"] as const;
const UNIQUE_VIOLATION = "23505";

// Les plus utilisés d'abord (récits visibles), puis par ordre alphabétique.
export async function findActiveArchetypes(): Promise<ArchetypeRow[]> {
  const db = await getDb();
  const { rows } = await db.query<ArchetypeRow>(
    `select ${COLUMNS} from archetype
     where is_active
     order by (select count(*) from post p where p.archetype_id = archetype.id and not p.is_hidden) desc, lower(label)`,
  );
  return rows;
}

export async function findArchetypeBySlug(slug: string): Promise<ArchetypeRow | null> {
  const db = await getDb();
  const { rows } = await db.query<ArchetypeRow>(`select ${COLUMNS} from archetype where slug = $1`, [slug]);
  return rows[0] ?? null;
}

export async function findAllArchetypesWithStats(): Promise<ArchetypeWithStats[]> {
  const db = await getDb();
  const { rows } = await db.query<ArchetypeWithStats>(
    `select a.id, a.slug, a.label, a.description, a.is_active, a.created_at,
       (select count(*)::int from post p where p.archetype_id = a.id) as post_count
     from archetype a
     order by a.id`,
  );
  return rows;
}

export async function insertArchetype(archetype: { slug: string; label: string; description: string | null }) {
  const db = await getDb();
  try {
    const { rows } = await db.query<ArchetypeRow>(
      `insert into archetype (slug, label, description) values ($1, $2, $3) returning ${COLUMNS}`,
      [archetype.slug, archetype.label, archetype.description],
    );
    return rows[0];
  } catch (error) {
    if (error instanceof DatabaseError && error.code === UNIQUE_VIOLATION) throw new ArchetypeTakenError();
    throw error;
  }
}

export async function updateArchetype(id: number, changes: ArchetypeChanges): Promise<ArchetypeRow | null> {
  const entries = EDITABLE_COLUMNS.filter((column) => changes[column] !== undefined).map(
    (column) => [column, changes[column]] as const,
  );
  const db = await getDb();
  try {
    const { rows } = await db.query<ArchetypeRow>(
      `update archetype set ${entries.map(([column], index) => `${column} = $${index + 2}`).join(", ")}
       where id = $1 returning ${COLUMNS}`,
      [id, ...entries.map(([, value]) => value)],
    );
    return rows[0] ?? null;
  } catch (error) {
    if (error instanceof DatabaseError && error.code === UNIQUE_VIOLATION) throw new ArchetypeTakenError();
    throw error;
  }
}
