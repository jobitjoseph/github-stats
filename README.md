# GitHub Stats Dashboard

A self-hosted dashboard for every number on your GitHub account, served from GitHub Pages and refreshed weekly by GitHub Actions, or on demand from the refresh button. No server, no third-party service, no rate limits for visitors.

## What it shows

- **Profile** – followers, following, orgs, joined date, repos you've starred, gists, PRs/issues you've authored
- **Stars** – total stars, stars-over-time (from the exact date each star was given), top repos, 30-day deltas
- **Growth** – a snapshot per refresh of stars, forks, followers, watchers and downloads, building up over time
- **Activity** – contribution calendar, last-year breakdown (commits, PRs, reviews, issues, private), contributions per year since you joined, repos created per year (active / archived / fork)
- **Languages** – by bytes of code and by repo count, plus topics and licenses
- **Every repository** – filter by *All / Sources / Forks / Archived / Templates / With releases*, search, filter by language or topic, sort by any column: stars, forks, watchers, open issues, open PRs, commits, releases, release downloads, views, clones, size, created, last push
- **Repo details** (click any row) – star timeline, your weekly commits, views & clones, languages, all releases with download counts, referrers
- **Traffic** – views, clones and referrers. GitHub only keeps 14 days of traffic, so the workflow stores every day and the totals keep growing from the day you set it up.

## Setup (5 minutes)

1. **Create a repository** – e.g. `github-stats` (or `<username>.github.io` to serve it at the root of your Pages domain). Upload these files to it, keeping the folder structure (including `.github/workflows/stats.yml`).
2. **Set your username** in `stats.config.json`.
3. **Turn on Pages** – *Settings → Pages → Build and deployment → Source: GitHub Actions*.
4. **Run it once** – *Actions → Update GitHub stats → Run workflow*. When it finishes, your dashboard is live at `https://<username>.github.io/<repo>/`.

After that it runs once a week on its own (Monday morning).

### Refreshing on demand

The ↻ button in the dashboard header opens the workflow page in GitHub Actions. Click **Run workflow → Run workflow** there. When it finishes (a few minutes, plus about a minute for Pages to deploy), the open dashboard notices the new data and reloads it by itself.

Only you (and anyone with write access to the repo) can start the workflow. For visitors the button just opens a read-only page on GitHub, so it's safe to leave visible.

### Optional: unlock traffic (views, clones, referrers)

GitHub only shares traffic data with tokens that have push access, so the built-in token can't read it.

1. Create a **fine-grained personal access token** at *Settings → Developer settings → Personal access tokens → Fine-grained tokens*:
   - Repository access: **All repositories**
   - Repository permissions: **Administration: Read-only**, **Metadata: Read-only** (Contents: Read-only is also useful)
   - Pick a long expiry and set a reminder to renew it
2. In the dashboard repo: *Settings → Secrets and variables → Actions → New repository secret*, name **`STATS_TOKEN`**, paste the token.
3. Re-run the workflow.

A classic token with the `repo` scope also works, and additionally counts private contributions.

## Configuration – `stats.config.json`

| Key | Default | Meaning |
|---|---|---|
| `username` | – | GitHub login to report on |
| `includePrivate` | `false` | Include private repos. **They'll be visible on the public page** — only enable this if that's what you want. Needs `STATS_TOKEN`. |
| `includeOrgRepos` | `false` | Also include repos you collaborate on or own through organizations |
| `excludeRepos` | `[]` | Repo names to hide, e.g. `["test-repo", "old-thing"]` |
| `trafficForArchived` | `false` | Fetch traffic for archived repos too |
| `trafficForForks` | `false` | Fetch traffic for forks too (4 extra API requests per fork) |
| `maxStargazerPagesPerRepo` | `50` | Cap for the star timeline (100 stars per page) |

## Run locally

```bash
GH_TOKEN=ghp_yourtoken node scripts/collect.mjs   # Node 18+, no npm install needed
python3 -m http.server 8000                       # then open http://localhost:8000
```

## Files

```
index.html                    the dashboard
assets/app.js, style.css      dashboard code (Chart.js from cdnjs)
scripts/collect.mjs           data collector (GitHub GraphQL + REST)
stats.config.json             settings
.github/workflows/stats.yml   weekly job: collect → commit data/ → deploy Pages
data/                         generated: stats.json, history.json, traffic.json
```

## Notes

- Stars-over-time is built from each star's timestamp, so stars that were later removed don't appear in the timeline — the total tile is always the live count.
- "Your commits per week" comes from GitHub's statistics API, which computes lazily; on the very first run a few repos may be empty until the next day.
- The schedule is `17 1 * * 1` (Mondays, 01:17 UTC ≈ 06:47 IST). Change it in the workflow file if you like. Keep it at least every 14 days, or traffic data will have gaps — GitHub only keeps the last 14 days.
