/* GitHub Stats dashboard — reads data/*.json produced by scripts/collect.mjs */
(() => {
  "use strict";

  // ───────────── state ─────────────
  const S = {
    stats: null, history: [], traffic: { repos: {} },
    charts: [],
    starMode: "total", starRange: "all",
    trafficRange: "all",
    growthMetric: "stars",
    tab: "all", q: "", lang: "", topic: "",
    sort: { key: "stars", dir: -1 },
    showAll: false,
  };

  // ───────────── utils ─────────────
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nf = new Intl.NumberFormat("en");
  const fmt = (n) => (n == null ? "—" : nf.format(n));
  const short = (n) => {
    if (n == null) return "—";
    const a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
    if (a >= 1e4) return (n / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, "") + "k";
    return nf.format(n);
  };
  const size = (kb) => kb >= 1048576 ? (kb / 1048576).toFixed(1) + " GB" : kb >= 1024 ? (kb / 1024).toFixed(1) + " MB" : kb + " KB";
  const bytes = (b) => b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : b >= 1e6 ? (b / 1e6).toFixed(1) + " MB" : b >= 1e3 ? (b / 1e3).toFixed(0) + " KB" : b + " B";
  const dateF = new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric" });
  const monthF = new Intl.DateTimeFormat("en", { year: "numeric", month: "short" });
  const fdate = (d) => (d ? dateF.format(new Date(d)) : "—");
  const DAY = 864e5;
  const ago = (d) => {
    if (!d) return "—";
    const s = (Date.now() - new Date(d)) / 1000;
    const u = [[31536000, "y"], [2592000, "mo"], [604800, "w"], [86400, "d"], [3600, "h"], [60, "m"]];
    for (const [sec, l] of u) if (s >= sec) return Math.floor(s / sec) + l + " ago";
    return "just now";
  };
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const series = () => [1, 2, 3, 4, 5, 6, 7, 8].map((i) => css("--s" + i));
  const zero = (n) => (n ? fmt(n) : `<span class="zero">0</span>`);

  const ICON = {
    star: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 .25a.75.75 0 0 1 .67.42l1.88 3.8 4.2.61a.75.75 0 0 1 .41 1.28l-3.04 2.96.72 4.18a.75.75 0 0 1-1.09.79L8 12.33l-3.75 1.97a.75.75 0 0 1-1.09-.79l.72-4.18L.84 6.37a.75.75 0 0 1 .41-1.28l4.2-.61L7.33.67A.75.75 0 0 1 8 .25Z"/></svg>',
    fork: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5 5.37v.88c0 .41.34.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.88a2.25 2.25 0 1 1 1.5 0v.88A2.25 2.25 0 0 1 10.25 8.5h-1.5v2.13a2.25 2.25 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.88a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"/></svg>',
    eye: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 2c1.98 0 3.77.97 5.06 2.06 1.3 1.1 2.25 2.43 2.71 3.19a1.4 1.4 0 0 1 0 1.5c-.46.76-1.41 2.09-2.71 3.19C11.77 13.03 9.98 14 8 14s-3.77-.97-5.06-2.06C1.64 10.84.69 9.51.23 8.75a1.4 1.4 0 0 1 0-1.5c.46-.76 1.41-2.09 2.71-3.19C4.23 2.97 6.02 2 8 2Zm0 9.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/></svg>',
    repo: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.71 1.71.75.75 0 0 1-1.06 1.06A2.5 2.5 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.71A2.5 2.5 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.09a.25.25 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z"/></svg>',
    down: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .14.11.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14ZM7.25 7.69V1.75a.75.75 0 0 1 1.5 0v5.94l1.97-1.97a.75.75 0 0 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 6.78a.75.75 0 0 1 1.06-1.06Z"/></svg>',
    commit: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M11.93 8.5a4 4 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4 4 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z"/></svg>',
    people: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 5.5a3.5 3.5 0 1 1 5.9 2.55 5 5 0 0 1 2.86 4.03.75.75 0 0 1-1.49.17 3.5 3.5 0 0 0-6.95 0 .75.75 0 0 1-1.49-.17A5 5 0 0 1 3.7 8.05 3.5 3.5 0 0 1 2 5.5ZM11 4a3 3 0 0 1 1.85 5.37 4.5 4.5 0 0 1 2.65 3.86.75.75 0 0 1-1.5.08 3 3 0 0 0-2.32-2.73.75.75 0 0 1-.56-.72v-.35a.75.75 0 0 1 .41-.67A1.5 1.5 0 0 0 11 5.5.75.75 0 0 1 11 4Zm-5.5-.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/></svg>',
    archive: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M0 2.75C0 1.78.78 1 1.75 1h12.5c.97 0 1.75.78 1.75 1.75v1.5c0 .67-.38 1.25-.93 1.54v7.46A1.75 1.75 0 0 1 13.32 15H2.68a1.75 1.75 0 0 1-1.75-1.75V5.79A1.75 1.75 0 0 1 0 4.25Zm2.43 3.25v7.25c0 .14.11.25.25.25h10.64a.25.25 0 0 0 .25-.25V6Zm-.68-3.5a.25.25 0 0 0-.25.25v1.5c0 .14.11.25.25.25h12.5a.25.25 0 0 0 .25-.25v-1.5a.25.25 0 0 0-.25-.25ZM5 8.25A.75.75 0 0 1 5.75 7.5h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 8.25Z"/></svg>',
    tag: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 7.78V2.75C1 1.78 1.78 1 2.75 1h5.03c.46 0 .9.18 1.24.51l6.25 6.25a1.75 1.75 0 0 1 0 2.48l-5.03 5.03a1.75 1.75 0 0 1-2.48 0L1.51 9.02A1.75 1.75 0 0 1 1 7.78Zm1.5 0c0 .07.03.13.07.18l6.25 6.25c.1.1.26.1.36 0l5.03-5.03a.25.25 0 0 0 0-.36L7.96 2.57a.25.25 0 0 0-.18-.07H2.75a.25.25 0 0 0-.25.25ZM6 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>',
    pin: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="m12.6 6.4-4.6 7.7-4.6-7.7A4.9 4.9 0 0 1 8 1a4.9 4.9 0 0 1 4.6 5.4ZM8 8.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/></svg>',
    org: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.75 16A1.75 1.75 0 0 1 0 14.25V1.75C0 .78.78 0 1.75 0h8.5C11.22 0 12 .78 12 1.75v12.5c0 .09 0 .17-.02.25h2.27a.25.25 0 0 0 .25-.25V8.29a.25.25 0 0 0-.11-.21l-1.55-1.04a.75.75 0 0 1 .83-1.25l1.55 1.04c.49.32.78.87.78 1.46v5.96A1.75 1.75 0 0 1 14.25 16h-3.5a.77.77 0 0 1-.2-.03.77.77 0 0 1-.2.03h-2.5a.75.75 0 0 1-.75-.75V13H5.5v2.25a.75.75 0 0 1-.75.75Zm-.25-1.75c0 .14.11.25.25.25H4v-2.25a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 .75.75v2.25h1.75a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25ZM3.75 6h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1 0-1.5ZM3 3.75A.75.75 0 0 1 3.75 3h.5a.75.75 0 0 1 0 1.5h-.5A.75.75 0 0 1 3 3.75Zm4 3A.75.75 0 0 1 7.75 6h.5a.75.75 0 0 1 0 1.5h-.5A.75.75 0 0 1 7 6.75ZM7.75 3h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1 0-1.5ZM3 9.75A.75.75 0 0 1 3.75 9h.5a.75.75 0 0 1 0 1.5h-.5A.75.75 0 0 1 3 9.75ZM7.75 9h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1 0-1.5Z"/></svg>',
    link: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="m7.78 3.47 1.25-1.25a3.5 3.5 0 0 1 4.95 4.95l-2.5 2.5a3.5 3.5 0 0 1-4.95 0 .75.75 0 0 1 1.06-1.06 2 2 0 0 0 2.83 0l2.5-2.5a2 2 0 0 0-2.83-2.83L8.84 4.53a.75.75 0 0 1-1.06-1.06Zm-4.69 9.64a2 2 0 0 0 2.83 0l1.25-1.25a.75.75 0 0 1 1.06 1.06l-1.25 1.25a3.5 3.5 0 0 1-4.95-4.95l2.5-2.5a3.5 3.5 0 0 1 4.95 0 .75.75 0 0 1-1.06 1.06 2 2 0 0 0-2.83 0l-2.5 2.5a2 2 0 0 0 0 2.83Z"/></svg>',
    cal: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.75 0a.75.75 0 0 1 .75.75V2h5V.75a.75.75 0 0 1 1.5 0V2h1.25c.97 0 1.75.78 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 16H2.75A1.75 1.75 0 0 1 1 14.25V3.75C1 2.78 1.78 2 2.75 2H4V.75A.75.75 0 0 1 4.75 0ZM2.5 7.5v6.75c0 .14.11.25.25.25h10.5a.25.25 0 0 0 .25-.25V7.5Zm10.75-4H2.75a.25.25 0 0 0-.25.25V6h11V3.75a.25.25 0 0 0-.25-.25Z"/></svg>',
    search: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M10.68 11.74a6 6 0 0 1-7.92-8.98 6 6 0 0 1 8.98 7.92l3.04 3.04a.75.75 0 0 1-1.06 1.06ZM11.5 7a4.5 4.5 0 1 0-9 0 4.5 4.5 0 0 0 9 0Z"/></svg>',
    close: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>',
  };

  // ───────────── load ─────────────
  async function load() {
    const get = (u, fb) => fetch(u + "?t=" + Date.now()).then((r) => (r.ok ? r.json() : fb)).catch(() => fb);
    const [stats, history, traffic] = await Promise.all([
      get("data/stats.json", null), get("data/history.json", []), get("data/traffic.json", { repos: {} }),
    ]);
    if (!stats) {
      $("#loading").classList.remove("skeleton");
      $("#loading").innerHTML = `<div><h2>No data yet</h2><p>Run the <b>Update GitHub stats</b> workflow in the Actions tab once, then reload.</p></div>`;
      return;
    }
    S.stats = stats; S.history = history; S.traffic = traffic;
    // derived per-repo star total from timeline
    readHash();
    render();
    window.addEventListener("hashchange", readHash);
  }

  // ───────────── chart helpers ─────────────
  function destroyCharts() { S.charts.forEach((c) => c.destroy()); S.charts = []; }
  function baseOpts(extra = {}) {
    const ink2 = css("--ink-2"), muted = css("--muted"), grid = css("--grid");
    Chart.defaults.font.family = css("--font");
    Chart.defaults.font.size = 12;
    Chart.defaults.color = muted;
    return {
      responsive: true, maintainAspectRatio: false, animation: { duration: 350 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: css("--surface"), titleColor: css("--ink"), bodyColor: ink2,
          borderColor: css("--border"), borderWidth: 1, padding: 10, cornerRadius: 10,
          boxPadding: 5, usePointStyle: true, titleFont: { weight: "600" },
          callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y ?? c.parsed.x)}` },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { color: css("--axis") }, ticks: { maxRotation: 0, autoSkipPadding: 18 } },
        y: { grid: { color: grid }, border: { display: false }, beginAtZero: true, ticks: { callback: (v) => short(v), precision: 0 } },
      },
      ...extra,
    };
  }
  function mk(el, cfg) { if (!el) return; const c = new Chart(el, cfg); S.charts.push(c); return c; }
  const timeTicks = (span) => ({
    callback: (v) => (span > 400 * DAY ? monthF : dateF).format(new Date(v)),
    maxTicksLimit: 7, maxRotation: 0,
  });

  // ───────────── data shaping ─────────────
  function cumulative(dayMap, from = 0) {
    const days = Object.keys(dayMap).sort();
    let acc = from; const pts = [];
    for (const d of days) { acc += dayMap[d]; pts.push({ x: Date.parse(d), y: acc }); }
    return pts;
  }
  function rangeStart(range) {
    return range === "1y" ? Date.now() - 365 * DAY : range === "90d" ? Date.now() - 90 * DAY : range === "30d" ? Date.now() - 30 * DAY : -Infinity;
  }
  /** clip cumulative series to a range, carrying the value at range start */
  function clip(pts, start, end = Date.now()) {
    if (!pts.length) return pts;
    const out = []; let carry = 0;
    for (const p of pts) { if (p.x < start) carry = p.y; else out.push(p); }
    const s = Math.max(start, pts[0].x);
    if (start > -Infinity) out.unshift({ x: s, y: carry });
    const last = out.length ? out[out.length - 1].y : carry;
    out.push({ x: end, y: last });
    return out;
  }

  // ───────────── render ─────────────
  function render() {
    destroyCharts();
    const { profile: p, totals: t } = S.stats;
    document.title = `${p.name || p.login} · GitHub Stats`;
    $("#brandName").textContent = p.login;
    $("#updated").textContent = "Updated " + ago(S.stats.generated);
    $("#updated").title = new Date(S.stats.generated).toLocaleString();
    $("#navTraffic").classList.toggle("hidden", !S.stats.trafficAvailable);
    $("#srcLink").href = `https://github.com/${p.login}`;

    $("#app").innerHTML = `
      ${profileHTML(p)}
      ${kpiHTML(t, p)}
      <section id="stars">
        <h2>Stars <small>${fmt(t.stars)} across ${fmt(t.repos)} repositories</small></h2>
        <div class="grid g-2">
          <div class="card">
            <div class="card-head">
              <div><h3>Stars over time</h3><p class="hint">Cumulative stars, from the date each star was given</p></div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                ${seg("starMode", [["total", "Total"], ["top", "Top repos"]], S.starMode)}
                ${seg("starRange", [["all", "All"], ["1y", "1Y"], ["90d", "90D"]], S.starRange)}
              </div>
            </div>
            <div class="chart-box"><canvas id="cStars" aria-label="Stars over time"></canvas></div>
            <div class="legend" id="lStars"></div>
          </div>
          <div class="card">
            <h3>Most-starred repositories</h3><p class="hint">Click a bar for details</p>
            <div class="chart-box" id="topBox"><canvas id="cTop" aria-label="Top repositories by stars"></canvas></div>
          </div>
        </div>
        ${growthHTML()}
      </section>

      <section id="activity">
        <h2>Activity</h2>
        <div class="card">
          <div class="card-head">
            <div><h3>${fmt(S.stats.contributions.lastYear.total)} contributions in the last year</h3>
            <p class="hint">Commits, pull requests, issues, reviews and new repositories</p></div>
          </div>
          ${heatmapHTML()}
          <div class="statlist" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">
            ${[["commits", "Commits"], ["prs", "Pull requests"], ["reviews", "Reviews"], ["issues", "Issues"], ["repos", "Repos created"], ["private", "Private contributions"]]
              .map(([k, l]) => `<div><b class="num">${fmt(S.stats.contributions.lastYear[k])}</b><span>${l}</span></div>`).join("")}
          </div>
        </div>
        <div class="grid g-2e" style="margin-top:12px">
          <div class="card">
            <h3>Contributions per year</h3><p class="hint">Since joining in ${new Date(p.created).getFullYear()}</p>
            <div class="chart-box short"><canvas id="cYears"></canvas></div>
          </div>
          <div class="card">
            <h3>Repositories created per year</h3><p class="hint">Split by current status</p>
            <div class="chart-box short"><canvas id="cCreated"></canvas></div>
            <div class="legend"><span><i style="background:var(--s1)"></i>Active</span><span><i style="background:var(--s2)"></i>Archived</span><span><i style="background:var(--s3)"></i>Fork</span></div>
          </div>
        </div>
      </section>

      <section id="languages">
        <h2>Languages <small>${fmt(t.languages)} languages in ${fmt(t.sources)} source repositories</small></h2>
        <div class="grid g-2e">
          <div class="card"><h3>By code size</h3><p class="hint">Bytes of code across non-fork repositories</p><div class="bars" id="langBytes"></div></div>
          <div class="card"><h3>By number of repositories</h3><p class="hint">Primary language of each non-fork repository</p><div class="bars" id="langRepos"></div></div>
        </div>
        <div class="grid g-2e" style="margin-top:12px">
          <div class="card"><h3>Topics</h3><p class="hint">Click to filter the repository list</p><div class="chips" id="topics"></div></div>
          <div class="card"><h3>Licenses</h3><p class="hint">Across non-fork repositories</p><div class="bars" id="licenses"></div></div>
        </div>
      </section>

      <section id="repos">
        <h2>Repositories <small id="repoCount"></small></h2>
        <div class="toolbar">
          ${seg("tab", tabs(), S.tab)}
          <label class="search">${ICON.search}<input id="q" type="search" placeholder="Search name, description, topic…" value="${esc(S.q)}" aria-label="Search repositories"></label>
          <select class="sel" id="langSel" aria-label="Filter by language">
            <option value="">All languages</option>
            ${[...new Set(S.stats.repos.map((r) => r.language).filter(Boolean))].sort().map((l) => `<option ${l === S.lang ? "selected" : ""}>${esc(l)}</option>`).join("")}
          </select>
        </div>
        <div id="activeTopic"></div>
        <div class="tbl-wrap"><table id="tbl"></table></div>
        <div class="tbl-foot"><span id="tblInfo"></span><span id="tblMore"></span></div>
      </section>

      ${S.stats.trafficAvailable ? trafficHTML() : trafficNotice()}
    `;

    bindSegs();
    drawStars();
    drawTop();
    drawGrowth();
    drawYears();
    drawCreated();
    drawLanguages();
    drawTable();
    if (S.stats.trafficAvailable) drawTraffic();

    $("#q").addEventListener("input", (e) => { S.q = e.target.value; S.showAll = false; drawTable(); });
    $("#langSel").addEventListener("change", (e) => { S.lang = e.target.value; S.showAll = false; drawTable(); });
  }

  function tabs() {
    const r = S.stats.repos;
    const c = (f) => r.filter(f).length;
    const list = [
      ["all", `All ${r.length}`],
      ["sources", `Sources ${c((x) => !x.fork)}`],
      ["forks", `Forks ${c((x) => x.fork)}`],
      ["archived", `Archived ${c((x) => x.archived)}`],
    ];
    const tpl = c((x) => x.template); if (tpl) list.push(["templates", `Templates ${tpl}`]);
    const rel = c((x) => x.releases > 0); if (rel) list.push(["releases", `With releases ${rel}`]);
    if (S.stats.totals.private) list.push(["private", `Private ${S.stats.totals.private}`]);
    return list;
  }

  function seg(name, opts, cur) {
    return `<div class="seg" role="group" data-seg="${name}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${v === cur}">${esc(l)}</button>`).join("")}</div>`;
  }
  function bindSegs(root = document) {
    root.querySelectorAll("[data-seg]").forEach((g) => {
      g.addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return;
        const key = g.dataset.seg; S[key] = b.dataset.v;
        g.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
        if (key === "starMode" || key === "starRange") redraw("cStars", drawStars);
        else if (key === "growthMetric") redraw("cGrowth", drawGrowth);
        else if (key === "trafficRange") redraw("cTraffic", drawTraffic);
        else if (key === "tab") { S.showAll = false; drawTable(); }
      });
    });
  }
  function redraw(id, fn) {
    const el = document.getElementById(id);
    S.charts = S.charts.filter((c) => { if (c.canvas === el) { c.destroy(); return false; } return true; });
    fn();
  }

  // ───────────── sections ─────────────
  function profileHTML(p) {
    const m = [];
    if (p.company) m.push(`<span>${ICON.org}${esc(p.company)}</span>`);
    if (p.location) m.push(`<span>${ICON.pin}${esc(p.location)}</span>`);
    if (p.website) m.push(`<span>${ICON.link}<a href="${esc(/^https?:/.test(p.website) ? p.website : "https://" + p.website)}" rel="noopener">${esc(p.website.replace(/^https?:\/\//, ""))}</a></span>`);
    m.push(`<span>${ICON.people}<b>${fmt(p.followers)}</b>&nbsp;followers · <b>${fmt(p.following)}</b>&nbsp;following</span>`);
    m.push(`<span>${ICON.cal}Joined ${monthF.format(new Date(p.created))}</span>`);
    return `
      <div class="profile">
        <img class="avatar" src="${esc(p.avatar)}" alt="" width="96" height="96">
        <div style="flex:1;min-width:240px">
          <h1>${esc(p.name || p.login)}<a class="login" href="${esc(p.url)}" rel="noopener">@${esc(p.login)}</a></h1>
          ${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ""}
          <div class="meta">${m.join("")}</div>
          ${p.orgs?.length ? `<div class="orgs">${p.orgs.map((o) => `<a href="${esc(o.url)}" title="${esc(o.login)}" rel="noopener"><img src="${esc(o.avatarUrl)}" alt="${esc(o.login)}"></a>`).join("")}</div>` : ""}
        </div>
      </div>`;
  }

  function delta(key) {
    // change over ~30 days from history snapshots
    const h = S.history; if (h.length < 2) return "";
    const target = Date.now() - 30 * DAY;
    let base = h[0];
    for (const s of h) if (Date.parse(s.d) <= target) base = s;
    const d = h[h.length - 1][key] - base[key];
    if (!d || base === h[h.length - 1]) return "";
    const days = Math.round((Date.parse(h[h.length - 1].d) - Date.parse(base.d)) / DAY);
    return ` · <span class="delta">${d > 0 ? "+" : ""}${fmt(d)}</span> in ${days}d`;
  }

  function kpiHTML(t, p) {
    const k = (icon, label, val, sub, cls = "") =>
      `<div class="kpi ${cls}"><div class="label">${ICON[icon]}${label}</div><div class="value num" title="${fmt(val)}">${cls ? fmt(val) : short(val)}</div><div class="sub">${sub}</div></div>`;
    const top = [...S.stats.repos].sort((a, b) => b.stars - a.stars)[0];
    const tiles = [
      k("star", "Total stars", t.stars, `${top ? `Top: <b>${esc(top.name)}</b> (${fmt(top.stars)})` : ""}${delta("stars")}`, "hero"),
      k("fork", "Forks", t.forks, `of your repositories${delta("forks")}`),
      k("eye", "Watchers", t.watchers, "people watching"),
      k("repo", "Repositories", t.repos, `${t.sources} sources · ${t.forksOwned} forks`),
      k("archive", "Archived", t.archived, `${t.repos ? Math.round((100 * t.archived) / t.repos) : 0}% of repositories`),
      k("commit", "Commits", t.commits, "on default branches"),
      k("tag", "Releases", t.releases, `${fmt(t.downloads)} asset downloads`),
      k("down", "Downloads", t.downloads, "release assets, all time"),
      k("people", "Followers", p.followers, `following ${fmt(p.following)}${delta("followers")}`),
      k("star", "Starred by you", p.starred, `${fmt(p.gists)} public gists`),
      k("commit", "Pull requests", p.prsAuthored, `${fmt(p.prsAuthoredMerged)} merged · ${fmt(p.issuesAuthored)} issues`),
      k("repo", "Contributed to", p.contributedTo, "other repositories (last year)"),
    ];
    if (t.views != null) tiles.splice(8, 0, k("eye", "Views", t.views, `${fmt(t.clones)} clones · since tracking began`));
    return `<div class="kpis">${tiles.join("")}</div>`;
  }

  function growthHTML() {
    if (S.history.length < 2) return "";
    return `
      <div class="card" style="margin-top:12px">
        <div class="card-head">
          <div><h3>Growth</h3><p class="hint">Daily snapshots since ${fdate(S.history[0].d)}</p></div>
          ${seg("growthMetric", [["stars", "Stars"], ["forks", "Forks"], ["followers", "Followers"], ["watchers", "Watchers"], ["downloads", "Downloads"]], S.growthMetric)}
        </div>
        <div class="chart-box short"><canvas id="cGrowth"></canvas></div>
      </div>`;
  }

  function heatmapHTML() {
    const cal = S.stats.contributions.calendar;
    if (!cal?.length) return "";
    const max = Math.max(...cal.map((d) => d[1]));
    const q = (n) => (n === 0 ? 0 : n <= max * 0.25 ? 1 : n <= max * 0.5 ? 2 : n <= max * 0.75 ? 3 : 4);
    const first = new Date(cal[0][0] + "T00:00:00Z").getUTCDay();
    const cells = [];
    for (let i = 0; i < first; i++) cells.push(`<i style="visibility:hidden"></i>`);
    for (const [d, n] of cal) cells.push(`<i data-l="${q(n)}" title="${n} contribution${n === 1 ? "" : "s"} on ${fdate(d + "T00:00:00Z")}"></i>`);
    // month labels: one per week column
    const weeks = Math.ceil(cells.length / 7);
    // label the week column that contains the 1st of each month
    const labels = [];
    for (let w = 0; w < weeks; w++) {
      let lab = "";
      for (let k = 0; k < 7; k++) {
        const idx = w * 7 + k - first;
        if (idx < 0 || idx >= cal.length) continue;
        const dt = new Date(cal[idx][0] + "T00:00:00Z");
        if (dt.getUTCDate() === 1 && w < weeks - 1) lab = dt.toLocaleString("en", { month: "short", timeZone: "UTC" });
      }
      labels.push(`<span>${lab}</span>`);
    }
    return `
      <div class="heat-wrap">
        <div class="heat-months">${labels.join("")}</div>
        <div class="heat" role="img" aria-label="Contribution calendar">${cells.join("")}</div>
      </div>
      <div class="heat-key">Less ${[0, 1, 2, 3, 4].map((l) => `<i style="background:var(--heat-${l})"></i>`).join("")} More</div>`;
  }

  function trafficHTML() {
    return `
      <section id="traffic">
        <h2>Traffic <small>accumulated daily — GitHub itself only keeps 14 days</small></h2>
        <div class="card">
          <div class="card-head">
            <div><h3>Views &amp; clones</h3><p class="hint">All repositories, per day</p></div>
            ${seg("trafficRange", [["all", "All"], ["90d", "90D"], ["30d", "30D"]], S.trafficRange)}
          </div>
          <div class="chart-box"><canvas id="cTraffic"></canvas></div>
          <div class="legend"><span><i class="line" style="background:var(--s1)"></i>Views</span><span><i class="line" style="background:var(--s2)"></i>Clones</span></div>
        </div>
        <div class="grid g-2e" style="margin-top:12px">
          <div class="card"><h3>Most-viewed repositories</h3><p class="hint">Total views since tracking began</p><div class="bars" id="topViews"></div></div>
          <div class="card"><h3>Top referrers</h3><p class="hint">Last 14 days, all repositories</p><div class="bars" id="refs"></div></div>
        </div>
      </section>`;
  }
  function trafficNotice() {
    return `
      <section id="traffic">
        <div class="notice">
          <b>Views, clones and referrers are off.</b> GitHub only shares traffic with tokens that have push access.
          Create a fine-grained personal access token (all repositories · <i>Administration: read</i> · <i>Metadata: read</i>),
          save it as the repository secret <code>STATS_TOKEN</code>, and re-run the workflow.
        </div>
      </section>`;
  }

  // ───────────── charts ─────────────
  function drawStars() {
    const repos = S.stats.repos;
    const start = rangeStart(S.starRange);
    const lineDs = (label, data, color, width = 2) => ({
      label, data, borderColor: color, backgroundColor: color, borderWidth: width, pointRadius: 0,
      pointHoverRadius: 5, pointHoverBorderWidth: 2, pointHoverBorderColor: css("--surface"), stepped: false, tension: 0,
    });
    let datasets;
    const legend = $("#lStars");
    if (S.starMode === "total") {
      const all = {};
      for (const r of repos) for (const [d, n] of Object.entries(r.starDays || {})) all[d] = (all[d] || 0) + n;
      const pts = clip(cumulative(all), start);
      const ds = lineDs("Total stars", pts, css("--s1"));
      ds.fill = { target: "origin" };
      ds.backgroundColor = css("--accent-wash");
      datasets = [ds];
      legend.innerHTML = "";
    } else {
      const top = [...repos].sort((a, b) => b.stars - a.stars).filter((r) => r.stars > 0).slice(0, 4);
      const col = series();
      datasets = top.map((r, i) => lineDs(r.name, clip(cumulative(r.starDays || {}), start), col[i]));
      legend.innerHTML = top.map((r, i) => `<span><i class="line" style="background:${col[i]}"></i>${esc(r.name)}</span>`).join("");
    }
    const xs = datasets.flatMap((d) => d.data.map((p) => p.x));
    const span = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
    if (!xs.length) { $("#cStars").parentElement.innerHTML = `<div class="empty">No stars yet</div>`; return; }
    const o = baseOpts({ interaction: { mode: S.starMode === "total" ? "index" : "nearest", intersect: false, axis: "x" } });
    o.scales.x = { ...o.scales.x, type: "linear", min: Math.min(...xs), max: Math.max(...xs), ticks: timeTicks(span) };
    o.plugins.tooltip.callbacks.title = (items) => fdate(items[0].parsed.x);
    mk($("#cStars"), { type: "line", data: { datasets }, options: o });
  }

  function drawTop() {
    const top = [...S.stats.repos].sort((a, b) => b.stars - a.stars).filter((r) => r.stars > 0).slice(0, 12);
    if (!top.length) { $("#topBox").innerHTML = `<div class="empty">No stars yet</div>`; return; }
    $("#topBox").style.height = Math.max(200, top.length * 30 + 30) + "px";
    const o = baseOpts({ indexAxis: "y" });
    o.scales = {
      x: { grid: { color: css("--grid") }, border: { display: false }, beginAtZero: true, ticks: { callback: (v) => short(v), precision: 0 } },
      y: { grid: { display: false }, border: { color: css("--axis") }, ticks: { color: css("--ink-2"), callback: function (v) { const l = this.getLabelForValue(v); return l.length > 20 ? l.slice(0, 19) + "…" : l; } } },
    };
    o.plugins.tooltip.callbacks.label = (c) => ` ${fmt(c.parsed.x)} stars`;
    o.onClick = (_, els) => { if (els[0]) openRepo(top[els[0].index].name); };
    o.onHover = (e, els) => { e.native.target.style.cursor = els.length ? "pointer" : "default"; };
    mk($("#cTop"), {
      type: "bar",
      data: { labels: top.map((r) => r.name), datasets: [{ label: "Stars", data: top.map((r) => r.stars), backgroundColor: css("--s1"), borderRadius: { topRight: 4, bottomRight: 4 }, borderSkipped: "start", barPercentage: 0.7, categoryPercentage: 0.9 }] },
      options: o,
    });
  }

  function drawGrowth() {
    const el = $("#cGrowth"); if (!el) return;
    const k = S.growthMetric;
    const pts = S.history.map((h) => ({ x: Date.parse(h.d), y: h[k] ?? 0 }));
    const span = pts.length ? pts[pts.length - 1].x - pts[0].x : 0;
    const label = { stars: "Stars", forks: "Forks", followers: "Followers", watchers: "Watchers", downloads: "Downloads" }[k];
    const o = baseOpts({ interaction: { mode: "index", intersect: false } });
    o.scales.x = { ...o.scales.x, type: "linear", min: pts[0]?.x, max: pts[pts.length - 1]?.x, ticks: timeTicks(span) };
    o.scales.y.beginAtZero = false;
    o.plugins.tooltip.callbacks.title = (i) => fdate(i[0].parsed.x);
    mk(el, { type: "line", data: { datasets: [{ label, data: pts, borderColor: css("--s1"), backgroundColor: css("--s1"), borderWidth: 2, pointRadius: pts.length < 40 ? 3 : 0, pointHoverRadius: 5 }] }, options: o });
  }

  function drawYears() {
    const y = S.stats.contributions.yearly || [];
    const o = baseOpts();
    o.plugins.tooltip.callbacks.label = (c) => ` ${fmt(c.parsed.y)} contributions`;
    mk($("#cYears"), {
      type: "bar",
      data: { labels: y.map((r) => r.year), datasets: [{ label: "Contributions", data: y.map((r) => r.total), backgroundColor: css("--s1"), borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "start", maxBarThickness: 36 }] },
      options: o,
    });
  }

  function drawCreated() {
    const r = S.stats.repos;
    const years = [...new Set(r.map((x) => new Date(x.created).getFullYear()))].sort();
    const count = (f) => years.map((y) => r.filter((x) => new Date(x.created).getFullYear() === y && f(x)).length);
    const col = series();
    const o = baseOpts({ interaction: { mode: "index", intersect: false } });
    o.scales.x.stacked = true; o.scales.y.stacked = true;
    const ds = (label, data, c) => ({ label, data, backgroundColor: c, borderColor: css("--surface"), borderWidth: { top: 2 }, borderSkipped: "start", maxBarThickness: 36 });
    mk($("#cCreated"), {
      type: "bar",
      data: {
        labels: years,
        datasets: [
          ds("Active", count((x) => !x.archived && !x.fork), col[0]),
          ds("Archived", count((x) => x.archived && !x.fork), col[1]),
          ds("Fork", count((x) => x.fork), col[2]),
        ],
      },
      options: o,
    });
  }

  function barList(el, rows, valFmt, colorFn) {
    if (!el) return;
    if (!rows.length) { el.innerHTML = `<div class="empty">Nothing here yet</div>`; return; }
    const max = Math.max(...rows.map((r) => r.v));
    el.innerHTML = rows.map((r) => `
      <div class="bar-row" ${r.repo ? `data-repo="${esc(r.repo)}" style="cursor:pointer"` : ""} title="${esc(r.n)}: ${esc(valFmt(r.v))}">
        <div class="n">${r.dot ? `<i style="background:${esc(r.dot)}"></i>` : ""}${esc(r.n)}</div>
        <div class="track"><div class="fill" style="width:${max ? Math.max(1.5, (100 * r.v) / max) : 0}%;${colorFn ? `background:${colorFn(r)}` : ""}"></div></div>
        <div class="v">${esc(valFmt(r.v))}</div>
      </div>`).join("");
    el.querySelectorAll("[data-repo]").forEach((x) => x.addEventListener("click", () => openRepo(x.dataset.repo)));
  }

  function drawLanguages() {
    const L = S.stats.languages;
    const totalB = L.reduce((a, l) => a + l.bytes, 0);
    const topB = L.slice(0, 10).map((l) => ({ n: l.name, v: l.bytes, dot: l.color || css("--muted") }));
    const rest = L.slice(10).reduce((a, l) => a + l.bytes, 0);
    if (rest) topB.push({ n: `Other (${L.length - 10})`, v: rest, dot: css("--muted") });
    barList($("#langBytes"), topB, (v) => `${((100 * v) / totalB).toFixed(1)}%`);
    const byRepo = [...L].filter((l) => l.repos).sort((a, b) => b.repos - a.repos).slice(0, 10).map((l) => ({ n: l.name, v: l.repos, dot: l.color || css("--muted") }));
    barList($("#langRepos"), byRepo, (v) => fmt(v));

    const T = Object.entries(S.stats.topics || {}).sort((a, b) => b[1] - a[1]).slice(0, 40);
    $("#topics").innerHTML = T.length
      ? T.map(([t, n]) => `<button class="chip" data-topic="${esc(t)}">${esc(t)} <b>${n}</b></button>`).join("")
      : `<span class="muted">No topics set on any repository.</span>`;
    $("#topics").querySelectorAll("[data-topic]").forEach((b) => b.addEventListener("click", () => {
      S.topic = b.dataset.topic; S.showAll = false; drawTable(); $("#repos").scrollIntoView({ behavior: "smooth" });
    }));
    const lic = Object.entries(S.stats.licenses || {}).sort((a, b) => b[1] - a[1]).map(([n, v]) => ({ n, v }));
    barList($("#licenses"), lic, (v) => fmt(v));
  }

  function drawTraffic() {
    const el = $("#cTraffic"); if (!el) return;
    const views = {}, clones = {};
    for (const t of Object.values(S.traffic.repos || {})) {
      for (const [d, [c]] of Object.entries(t.views || {})) views[d] = (views[d] || 0) + c;
      for (const [d, [c]] of Object.entries(t.clones || {})) clones[d] = (clones[d] || 0) + c;
    }
    const start = rangeStart(S.trafficRange);
    const toPts = (m) => Object.keys(m).sort().map((d) => ({ x: Date.parse(d), y: m[d] })).filter((p) => p.x >= start);
    const v = toPts(views), c = toPts(clones);
    const xs = [...v, ...c].map((p) => p.x);
    if (!xs.length) { el.parentElement.innerHTML = `<div class="empty">No traffic recorded yet</div>`; return; }
    const span = Math.max(...xs) - Math.min(...xs);
    const col = series();
    const o = baseOpts({ interaction: { mode: "index", intersect: false } });
    o.scales.x = { ...o.scales.x, type: "linear", min: Math.min(...xs), max: Math.max(...xs), ticks: timeTicks(span) };
    o.plugins.tooltip.callbacks.title = (i) => fdate(i[0].parsed.x);
    const ds = (label, data, color) => ({ label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHoverBorderColor: css("--surface"), pointHoverBorderWidth: 2 });
    mk(el, { type: "line", data: { datasets: [ds("Views", v, col[0]), ds("Clones", c, col[1])] }, options: o });

    const top = S.stats.repos.filter((r) => r.views).sort((a, b) => b.views - a.views).slice(0, 10).map((r) => ({ n: r.name, v: r.views, repo: r.name }));
    barList($("#topViews"), top, fmt);
    const refs = {};
    for (const t of Object.values(S.traffic.repos || {})) for (const r of t.referrers || []) refs[r.ref] = (refs[r.ref] || 0) + r.count;
    barList($("#refs"), Object.entries(refs).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n, v]) => ({ n, v })), fmt);
  }

  // ───────────── table ─────────────
  const COLS = () => {
    const c = [
      { k: "name", l: "Repository", left: true },
      { k: "language", l: "Language", left: true },
      { k: "stars", l: "Stars" },
      { k: "forks", l: "Forks" },
      { k: "watchers", l: "Watchers" },
      { k: "issuesOpen", l: "Open issues" },
      { k: "prsOpen", l: "Open PRs" },
      { k: "commits", l: "Commits" },
      { k: "releases", l: "Releases" },
      { k: "downloads", l: "Downloads" },
    ];
    if (S.stats.trafficAvailable) c.push({ k: "views", l: "Views" }, { k: "clones", l: "Clones" });
    c.push({ k: "sizeKB", l: "Size" }, { k: "created", l: "Created" }, { k: "pushed", l: "Last push" });
    return c;
  };

  function filtered() {
    const q = S.q.trim().toLowerCase();
    return S.stats.repos.filter((r) => {
      if (S.tab === "sources" && r.fork) return false;
      if (S.tab === "forks" && !r.fork) return false;
      if (S.tab === "archived" && !r.archived) return false;
      if (S.tab === "templates" && !r.template) return false;
      if (S.tab === "releases" && !r.releases) return false;
      if (S.tab === "private" && !r.private) return false;
      if (S.lang && r.language !== S.lang) return false;
      if (S.topic && !r.topics.includes(S.topic)) return false;
      if (q && !(`${r.name} ${r.description || ""} ${r.topics.join(" ")} ${r.language || ""}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }

  function drawTable() {
    const cols = COLS();
    const { key, dir } = S.sort;
    const rows = filtered().sort((a, b) => {
      let x = a[key], y = b[key];
      if (x == null) x = typeof y === "string" ? "" : -1;
      if (y == null) y = typeof x === "string" ? "" : -1;
      if (typeof x === "string") return dir * x.localeCompare(y, "en", { sensitivity: "base" });
      return dir * (x - y) || b.stars - a.stars;
    });
    const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
    $("#repoCount").textContent = `${fmt(rows.length)} shown · ${fmt(sum("stars"))} stars · ${fmt(sum("forks"))} forks`;
    $("#activeTopic").innerHTML = S.topic
      ? `<div style="margin-bottom:10px"><button class="chip" id="clearTopic">Topic: <b>${esc(S.topic)}</b> ${ICON.close.replace("<svg", '<svg width="12" height="12"')}</button></div>` : "";
    $("#clearTopic")?.addEventListener("click", () => { S.topic = ""; drawTable(); });

    const shown = S.showAll ? rows : rows.slice(0, 50);
    const cell = (r, c) => {
      switch (c.k) {
        case "name":
          return `<td><div class="rname"><b>${esc(r.name)}${r.archived ? '<span class="badge arch">Archived</span>' : ""}${r.fork ? '<span class="badge">Fork</span>' : ""}${r.template ? '<span class="badge">Template</span>' : ""}${r.private ? '<span class="badge">Private</span>' : ""}</b><span>${esc(r.description || "")}</span></div></td>`;
        case "language":
          return `<td class="left">${r.language ? `<span class="lang"><i style="background:${esc(r.languageColor || "var(--muted)")}"></i>${esc(r.language)}</span>` : '<span class="zero">—</span>'}</td>`;
        case "sizeKB": return `<td>${size(r.sizeKB)}</td>`;
        case "created": return `<td title="${fdate(r.created)}">${fdate(r.created)}</td>`;
        case "pushed": return `<td title="${fdate(r.pushed)}">${ago(r.pushed)}</td>`;
        case "views": case "clones": return `<td>${r[c.k] == null ? '<span class="zero">—</span>' : zero(r[c.k])}</td>`;
        default: return `<td>${zero(r[c.k])}</td>`;
      }
    };
    $("#tbl").innerHTML = `
      <thead><tr>${cols.map((c) => `<th scope="col" data-k="${c.k}" ${c.left ? 'style="text-align:left"' : ""} ${key === c.k ? `aria-sort="${dir < 0 ? "descending" : "ascending"}"` : ""}>${c.l}</th>`).join("")}</tr></thead>
      <tbody>${shown.length ? shown.map((r) => `<tr data-repo="${esc(r.name)}" tabindex="0">${cols.map((c) => cell(r, c)).join("")}</tr>`).join("") : `<tr><td colspan="${cols.length}" class="empty" style="position:static">No repositories match</td></tr>`}</tbody>`;

    $("#tbl thead").addEventListener("click", (e) => {
      const th = e.target.closest("th"); if (!th) return;
      const k = th.dataset.k;
      S.sort = S.sort.key === k ? { key: k, dir: -S.sort.dir } : { key: k, dir: ["name", "language"].includes(k) ? 1 : -1 };
      drawTable();
    });
    $("#tbl tbody").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-repo]"); if (tr) openRepo(tr.dataset.repo); });
    $("#tbl tbody").addEventListener("keydown", (e) => { if (e.key === "Enter") { const tr = e.target.closest("tr[data-repo]"); if (tr) openRepo(tr.dataset.repo); } });

    $("#tblInfo").textContent = rows.length > shown.length ? `Showing ${shown.length} of ${rows.length}` : `${rows.length} repositories`;
    $("#tblMore").innerHTML = rows.length > 50 ? `<button class="chip" id="moreBtn">${S.showAll ? "Show fewer" : `Show all ${rows.length}`}</button>` : "";
    $("#moreBtn")?.addEventListener("click", () => { S.showAll = !S.showAll; drawTable(); });
  }

  // ───────────── repo dialog ─────────────
  let dlgCharts = [];
  function openRepo(name) {
    const r = S.stats.repos.find((x) => x.name === name);
    if (!r) return;
    if (location.hash !== "#repo=" + encodeURIComponent(name)) history.replaceState(null, "", "#repo=" + encodeURIComponent(name));
    const dlg = $("#repoDlg");
    dlgCharts.forEach((c) => c.destroy()); dlgCharts = [];
    const t = S.traffic.repos?.[r.full];
    const mini = [
      ["Stars", r.stars], ["Forks", r.forks], ["Watchers", r.watchers], ["Commits", r.commits],
      ["Open issues", r.issuesOpen], ["Closed issues", r.issuesClosed], ["Open PRs", r.prsOpen], ["Merged PRs", r.prsMerged],
      ["Releases", r.releases], ["Downloads", r.downloads], ["Branches", r.branches], ["Tags", r.tags],
    ];
    if (r.views != null) mini.push(["Views", r.views], ["Clones", r.clones]);
    const kv = [
      ["Created", fdate(r.created)], ["Last push", `${fdate(r.pushed)} (${ago(r.pushed)})`],
      r.archived ? ["Archived", r.archivedAt ? fdate(r.archivedAt) : "Yes"] : null,
      ["License", r.license || "None"], ["Size", size(r.sizeKB)], ["Default branch", r.defaultBranch || "—"],
      r.parent ? ["Forked from", `<a href="https://github.com/${esc(r.parent)}" rel="noopener">${esc(r.parent)}</a>`] : null,
      r.homepage ? ["Homepage", `<a href="${esc(r.homepage)}" rel="noopener">${esc(r.homepage.replace(/^https?:\/\//, ""))}</a>`] : null,
      r.latestRelease ? ["Latest release", `<a href="${esc(r.latestRelease.url)}" rel="noopener">${esc(r.latestRelease.tag)}</a> · ${fdate(r.latestRelease.date)}`] : null,
      r.discussions ? ["Discussions", fmt(r.discussions)] : null,
    ].filter(Boolean);
    dlg.innerHTML = `
      <div class="dlg-head">
        <div style="flex:1;min-width:0">
          <h3 id="dlgTitle">${esc(r.name)}${r.archived ? '<span class="badge arch">Archived</span>' : ""}${r.fork ? '<span class="badge">Fork</span>' : ""}${r.template ? '<span class="badge">Template</span>' : ""}</h3>
          <p>${esc(r.description || "No description")}</p>
          <p style="margin-top:8px"><a href="${esc(r.url)}" rel="noopener">Open on GitHub ↗</a></p>
        </div>
        <button class="icon-btn" id="dlgClose" aria-label="Close">${ICON.close}</button>
      </div>
      <div class="dlg-body">
        <div class="mini-kpis">${mini.map(([l, v]) => `<div><b class="num">${fmt(v)}</b><span>${l}</span></div>`).join("")}</div>
        ${r.topics.length ? `<div class="chips">${r.topics.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</div>` : ""}
        ${r.stars ? `<div class="card"><h3>Stars over time</h3><p class="hint">${fmt(r.stars)} stars</p><div class="chart-box short"><canvas id="dStars"></canvas></div></div>` : ""}
        ${r.weeklyCommits?.some((x) => x) ? `<div class="card"><h3>Your commits per week</h3><p class="hint">Last 52 weeks</p><div class="chart-box short"><canvas id="dCommits"></canvas></div></div>` : ""}
        ${t && (Object.keys(t.views || {}).length || Object.keys(t.clones || {}).length) ? `<div class="card"><h3>Views &amp; clones</h3><p class="hint">Per day, since tracking began</p><div class="chart-box short"><canvas id="dTraffic"></canvas></div><div class="legend"><span><i class="line" style="background:var(--s1)"></i>Views</span><span><i class="line" style="background:var(--s2)"></i>Clones</span></div></div>` : ""}
        <div class="grid g-2e">
          <div class="card"><h3>Details</h3><dl class="kv" style="margin-top:10px">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></div>
          <div class="card"><h3>Languages</h3><p class="hint">${r.languages.length ? bytes(r.languages.reduce((a, l) => a + l.bytes, 0)) + " of code" : ""}</p><div class="bars" id="dLangs"></div></div>
        </div>
        ${r.releaseList?.length ? `<div class="card"><h3>Releases</h3><p class="hint">${fmt(r.downloads)} downloads in total</p><div class="rel-list">${r.releaseList.map((x) => `<div><span>${esc(x.tag)}${x.prerelease ? '<span class="badge">pre</span>' : ""} <span class="muted">· ${fdate(x.date)}</span></span><span class="num ink2">${fmt(x.downloads)} ↓</span></div>`).join("")}</div></div>` : ""}
        ${t?.referrers?.length ? `<div class="card"><h3>Referrers</h3><p class="hint">Last 14 days</p><div class="bars" id="dRefs"></div></div>` : ""}
      </div>`;
    if (!dlg.open) dlg.showModal();
    $("#dlgClose").onclick = () => dlg.close();
    dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
    dlg.onclose = () => { dlgCharts.forEach((c) => c.destroy()); dlgCharts = []; history.replaceState(null, "", location.pathname + location.search); };

    barList($("#dLangs"), r.languages.map((l) => ({ n: l.name, v: l.pct, dot: l.color || css("--muted") })), (v) => v.toFixed(1) + "%");
    if (t?.referrers?.length) barList($("#dRefs"), t.referrers.map((x) => ({ n: x.ref, v: x.count })), fmt);

    const col = series();
    if ($("#dStars")) {
      const pts = clip(cumulative(r.starDays || {}), -Infinity);
      const span = pts.length ? pts[pts.length - 1].x - pts[0].x : 0;
      const o = baseOpts({ interaction: { mode: "index", intersect: false } });
      o.scales.x = { ...o.scales.x, type: "linear", min: pts[0]?.x, max: pts[pts.length - 1]?.x, ticks: timeTicks(span) };
      o.plugins.tooltip.callbacks.title = (i) => fdate(i[0].parsed.x);
      dlgCharts.push(new Chart($("#dStars"), { type: "line", data: { datasets: [{ label: "Stars", data: pts, borderColor: col[0], backgroundColor: css("--accent-wash"), fill: "origin", borderWidth: 2, pointRadius: 0, pointHoverRadius: 5 }] }, options: o }));
    }
    if ($("#dCommits")) {
      const w = r.weeklyCommits; const now = Date.now();
      const labels = w.map((_, i) => dateF.format(new Date(now - (w.length - 1 - i) * 7 * DAY)));
      const o = baseOpts();
      o.scales.x.ticks = { maxTicksLimit: 6, maxRotation: 0 };
      o.plugins.tooltip.callbacks.title = (i) => "Week of " + i[0].label;
      o.plugins.tooltip.callbacks.label = (c) => ` ${fmt(c.parsed.y)} commits`;
      dlgCharts.push(new Chart($("#dCommits"), { type: "bar", data: { labels, datasets: [{ label: "Commits", data: w, backgroundColor: col[0], borderRadius: { topLeft: 3, topRight: 3 }, borderSkipped: "start", barPercentage: 0.85, categoryPercentage: 0.95 }] }, options: o }));
    }
    if ($("#dTraffic")) {
      const toPts = (m) => Object.keys(m || {}).sort().map((d) => ({ x: Date.parse(d), y: m[d][0] }));
      const v = toPts(t.views), c = toPts(t.clones);
      const xs = [...v, ...c].map((p) => p.x);
      const o = baseOpts({ interaction: { mode: "index", intersect: false } });
      o.scales.x = { ...o.scales.x, type: "linear", min: Math.min(...xs), max: Math.max(...xs), ticks: timeTicks(Math.max(...xs) - Math.min(...xs)) };
      o.plugins.tooltip.callbacks.title = (i) => fdate(i[0].parsed.x);
      const ds = (label, data, color) => ({ label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: data.length < 30 ? 3 : 0, pointHoverRadius: 5 });
      dlgCharts.push(new Chart($("#dTraffic"), { type: "line", data: { datasets: [ds("Views", v, col[0]), ds("Clones", c, col[1])] }, options: o }));
    }
  }

  function readHash() {
    const m = location.hash.match(/^#repo=(.+)$/);
    if (m && S.stats) setTimeout(() => openRepo(decodeURIComponent(m[1])), 0);
  }

  // ───────────── theme ─────────────
  $("#themeBtn").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch {}
    if (S.stats) { const y = scrollY; render(); scrollTo(0, y); }
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (S.stats && !document.documentElement.dataset.theme) render(); });

  if (!window.Chart) { $("#loading").textContent = "Could not load the chart library. Check your connection and reload."; return; }
  load();
})();
