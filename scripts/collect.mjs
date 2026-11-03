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
// Two possible tokens:
//  • GITHUB_TOKEN – built into every Actions run; reads all public data via GraphQL.
//  • STATS_TOKEN  – your personal access token; needed for traffic (views/clones).
// Fine-grained personal tokens can't read some user-level GraphQL fields, so GraphQL
// tries the built-in token first and REST tries the personal token first. Each call
// falls back to the other token when access is refused.
const PAT = process.env.STATS_TOKEN || process.env.GH_TOKEN || "";
const BUILTIN = process.env.GITHUB_TOKEN || "";
const GQL_TOKENS = [...new Set([BUILTIN, PAT].filter(Boolean))];
const REST_TOKENS = [...new Set([PAT, BUILTIN].filter(Boolean))];
const TOKEN = GQL_TOKENS[0];
const USER = process.env.GH_USER || config.username || process.env.GITHUB_REPOSITORY_OWNER;
const INCLUDE_PRIVATE = !!config.includePrivate;
const EXCLUDE = new Set((config.excludeRepos || []).map((s) => s.toLowerCase()));
const EXTRA_OWNERS = config.includeOrgRepos ? "OWNER, ORGANIZATION_MEMBER, COLLABORATOR" : "OWNER";
const MAX_STAR_PAGES = config.maxStargazerPagesPerRepo ?? 50; // 100 stars per page

if (!TOKEN) die("No token. Set GITHUB_TOKEN, STATS_TOKEN or GH_TOKEN.");
if (!USER) die("No username. Set it in stats.config.json.");

const API = process.env.GH_API_URL || "https://api.github.com";
const headersFor = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "github-stats-dashboard",
});

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

async function gqlOnce(token, query, variables, retries = 2) {
  let res, text;
  try {
    res = await fetch(`${API}/graphql`, { method: "POST", headers: headersFor(token), body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(60000) });
    text = await res.text();
  } catch (e) {
    res = { status: 0 }; text = "";
  }
  if (res.status === 401) return { errors: [{ message: "Bad credentials (token invalid or expired)", type: "FORBIDDEN" }] };
  let body = null;
  try { body = JSON.parse(text); } catch { /* GitHub sends an HTML page on timeouts/outages */ }
  const transient = !body || res.status >= 500 || res.status === 0 || (res.status === 403 && /rate limit|abuse|secondary/i.test(text));
  if (transient) {
    if (retries > 0) {
      await sleep(res.status === 403 ? 30000 : 3000);
      return gqlOnce(token, query, variables, retries - 1);
    }
    return { errors: [{ message: `GitHub did not answer in time (HTTP ${res.status || "network error"})`, type: "TIMEOUT" }] };
  }
  return body;
}

/**
 * GraphQL with token fallback. Returns { data, errors }; never throws for access errors,
 * so callers can treat a missing section as optional.
 */
async function gqlTry(query, variables = {}) {
  let last = null;
  for (const token of GQL_TOKENS) {
    const body = await gqlOnce(token, query, variables);
    if (!body.errors?.length) return { data: body.data, errors: null };
    last = body;
    const denied = body.errors.some((e) => e.type === "FORBIDDEN" || /not accessible|Bad credentials|permission/i.test(e.message));
    if (!denied) break; // a real error – another token won't help
  }
  return { data: last?.data ?? null, errors: last?.errors ?? [] };
}
const errText = (errors) => errors.map((e) => (e.path ? e.path.join(".") + ": " : "") + e.message).join("; ");

/** GraphQL that must succeed. */
async function gql(query, variables = {}) {
  const { data, errors } = await gqlTry(query, variables);
  if (errors?.length) {
    if (!data) throw new Error("GraphQL: " + errText(errors));
    console.warn("! GraphQL warning:", errText(errors));
  }
  return data;
}

