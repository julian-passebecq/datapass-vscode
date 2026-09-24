/**
 * Recovery journal for accepting several staged files. Multi-file writes are not atomic;
 * the journal makes partial application visible and recoverable instead of silent.
 */
import { sha256Bytes } from "../model/ids";

export interface JournalFs {
  read(path: string): Promise<Uint8Array | undefined>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface JournalEntry {
  target: string;
  expectedBaseHash: string | null; // null means "file must not exist"
  newHash: string;
  backup: string | null;
  state: "pending" | "backed-up" | "written" | "verified" | "rolled-back";
}

export interface Journal {
  id: string;
  createdAt: string;
  state: "open" | "committed" | "partial" | "rolled-back";
  entries: JournalEntry[];
}

export interface PlannedWrite { target: string; bytes: Uint8Array; expectedBaseHash: string | null }

const enc = (j: Journal) => new TextEncoder().encode(JSON.stringify(j, null, 2));

export async function applyWithJournal(fs: JournalFs, journalPath: string, id: string, now: string, writes: PlannedWrite[]): Promise<Journal> {
  const journal: Journal = {
    id, createdAt: now, state: "open",
    entries: writes.map(w => ({ target: w.target, expectedBaseHash: w.expectedBaseHash, newHash: sha256Bytes(w.bytes).value, backup: null, state: "pending" }))
  };
  // Revalidate every base before writing anything: approval attaches to the exact base.
  for (const w of writes) {
    const current = await fs.read(w.target);
    const currentHash = current ? sha256Bytes(current).value : null;
    if (currentHash !== w.expectedBaseHash) {
      throw new Error(`Base changed since review: ${w.target}. Nothing was written.`);
    }
  }
  await fs.write(journalPath, enc(journal));
  try {
    for (let i = 0; i < writes.length; i++) {
      const w = writes[i]!, e = journal.entries[i]!;
      const current = await fs.read(w.target);
      if (current) {
        e.backup = `${journalPath}.${i}.bak`;
        await fs.write(e.backup, current);
      }
      e.state = "backed-up";
      await fs.write(journalPath, enc(journal));
      await fs.write(w.target, w.bytes);
      e.state = "written";
      const check = await fs.read(w.target);
      if (!check || sha256Bytes(check).value !== e.newHash) throw new Error(`Read-back mismatch: ${w.target}`);
      e.state = "verified";
      await fs.write(journalPath, enc(journal));
    }
    journal.state = "committed";
  } catch (error) {
    journal.state = "partial";
    await fs.write(journalPath, enc(journal));
    throw Object.assign(new Error(`Partial application; journal at ${journalPath}: ${error instanceof Error ? error.message : String(error)}`), { journal });
  }
  await fs.write(journalPath, enc(journal));
  return journal;
}

/** Restore backups for every entry that was touched. Files created fresh are removed. */
export async function rollbackJournal(fs: JournalFs, journalPath: string): Promise<Journal> {
  const raw = await fs.read(journalPath);
  if (!raw) throw new Error("No journal to roll back");
  const journal = JSON.parse(new TextDecoder().decode(raw)) as Journal;
  for (const e of [...journal.entries].reverse()) {
    if (e.state === "pending") continue;
    if (e.backup) {
      const bak = await fs.read(e.backup);
      if (!bak) throw new Error(`Backup missing for ${e.target}; manual recovery needed`);
      await fs.write(e.target, bak);
    } else if (e.expectedBaseHash === null) {
      // Created by this journal (possibly interrupted right after the write): remove it.
      if (await fs.read(e.target)) await fs.remove(e.target);
    }
    e.state = "rolled-back";
  }
  journal.state = "rolled-back";
  await fs.write(journalPath, enc(journal));
  return journal;
}
