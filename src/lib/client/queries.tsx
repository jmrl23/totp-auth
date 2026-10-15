"use client";
/**
 * TanStack Query layer: provider, session, decrypted vault and optimistic mutations.
 * Decrypted entries live only in the in-memory query cache and are dropped on lock/sign-out.
 */
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MAX_IMPORT_BATCH, type EntryPlain, type SessionResponse, type VaultEntry } from "@/lib/schemas";
import { ApiError, api, isApiError } from "./api";
import { getUnlockedUserId, getVaultKey, setSessionLoader, useLockState } from "./lock-state";
import { onSessionEvent } from "./session-events";
import { decryptEntry, encryptEntry } from "./vault-crypto";

export const sessionQueryKey = ["session"] as const;
export const vaultQueryKey = ["vault"] as const;

export type VaultData = { entries: VaultEntry[]; undecryptable: number };

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Issuer, then label, case-insensitive. Returns a new array. */
export function sortEntries<T extends Pick<EntryPlain, "issuer" | "label">>(entries: T[]): T[] {
  return [...entries].sort((a, b) => collator.compare(a.issuer, b.issuer) || collator.compare(a.label, b.label));
}

async function fetchSession(signal?: AbortSignal): Promise<SessionResponse | null> {
  try {
    return await api.getSession(signal);
  } catch (error) {
    if (isApiError(error) && error.status === 401) return null;
    throw error;
  }
}

function lockedError(): ApiError {
  return new ApiError(0, "unauthorized", "The vault is locked. Unlock it to continue.");
}

function requireKey(): CryptoKey {
  const key = getVaultKey();
  if (!key) throw lockedError();
  return key;
}

async function fetchVault(signal?: AbortSignal): Promise<VaultData> {
  const key = requireKey();
  const { entries } = await api.getVault(signal);
  const results = await Promise.all(
    entries.map(async (row): Promise<VaultEntry | null> => {
      try {
        const plain = await decryptEntry(key, row.id, row);
        return { ...plain, id: row.id, updatedAt: row.updatedAt };
      } catch {
        return null;
      }
    }),
  );
  const ok = results.filter((e): e is VaultEntry => e !== null);
  return { entries: sortEntries(ok), undecryptable: results.length - ok.length };
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: (failureCount, error) => isApiError(error) && error.code === "network" && failureCount < 3,
      },
      mutations: { retry: false },
    },
  });
}

function wireClient(client: QueryClient): void {
  setSessionLoader(() =>
    client.fetchQuery({ queryKey: sessionQueryKey, queryFn: ({ signal }) => fetchSession(signal), staleTime: 5_000 }),
  );
  onSessionEvent((event) => {
    if (event === "signed-out") {
      client.removeQueries({ queryKey: vaultQueryKey });
      client.setQueryData(sessionQueryKey, null);
    } else if (event === "locked") {
      client.removeQueries({ queryKey: vaultQueryKey });
    } else if (event === "session-changed") {
      void client.invalidateQueries({ queryKey: sessionQueryKey });
      void client.invalidateQueries({ queryKey: vaultQueryKey });
    }
  });
}

let browserClient: QueryClient | undefined;

/** One client per browser tab (wired to lock/sign-out events); a fresh one per server render. */
function getQueryClient(): QueryClient {
  if (typeof window === "undefined") return makeQueryClient();
  if (!browserClient) {
    browserClient = makeQueryClient();
    wireClient(browserClient);
  }
  return browserClient;
}

