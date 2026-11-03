#!/usr/bin/env node
/**
 * GitHub stats collector.
 *
 * Pulls everything about a GitHub user's repositories and writes it to
 * data/stats.json, plus two files that grow over time:
 *   data/history.json  – one snapshot per day (totals + per-repo stars/forks)
 *   data/traffic.json  – views/clones/referrers, accumulated beyond GitHub's 14-day window
 *
 * Runs with Node 18+ and no dependencies.
 *
 * Env:
 *   GH_TOKEN / GITHUB_TOKEN  token used for the API (required)
 *   GH_USER                  username (falls back to stats.config.json, then GITHUB_REPOSITORY_OWNER)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");

const config = await readJSON(path.join(ROOT, "stats.config.json"), {});
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const USER = process.env.GH_USER || config.username || process.env.GITHUB_REPOSITORY_OWNER;
const INCLUDE_PRIVATE = !!config.includePrivate;
const EXCLUDE = new Set((config.excludeRepos || []).map((s) => s.toLowerCase()));
const EXTRA_OWNERS = config.includeOrgRepos ? "OWNER, ORGANIZATION_MEMBER, COLLABORATOR" : "OWNER";
const MAX_STAR_PAGES = config.maxStargazerPagesPerRepo ?? 50; // 100 stars per page

if (!TOKEN) die("No token. Set GH_TOKEN or GITHUB_TOKEN.");
if (!USER) die("No username. Set it in stats.config.json.");

const API = "https://api.github.com";
const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "github-stats-dashboard",
};

// ───────────────────────── helpers ─────────────────────────
function die(msg) { console.error("✖ " + msg); process.exit(1); }
const log = (...a) => console.log("•", ...a);
async function readJSON(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}
async function writeJSON(file, obj, pretty = false) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(obj, null, pretty ? 2 : 0));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gql(query, variables = {}, attempt = 0) {
  const res = await fetch(`${API}/graphql`, { method: "POST", headers, body: JSON.stringify({ query, variables }) });
  if ((res.status === 502 || res.status === 503 || res.status === 403) && attempt < 4) {
    await sleep(2000 * (attempt + 1));
    return gql(query, variables, attempt + 1);
  }
  const body = await res.json();
  if (body.errors) {
    // Partial data is still useful (e.g. a single inaccessible field)
    const msg = body.errors.map((e) => e.message).join("; ");
    if (!body.data) throw new Error("GraphQL: " + msg);
    console.warn("! GraphQL warning:", msg);
  }
  return body.data;
}

/** REST GET. Returns null instead of throwing for 403/404 (e.g. traffic without push access). */
async function rest(p, attempt = 0) {
  const res = await fetch(p.startsWith("http") ? p : `${API}${p}`, { headers });
  if (res.status === 202 && attempt < 3) { await sleep(1500); return rest(p, attempt + 1); } // stats being computed
  if (res.status === 403 || res.status === 404 || res.status === 204) return null;
  if (!res.ok) { console.warn(`! ${res.status} on ${p}`); return null; }
  return res.json();
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// ───────────────────────── 1. profile + contributions ─────────────────────────
log(`Collecting stats for ${USER}`);
const profileQ = `
query($login:String!){
  user(login:$login){
    login name avatarUrl bio company location websiteUrl twitterUsername url createdAt
    followers{totalCount} following{totalCount}
    starredRepositories{totalCount}
    gists(privacy:PUBLIC){totalCount}
    organizations(first:30){nodes{login avatarUrl url}}
    pinnedItems(first:6,types:REPOSITORY){nodes{... on Repository{name}}}
    repositoriesContributedTo(contributionTypes:[COMMIT,PULL_REQUEST,ISSUE]){totalCount}
    pullRequests{totalCount}
    mergedPRs: pullRequests(states:MERGED){totalCount}
    issues{totalCount}
    contributionsCollection{
      contributionYears
      totalCommitContributions totalIssueContributions totalPullRequestContributions
      totalPullRequestReviewContributions totalRepositoryContributions restrictedContributionsCount
      contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount weekday } } }
    }
  }
}`;
const { user } = await gql(profileQ, { login: USER });
if (!user) die(`User ${USER} not found`);

const cc = user.contributionsCollection;
const years = cc.contributionYears || [];
const yearly = [];
for (const y of years) {
  const d = await gql(
    `query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){
      contributionCalendar{totalContributions} totalCommitContributions totalPullRequestContributions totalIssueContributions totalRepositoryContributions}}}`,
    { login: USER, from: `${y}-01-01T00:00:00Z`, to: `${y}-12-31T23:59:59Z` }
  );
  const c = d.user.contributionsCollection;
  yearly.push({
    year: y,
    total: c.contributionCalendar.totalContributions,
    commits: c.totalCommitContributions,
    prs: c.totalPullRequestContributions,
    issues: c.totalIssueContributions,
    repos: c.totalRepositoryContributions,
  });
}
yearly.sort((a, b) => a.year - b.year);

// ───────────────────────── 2. repositories ─────────────────────────
const repoQ = `
query($login:String!,$after:String,$privacy:RepositoryPrivacy){
  user(login:$login){
    repositories(first:50,after:$after,privacy:$privacy,ownerAffiliations:[${EXTRA_OWNERS}],orderBy:{field:STARGAZERS,direction:DESC}){
      pageInfo{hasNextPage endCursor}
      nodes{
        name nameWithOwner owner{login} description url homepageUrl
        isFork isArchived isPrivate isTemplate isMirror isDisabled
        stargazerCount forkCount diskUsage
        watchers{totalCount}
        openIssues: issues(states:OPEN){totalCount}
        closedIssues: issues(states:CLOSED){totalCount}
        openPRs: pullRequests(states:OPEN){totalCount}
        mergedPRs: pullRequests(states:MERGED){totalCount}
        closedPRs: pullRequests(states:CLOSED){totalCount}
        primaryLanguage{name color}
        languages(first:15,orderBy:{field:SIZE,direction:DESC}){totalSize edges{size node{name color}}}
        repositoryTopics(first:20){nodes{topic{name}}}
        licenseInfo{spdxId name}
        createdAt updatedAt pushedAt archivedAt
        releases{totalCount}
        latestRelease{tagName name publishedAt url}
        tags: refs(refPrefix:"refs/tags/"){totalCount}
        branches: refs(refPrefix:"refs/heads/"){totalCount}
        discussions{totalCount}
        deployments{totalCount}
        parent{nameWithOwner url}
        defaultBranchRef{name target{... on Commit{history{totalCount} committedDate}}}
      }
    }
  }
}`;
const repos = [];
let after = null;
do {
  const d = await gql(repoQ, { login: USER, after, privacy: INCLUDE_PRIVATE ? null : "PUBLIC" });
  const r = d.user.repositories;
  repos.push(...r.nodes.filter(Boolean));
  after = r.pageInfo.hasNextPage ? r.pageInfo.endCursor : null;
  log(`repos: ${repos.length}`);
} while (after);

const kept = repos.filter((r) => !EXCLUDE.has(r.name.toLowerCase()) && !EXCLUDE.has(r.nameWithOwner.toLowerCase()));

// ───────────────────────── 3. per-repo extras ─────────────────────────
const prevTraffic = await readJSON(path.join(DATA, "traffic.json"), { repos: {} });
let trafficAvailable = false;

const starQ = `
query($owner:String!,$name:String!,$after:String){
  repository(owner:$owner,name:$name){
    stargazers(first:100,after:$after,orderBy:{field:STARRED_AT,direction:ASC}){
      pageInfo{hasNextPage endCursor} edges{starredAt}
    }
  }
}`;

const enriched = await pool(kept, 4, async (r) => {
  const owner = r.owner.login, name = r.name, full = `${owner}/${name}`;

  // Star timeline (dates each star was given) → aggregate per day to keep the file small
  const starDays = {};
  if (r.stargazerCount > 0) {
    let cur = null, pages = 0;
    do {
      const d = await gql(starQ, { owner, name, after: cur });
      const sg = d?.repository?.stargazers;
      if (!sg) break;
      for (const e of sg.edges) { const day = e.starredAt.slice(0, 10); starDays[day] = (starDays[day] || 0) + 1; }
      cur = sg.pageInfo.hasNextPage ? sg.pageInfo.endCursor : null;
    } while (cur && ++pages < MAX_STAR_PAGES);
  }

  // Release asset downloads
  let downloads = 0;
  const releaseList = [];
  if (r.releases.totalCount > 0) {
    for (let page = 1; page <= 10; page++) {
      const rel = await rest(`/repos/${full}/releases?per_page=100&page=${page}`);
      if (!rel || !rel.length) break;
      for (const x of rel) {
        const dl = (x.assets || []).reduce((s, a) => s + (a.download_count || 0), 0);
        downloads += dl;
        releaseList.push({ tag: x.tag_name, name: x.name, date: x.published_at, downloads: dl, prerelease: x.prerelease });
      }
      if (rel.length < 100) break;
    }
  }

  // Traffic (needs push access → a personal access token; silently skipped otherwise)
  let traffic = null;
  if (!r.isArchived || config.trafficForArchived) {
    const [views, clones, refs, paths] = await Promise.all([
      rest(`/repos/${full}/traffic/views`),
      rest(`/repos/${full}/traffic/clones`),
      rest(`/repos/${full}/traffic/popular/referrers`),
      rest(`/repos/${full}/traffic/popular/paths`),
    ]);
    if (views || clones) {
      trafficAvailable = true;
      traffic = { views, clones, refs, paths };
    }
  }

  // Weekly commit activity for the last year (REST stats; may be empty on first request)
  const participation = await rest(`/repos/${full}/stats/participation`);

  const totalLang = r.languages.totalSize || 0;
  return {
    name, full, owner, description: r.description, url: r.url, homepage: r.homepageUrl || null,
    fork: r.isFork, archived: r.isArchived, private: r.isPrivate, template: r.isTemplate, mirror: r.isMirror,
    parent: r.parent?.nameWithOwner || null,
    stars: r.stargazerCount, forks: r.forkCount, watchers: r.watchers.totalCount,
    issuesOpen: r.openIssues.totalCount, issuesClosed: r.closedIssues.totalCount,
    prsOpen: r.openPRs.totalCount, prsMerged: r.mergedPRs.totalCount, prsClosed: r.closedPRs.totalCount,
    sizeKB: r.diskUsage || 0,
    language: r.primaryLanguage?.name || null, languageColor: r.primaryLanguage?.color || null,
    languages: r.languages.edges.map((e) => ({ name: e.node.name, color: e.node.color, bytes: e.size, pct: totalLang ? +(100 * e.size / totalLang).toFixed(2) : 0 })),
    topics: r.repositoryTopics.nodes.map((n) => n.topic.name),
    license: r.licenseInfo?.spdxId && r.licenseInfo.spdxId !== "NOASSERTION" ? r.licenseInfo.spdxId : (r.licenseInfo?.name || null),
    created: r.createdAt, updated: r.updatedAt, pushed: r.pushedAt, archivedAt: r.archivedAt,
    commits: r.defaultBranchRef?.target?.history?.totalCount ?? 0,
    lastCommit: r.defaultBranchRef?.target?.committedDate || null,
    defaultBranch: r.defaultBranchRef?.name || null,
    branches: r.branches.totalCount, tags: r.tags.totalCount,
    releases: r.releases.totalCount, latestRelease: r.latestRelease ? { tag: r.latestRelease.tagName, date: r.latestRelease.publishedAt, url: r.latestRelease.url } : null,
    releaseList: releaseList.slice(0, 30), downloads,
    discussions: r.discussions.totalCount, deployments: r.deployments.totalCount,
    starDays,
    weeklyCommits: participation?.owner || null,
    _traffic: traffic,
  };
});
log(`enriched ${enriched.length} repos`);

// ───────────────────────── 4. traffic accumulation ─────────────────────────
// GitHub only keeps 14 days of traffic, so we merge each run into data/traffic.json.
const traffic = { updated: new Date().toISOString(), repos: prevTraffic.repos || {} };
for (const r of enriched) {
  const t = r._traffic; delete r._traffic;
  if (!t) continue;
  const slot = (traffic.repos[r.full] ||= { views: {}, clones: {}, referrers: [], paths: [] });
  for (const v of t.views?.views || []) slot.views[v.timestamp.slice(0, 10)] = [v.count, v.uniques];
  for (const c of t.clones?.clones || []) slot.clones[c.timestamp.slice(0, 10)] = [c.count, c.uniques];
  if (t.refs) slot.referrers = t.refs.map((x) => ({ ref: x.referrer, count: x.count, uniques: x.uniques }));
  if (t.paths) slot.paths = t.paths.slice(0, 10).map((x) => ({ path: x.path, title: x.title, count: x.count, uniques: x.uniques }));
}
// Per-repo traffic totals onto the repo objects for the table
for (const r of enriched) {
  const s = traffic.repos[r.full];
  const sum = (o, i) => Object.values(o || {}).reduce((a, v) => a + v[i], 0);
  r.views = s ? sum(s.views, 0) : null;
  r.clones = s ? sum(s.clones, 0) : null;
}

// ───────────────────────── 5. totals & snapshot ─────────────────────────
const sum = (arr, k) => arr.reduce((a, r) => a + (r[k] || 0), 0);
const own = enriched.filter((r) => !r.fork);
const langBytes = {};
for (const r of own) for (const l of r.languages) {
  (langBytes[l.name] ||= { name: l.name, color: l.color, bytes: 0, repos: 0 });
  langBytes[l.name].bytes += l.bytes;
}
for (const r of own) if (r.language && langBytes[r.language]) langBytes[r.language].repos++;
const licenses = {};
for (const r of own) { const k = r.license || "None"; licenses[k] = (licenses[k] || 0) + 1; }
const topics = {};
for (const r of own) for (const t of r.topics) topics[t] = (topics[t] || 0) + 1;

const totals = {
  repos: enriched.length,
  sources: own.length,
  forksOwned: enriched.filter((r) => r.fork).length,
  archived: enriched.filter((r) => r.archived).length,
  templates: enriched.filter((r) => r.template).length,
  private: enriched.filter((r) => r.private).length,
  stars: sum(enriched, "stars"),
  starsOnSources: sum(own, "stars"),
  forks: sum(enriched, "forks"),
  watchers: sum(enriched, "watchers"),
  issuesOpen: sum(enriched, "issuesOpen"),
  issuesClosed: sum(enriched, "issuesClosed"),
  prsOpen: sum(enriched, "prsOpen"),
  prsMerged: sum(enriched, "prsMerged"),
  commits: sum(own, "commits"),
  releases: sum(enriched, "releases"),
  downloads: sum(enriched, "downloads"),
  sizeKB: sum(enriched, "sizeKB"),
  views: trafficAvailable ? sum(enriched, "views") : null,
  clones: trafficAvailable ? sum(enriched, "clones") : null,
  languages: Object.keys(langBytes).length,
};

const today = new Date().toISOString().slice(0, 10);
const stats = {
  generated: new Date().toISOString(),
  trafficAvailable,
  profile: {
    login: user.login, name: user.name, avatar: user.avatarUrl, bio: user.bio, company: user.company,
    location: user.location, website: user.websiteUrl, twitter: user.twitterUsername, url: user.url,
    created: user.createdAt,
    followers: user.followers.totalCount, following: user.following.totalCount,
    starred: user.starredRepositories.totalCount, gists: user.gists.totalCount,
    orgs: user.organizations.nodes,
    pinned: user.pinnedItems.nodes.map((n) => n.name),
    contributedTo: user.repositoriesContributedTo.totalCount,
    prsAuthored: user.pullRequests.totalCount, prsAuthoredMerged: user.mergedPRs.totalCount,
    issuesAuthored: user.issues.totalCount,
  },
  contributions: {
    lastYear: {
      total: cc.contributionCalendar.totalContributions,
      commits: cc.totalCommitContributions, prs: cc.totalPullRequestContributions,
      reviews: cc.totalPullRequestReviewContributions, issues: cc.totalIssueContributions,
      repos: cc.totalRepositoryContributions, private: cc.restrictedContributionsCount,
    },
    calendar: cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays.map((d) => [d.date, d.contributionCount])),
    yearly,
  },
  totals,
  languages: Object.values(langBytes).sort((a, b) => b.bytes - a.bytes),
  licenses, topics,
  repos: enriched,
};

const history = await readJSON(path.join(DATA, "history.json"), []);
const snap = {
  d: today, stars: totals.stars, forks: totals.forks, watchers: totals.watchers,
  followers: stats.profile.followers, repos: totals.repos, downloads: totals.downloads,
  r: Object.fromEntries(enriched.map((x) => [x.name, [x.stars, x.forks]])),
};
const idx = history.findIndex((h) => h.d === today);
if (idx >= 0) history[idx] = snap; else history.push(snap);

await writeJSON(path.join(DATA, "stats.json"), stats);
await writeJSON(path.join(DATA, "history.json"), history);
await writeJSON(path.join(DATA, "traffic.json"), traffic);
log(`Done: ${totals.repos} repos, ${totals.stars} stars, ${totals.forks} forks${trafficAvailable ? "" : " (no traffic access — add a STATS_TOKEN secret for views/clones)"}`);