/** GraphQL for an optional piece of data: returns fallback (and logs) if it can't be read. */
async function gqlOpt(label, query, variables, pick, fallback) {
  const { data, errors } = await gqlTry(query, variables);
  let v; try { v = pick(data); } catch { v = undefined; }
  if (v == null) { console.warn(`! Skipping ${label}: ${errors?.length ? errText(errors) : "no data"}`); return fallback; }
  return v;
}

/** REST GET. Returns null instead of throwing for 403/404 (e.g. traffic without push access). */
async function rest(p) {
  const url = p.startsWith("http") ? p : `${API}${p}`;
  for (const token of REST_TOKENS) {
    let res;
    for (let attempt = 0; attempt < 4; attempt++) {
      res = await fetch(url, { headers: headersFor(token) });
      if (res.status !== 202) break;
      await sleep(1500); // repo statistics are still being computed
    }
    if (res.status === 202 || res.status === 204) return null;
    if (res.status === 401 || res.status === 403 || res.status === 404) continue; // try the other token
    if (!res.ok) { console.warn(`! ${res.status} on ${p}`); return null; }
    return res.json();
  }
  return null;
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
log(`Tokens: ${BUILTIN ? "built-in" : ""}${BUILTIN && PAT ? " + " : ""}${PAT ? "personal (STATS_TOKEN)" : ""}`);
const V = { login: USER };
const cnt = (x) => x?.totalCount ?? 0;
const userPart = (fields) => `query($login:String!){user(login:$login){${fields}}}`;

// Core profile – GraphQL, falling back to the REST profile if GraphQL is refused
let user = await gqlOpt("profile (GraphQL)",
  userPart("login name avatarUrl bio company location websiteUrl twitterUsername url createdAt followers{totalCount} following{totalCount}"),
  V, (d) => d.user, null);
if (!user) {
  const u = await rest(`/users/${USER}`);
  if (!u) die(`Could not read the profile of "${USER}". Check the username in stats.config.json and that the token is valid.`);
  user = {
    login: u.login, name: u.name, avatarUrl: u.avatar_url, bio: u.bio, company: u.company, location: u.location,
    websiteUrl: u.blog, twitterUsername: u.twitter_username, url: u.html_url, createdAt: u.created_at,
    followers: { totalCount: u.followers }, following: { totalCount: u.following },
  };
}

// Optional extras – each read on its own, so one refused field can't break the rest
const extra = {
  starred: await gqlOpt("starred repos", userPart("starredRepositories{totalCount}"), V, (d) => d.user.starredRepositories.totalCount, 0),
  gists: await gqlOpt("gists", userPart("gists(privacy:PUBLIC){totalCount}"), V, (d) => d.user.gists.totalCount, 0),
  orgs: await gqlOpt("organizations", userPart("organizations(first:30){nodes{login avatarUrl url}}"), V, (d) => d.user.organizations.nodes, null),
  pinned: await gqlOpt("pinned repos", userPart("pinnedItems(first:6,types:REPOSITORY){nodes{... on Repository{name}}}"), V, (d) => d.user.pinnedItems.nodes.map((n) => n.name), []),
  contributedTo: await gqlOpt("contributed-to count", userPart("repositoriesContributedTo(contributionTypes:[COMMIT,PULL_REQUEST,ISSUE]){totalCount}"), V, (d) => d.user.repositoriesContributedTo.totalCount, 0),
  prs: await gqlOpt("pull request counts", userPart("pullRequests{totalCount} merged: pullRequests(states:MERGED){totalCount}"), V, (d) => [d.user.pullRequests.totalCount, d.user.merged.totalCount], [0, 0]),
  issues: await gqlOpt("issue count", userPart("issues{totalCount}"), V, (d) => d.user.issues.totalCount, 0),
};
if (!extra.orgs) {
  const o = await rest(`/users/${USER}/orgs`);
  extra.orgs = (o || []).map((x) => ({ login: x.login, avatarUrl: x.avatar_url, url: `https://github.com/${x.login}` }));
}

const cc = await gqlOpt("contributions", userPart(`contributionsCollection{
    contributionYears
    totalCommitContributions totalIssueContributions totalPullRequestContributions
    totalPullRequestReviewContributions totalRepositoryContributions restrictedContributionsCount
    contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount } } }
  }`), V, (d) => d.user.contributionsCollection, {
  contributionYears: [], totalCommitContributions: 0, totalIssueContributions: 0, totalPullRequestContributions: 0,
  totalPullRequestReviewContributions: 0, totalRepositoryContributions: 0, restrictedContributionsCount: 0,
  contributionCalendar: { totalContributions: 0, weeks: [] },
});
const years = cc.contributionYears || [];
const yearly = [];
for (const y of years) {
  const c = await gqlOpt(`contributions ${y}`,
    `query($login:String!,$from:DateTime!,$to:DateTime!){user(login:$login){contributionsCollection(from:$from,to:$to){
      contributionCalendar{totalContributions} totalCommitContributions totalPullRequestContributions totalIssueContributions totalRepositoryContributions}}}`,
    { login: USER, from: `${y}-01-01T00:00:00Z`, to: `${y}-12-31T23:59:59Z` }, (d) => d.user.contributionsCollection, null);
  if (!c) continue;
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
// Fields that some tokens may not be allowed to read are kept separate, so the
// query can fall back to the core set instead of failing outright.
const REPO_CORE = `
        name nameWithOwner owner{login} description url homepageUrl
        isFork isArchived isPrivate isTemplate isMirror
        stargazerCount forkCount diskUsage
        watchers{totalCount}
        primaryLanguage{name color}
        languages(first:15,orderBy:{field:SIZE,direction:DESC}){totalSize edges{size node{name color}}}
        repositoryTopics(first:20){nodes{topic{name}}}
        licenseInfo{spdxId name}
        createdAt updatedAt pushedAt
        releases{totalCount}
        latestRelease{tagName name publishedAt url}
        parent{nameWithOwner url}
        defaultBranchRef{name target{... on Commit{history{totalCount} committedDate}}}`;
const REPO_EXTRA = `
        archivedAt
        openIssues: issues(states:OPEN){totalCount}
        closedIssues: issues(states:CLOSED){totalCount}
        openPRs: pullRequests(states:OPEN){totalCount}
        mergedPRs: pullRequests(states:MERGED){totalCount}
        closedPRs: pullRequests(states:CLOSED){totalCount}
        tags: refs(refPrefix:"refs/tags/"){totalCount}
        branches: refs(refPrefix:"refs/heads/"){totalCount}
        discussions{totalCount}
        deployments{totalCount}`;
const repoQ = (fields) => `
query($login:String!,$first:Int!,$after:String,$privacy:RepositoryPrivacy){
  user(login:$login){
    repositories(first:$first,after:$after,privacy:$privacy,ownerAffiliations:[${EXTRA_OWNERS}],orderBy:{field:STARGAZERS,direction:DESC}){
      pageInfo{hasNextPage endCursor}
      nodes{${fields}}
    }
  }
}`;
const repos = [];
const isTimeout = (errors) => errors?.some((e) => e.type === "TIMEOUT" || /timeout|timed out|did not answer/i.test(e.message));
let after = null, fields = REPO_CORE + REPO_EXTRA, first = 20;
while (true) {
  const vars = { login: USER, first, after, privacy: INCLUDE_PRIVATE ? null : "PUBLIC" };
  let { data, errors } = await gqlTry(repoQ(fields), vars);
  // Too slow for GitHub's time limit → ask for fewer repos per page and retry this page
  if (!data?.user?.repositories && isTimeout(errors) && first > 5) {
    first = Math.max(5, Math.floor(first / 2));
    console.warn(`! Repository page timed out; retrying with ${first} per page`);
    continue;
  }
  if (!data?.user?.repositories && fields !== REPO_CORE) {
    console.warn(`! Full repository query failed (${errText(errors || [])}); retrying with core fields`);
    fields = REPO_CORE;
    continue;
  }
  const r = data?.user?.repositories;
  if (!r) die(`Could not list repositories: ${errText(errors || [])}`);
  if (errors?.length) console.warn("! GraphQL warning:", errText(errors));
  repos.push(...r.nodes.filter(Boolean));
  log(`repos: ${repos.length}`);
  if (!r.pageInfo.hasNextPage) break;
  after = r.pageInfo.endCursor;
}

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
      const { data: d, errors: se } = await gqlTry(starQ, { owner, name, after: cur });
      if (se?.length && !d?.repository) console.warn(`! Star timeline for ${name} incomplete: ${errText(se)}`);
      const sg = d?.repository?.stargazers;
      if (!sg) break;
      for (const e of sg.edges) { const day = e.starredAt.slice(0, 10); starDays[day] = (starDays[day] || 0) + 1; }
      cur = sg.pageInfo.hasNextPage ? sg.pageInfo.endCursor : null;
    } while (cur && ++pages < MAX_STAR_PAGES);
  }

  // Release asset downloads
  let downloads = 0;
  const releaseList = [];
  if (cnt(r.releases) > 0) {
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
  // Archived repos and forks are skipped by default to save API requests (see stats.config.json)
  const wantTraffic = (!r.isArchived || config.trafficForArchived) && (!r.isFork || config.trafficForForks);
  if (wantTraffic) {
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

  const totalLang = r.languages?.totalSize || 0;
  return {
    name, full, owner, description: r.description, url: r.url, homepage: r.homepageUrl || null,
    fork: r.isFork, archived: r.isArchived, private: r.isPrivate, template: r.isTemplate, mirror: r.isMirror,
    parent: r.parent?.nameWithOwner || null,
    stars: r.stargazerCount, forks: r.forkCount, watchers: cnt(r.watchers),
    issuesOpen: cnt(r.openIssues), issuesClosed: cnt(r.closedIssues),
    prsOpen: cnt(r.openPRs), prsMerged: cnt(r.mergedPRs), prsClosed: cnt(r.closedPRs),
    sizeKB: r.diskUsage || 0,
    language: r.primaryLanguage?.name || null, languageColor: r.primaryLanguage?.color || null,
    languages: (r.languages?.edges || []).map((e) => ({ name: e.node.name, color: e.node.color, bytes: e.size, pct: totalLang ? +(100 * e.size / totalLang).toFixed(2) : 0 })),
    topics: (r.repositoryTopics?.nodes || []).map((n) => n.topic.name),
    license: r.licenseInfo?.spdxId && r.licenseInfo.spdxId !== "NOASSERTION" ? r.licenseInfo.spdxId : (r.licenseInfo?.name || null),
    created: r.createdAt, updated: r.updatedAt, pushed: r.pushedAt, archivedAt: r.archivedAt || null,
    commits: r.defaultBranchRef?.target?.history?.totalCount ?? 0,
    lastCommit: r.defaultBranchRef?.target?.committedDate || null,
    defaultBranch: r.defaultBranchRef?.name || null,
    branches: cnt(r.branches), tags: cnt(r.tags),
    releases: cnt(r.releases), latestRelease: r.latestRelease ? { tag: r.latestRelease.tagName, date: r.latestRelease.publishedAt, url: r.latestRelease.url } : null,
    releaseList: releaseList.slice(0, 30), downloads,
    discussions: cnt(r.discussions), deployments: cnt(r.deployments),
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
  repo: process.env.GITHUB_REPOSITORY || null, // e.g. jobitjoseph/github-stats – used by the dashboard's refresh button
  trafficAvailable,
  profile: {
    login: user.login, name: user.name, avatar: user.avatarUrl, bio: user.bio, company: user.company,
    location: user.location, website: user.websiteUrl, twitter: user.twitterUsername, url: user.url,
    created: user.createdAt,
    followers: user.followers.totalCount, following: user.following.totalCount,
    starred: extra.starred, gists: extra.gists,
    orgs: extra.orgs,
    pinned: extra.pinned,
    contributedTo: extra.contributedTo,
    prsAuthored: extra.prs[0], prsAuthoredMerged: extra.prs[1],
    issuesAuthored: extra.issues,
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
