/**
 * Colaboradores do GitHub, buscados da API pública (sem token - 60 req/h é
 * de sobra pra um cache que só refaz a cada poucas horas) e cacheados em
 * memória. Uma falha da API (rate limit, rede fora) nunca derruba a
 * landing - cai pro último cache bom, ou lista vazia se nunca buscou com
 * sucesso ainda.
 */

const REPO = "JefersonCruz/VILIGION";
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface Contributor {
  login: string;
  avatarUrl: string;
  htmlUrl: string;
  contributions: number;
}

interface GitHubContributorResponse {
  login: string;
  avatar_url: string;
  html_url: string;
  contributions: number;
  type: string;
}

let cache: { data: Contributor[]; fetchedAt: number } | null = null;
let inFlight: Promise<Contributor[]> | null = null;

async function fetchFromGitHub(): Promise<Contributor[]> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contributors?per_page=100`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "viligion-landing" },
  });
  if (!res.ok) throw new Error(`GitHub contributors: HTTP ${res.status}`);
  const body = (await res.json()) as GitHubContributorResponse[];
  return body
    .filter((c) => c.type === "User") // exclui bots (ex: dependabot)
    .map((c) => ({ login: c.login, avatarUrl: c.avatar_url, htmlUrl: c.html_url, contributions: c.contributions }));
}

function refreshInBackground(): void {
  if (inFlight) return;
  inFlight = fetchFromGitHub()
    .then((data) => {
      cache = { data, fetchedAt: Date.now() };
      return data;
    })
    .catch((err) => {
      console.error("[contributors] falha ao buscar do GitHub:", err instanceof Error ? err.message : err);
      return cache?.data ?? [];
    })
    .finally(() => {
      inFlight = null;
    });
}

/** Leitura síncrona do cache - nunca bloqueia o request da página. Dispara refresh em background se o cache estiver velho ou vazio. */
export function getContributors(): Contributor[] {
  if (!cache || Date.now() - cache.fetchedAt > REFRESH_INTERVAL_MS) refreshInBackground();
  return cache?.data ?? [];
}

/** Chamado uma vez no boot do servidor - esquenta o cache antes do primeiro visitante, sem atrasar o server.listen(). */
export async function warmupContributors(): Promise<void> {
  refreshInBackground();
  await inFlight;
}