/** Wrap the app once (client component). */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(getQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Current session; `data` is null when signed out (401). */
export function useSession() {
  return useQuery({ queryKey: sessionQueryKey, queryFn: ({ signal }) => fetchSession(signal) });
}

/** Decrypted, sorted vault. Entries that fail to decrypt are skipped and counted in `undecryptable`. */
export function useVault(): {
  entries: VaultEntry[];
  undecryptable: number;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const lockState = useLockState();
  const userId = lockState === "unlocked" ? getUnlockedUserId() : null;
  const query = useQuery({
    queryKey: [...vaultQueryKey, userId],
    queryFn: ({ signal }) => fetchVault(signal),
    enabled: lockState === "unlocked" && userId !== null,
  });
  return {
    entries: query.data?.entries ?? EMPTY,
    undecryptable: query.data?.undecryptable ?? 0,
    isLoading: lockState === "checking" || (lockState === "unlocked" && query.isPending),
    error: query.error,
    refetch: () => void query.refetch(),
  };
}
const EMPTY: VaultEntry[] = [];

type Snapshot = [readonly unknown[], VaultData | undefined][];

function useVaultCache() {
  const client = useQueryClient();
  const snapshot = async (): Promise<Snapshot> => {
    await client.cancelQueries({ queryKey: vaultQueryKey });
    return client.getQueriesData<VaultData>({ queryKey: vaultQueryKey });
  };
  const apply = (fn: (data: VaultData) => VaultData) =>
    client.setQueriesData<VaultData>({ queryKey: vaultQueryKey }, (old) => (old ? fn(old) : old));
  const rollback = (snap: Snapshot | undefined) => {
    for (const [key, data] of snap ?? []) client.setQueryData(key, data);
  };
  const invalidate = () => client.invalidateQueries({ queryKey: vaultQueryKey });
  return { snapshot, apply, rollback, invalidate };
}

function newEntryId(): string {
  return crypto.randomUUID();
}

/** Ids for in-flight adds: onMutate runs before mutationFn, so both see the same id. */
const pendingAddIds = new WeakMap<EntryPlain, string>();
function idFor(plain: EntryPlain): string {
  let id = pendingAddIds.get(plain);
  if (!id) {
    id = newEntryId();
    pendingAddIds.set(plain, id);
  }
  return id;
}

/** mutate(plain) -> encrypts with a new UUID and creates it; optimistic insert. Resolves the new VaultEntry. */
export function useAddEntry() {
  const cache = useVaultCache();
  return useMutation({
    mutationFn: async (input: EntryPlain): Promise<VaultEntry> => {
      const id = idFor(input);
      const plain = pickPlain(input);
      const enc = await encryptEntry(requireKey(), id, plain);
      const { entry } = await api.createEntry(enc);
      return { ...plain, id, updatedAt: entry.updatedAt };
    },
    onMutate: async (input) => {
      const id = idFor(input);
      const snap = await cache.snapshot();
      cache.apply((d) => ({
        ...d,
        entries: sortEntries([...d.entries, { ...pickPlain(input), id, updatedAt: new Date().toISOString() }]),
      }));
      return snap;
    },
    onError: (_e, _v, snap) => cache.rollback(snap),
    onSettled: (_d, _e, input) => {
      pendingAddIds.delete(input);
      return cache.invalidate();
    },
  });
}

/** mutate({ id, plain }) -> re-encrypts and replaces the entry; optimistic update. */
export function useUpdateEntry() {
  const cache = useVaultCache();
  return useMutation({
    mutationFn: async ({ id, plain: input }: { id: string; plain: EntryPlain }): Promise<VaultEntry> => {
      const plain = pickPlain(input);
      const enc = await encryptEntry(requireKey(), id, plain);
      const { entry } = await api.updateEntry(id, { ciphertext: enc.ciphertext, iv: enc.iv });
      return { ...plain, id, updatedAt: entry.updatedAt };
    },
    onMutate: async ({ id, plain: input }) => {
      const snap = await cache.snapshot();
      const plain = pickPlain(input);
      cache.apply((d) => ({
        ...d,
        entries: sortEntries(
          d.entries.map((e) => (e.id === id ? { ...plain, id, updatedAt: new Date().toISOString() } : e)),
        ),
      }));
      return snap;
    },
    onError: (_e, _v, snap) => cache.rollback(snap),
    onSettled: () => cache.invalidate(),
  });
}

/** mutate(id) -> deletes the entry; optimistic removal. */
export function useDeleteEntry() {
  const cache = useVaultCache();
  return useMutation({
    mutationFn: (id: string) => api.deleteEntry(id),
    onMutate: async (id) => {
      const snap = await cache.snapshot();
      cache.apply((d) => ({ ...d, entries: d.entries.filter((e) => e.id !== id) }));
      return snap;
    },
    onError: (_e, _v, snap) => cache.rollback(snap),
    onSettled: () => cache.invalidate(),
  });
}

/** mutate(entries) -> encrypts each with a new UUID and uploads in chunks of MAX_IMPORT_BATCH. Resolves { created }. */
export function useImportEntries() {
  const cache = useVaultCache();
  return useMutation({
    mutationFn: async (entries: EntryPlain[]): Promise<{ created: number }> => {
      const key = requireKey();
      const encrypted = await Promise.all(entries.map((plain) => encryptEntry(key, newEntryId(), plain)));
      let created = 0;
      for (let i = 0; i < encrypted.length; i += MAX_IMPORT_BATCH) {
        const res = await api.importEntries({ entries: encrypted.slice(i, i + MAX_IMPORT_BATCH) });
        created += res.created;
      }
      return { created };
    },
    onSettled: () => cache.invalidate(),
  });
}

function pickPlain(e: EntryPlain): EntryPlain {
  return {
    issuer: e.issuer,
    label: e.label,
    secret: e.secret,
    algorithm: e.algorithm,
    digits: e.digits,
    period: e.period,
  };
}
