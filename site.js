// Fills the download section from release data and marks the section the visitor is reading.
// Release data comes from one public repository. The page reads `release.json` next to it first
// (the deploy copies one there), then the GitHub API for the same repository, and shows
// "Downloads coming soon" when neither gives a usable release.
(() => {
  "use strict";

  const RELEASE_REPOSITORY = "nightshift-app/releases";
  const RELEASE_DATA_URL = "release.json";
  const REQUEST_TIMEOUT_MS = 6000;

  const RELEASES_PAGE = `https://github.com/${RELEASE_REPOSITORY}/releases`;
  const LATEST_RELEASE_PAGE = `${RELEASES_PAGE}/latest`;
  const API_URL = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`;

  const archOf = (name) => (/arm64|aarch64/i.test(name) ? "arm64" : "x64");
  const ASSET_MATCHERS = {
    "mac-arm64": (n) => /\.dmg$/i.test(n) && archOf(n) === "arm64",
    "mac-x64": (n) => /\.dmg$/i.test(n) && archOf(n) === "x64",
    "win-x64": (n) => /\.exe$/i.test(n) && archOf(n) === "x64",
    "win-arm64": (n) => /\.exe$/i.test(n) && archOf(n) === "arm64",
    "linux-x64": (n) => /\.AppImage$/i.test(n) && archOf(n) === "x64",
    "linux-arm64": (n) => /\.AppImage$/i.test(n) && archOf(n) === "arm64",
  };
  const LABELS = {
    "mac-arm64": "macOS",
    "mac-x64": "macOS (Intel)",
    "win-x64": "Windows",
    "win-arm64": "Windows (ARM)",
    "linux-x64": "Linux",
    "linux-arm64": "Linux (ARM)",
  };

  const isGitHubUrl = (value) =>
    typeof value === "string" && value.startsWith("https://github.com/");

  // Returns a clean release or null. Anything that is not shaped like a release is rejected, and
  // only github.com links are kept so a bad file cannot point a download button elsewhere.
  function parseRelease(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const version = String(raw.version ?? raw.tag_name ?? "").replace(/^v/i, "");
    if (!/^\d+\.\d+\.\d+/.test(version) || !Array.isArray(raw.assets)) return null;
    const assets = [];
    for (const asset of raw.assets) {
      if (!asset || typeof asset.name !== "string") continue;
      const url = asset.url ?? asset.browser_download_url;
      if (!isGitHubUrl(url)) continue;
      assets.push({ name: asset.name, url, size: Number.isFinite(asset.size) ? asset.size : 0 });
    }
    const page = raw.url ?? raw.html_url;
    const published = new Date(raw.publishedAt ?? raw.published_at ?? "");
    return {
      version,
      url: isGitHubUrl(page) ? page : LATEST_RELEASE_PAGE,
      publishedAt: Number.isNaN(published.getTime()) ? null : published,
      assets,
    };
  }

  const findAsset = (release, key) => release.assets.find((a) => ASSET_MATCHERS[key](a.name));
  const formatSize = (bytes) => (bytes > 0 ? `${Math.max(1, Math.round(bytes / 1e6))} MB` : "");

  async function getJson(url, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadRelease() {
    const local = parseRelease(await getJson(RELEASE_DATA_URL, { cache: "no-store" }));
    if (local) return local;
    return parseRelease(
      await getJson(API_URL, { headers: { Accept: "application/vnd.github+json" } }),
    );
  }

  async function detectPlatform() {
    const data = navigator.userAgentData;
    const agent = navigator.userAgent.toLowerCase();
    const platform = (data?.platform ?? navigator.platform ?? "").toLowerCase();
    let os = null;
    if (/android|iphone|ipad|ipod/.test(agent)) return null;
    if (platform.includes("mac") || agent.includes("mac os")) os = "mac";
    else if (platform.includes("win") || agent.includes("windows")) os = "win";
    else if (platform.includes("linux") || agent.includes("linux")) os = "linux";
    if (!os) return null;
    let arch = os === "mac" ? "arm64" : "x64";
    try {
      const high = await data?.getHighEntropyValues?.(["architecture"]);
      if (high?.architecture === "arm") arch = "arm64";
      else if (high?.architecture === "x86") arch = "x64";
    } catch {
      // Keep the default.
    }
    return `${os}-${arch}`;
  }

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  function setState(state) {
    document.documentElement.dataset.release = state;
  }

  // The card keeps a real link to the releases page, so it stays a crawlable anchor.
  function markUnavailable(card, message) {
    card.classList.add("unavailable");
    card.classList.remove("recommended");
    card.href = RELEASES_PAGE;
    const note = card.querySelector("[data-note]");
    if (note) note.textContent = message;
  }

  function renderSoon() {
    setState("soon");
    const summary = $("[data-release-summary]");
    if (summary)
      summary.textContent = "Downloads are coming soon. The first installers are being prepared.";
    for (const badge of $$("[data-release-badge]")) badge.textContent = "Downloads coming soon";
    const primary = $("[data-primary-download]");
    if (primary) primary.textContent = "Downloads coming soon";
    const detail = $("[data-primary-detail]");
    if (detail)
      detail.textContent = "Follow the releases page to hear when the first build is out.";
    for (const card of $$("[data-asset]")) markUnavailable(card, "Coming soon");
  }

  function renderRelease(release, recommended) {
    setState("ready");
    const date = release.publishedAt
      ? release.publishedAt.toLocaleDateString("en", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "";
    const summary = $("[data-release-summary]");
    if (summary)
      summary.textContent = `Nightshift ${release.version}${date ? `, released ${date}` : ""}.`;
    for (const badge of $$("[data-release-badge]"))
      badge.textContent = `Version ${release.version}`;
    for (const link of $$("[data-release-link]")) link.href = release.url;

    let primary = null;
    for (const card of $$("[data-asset]")) {
      const key = card.getAttribute("data-asset");
      const asset = findAsset(release, key);
      const note = card.querySelector("[data-note]");
      if (!asset) {
        markUnavailable(card, "Not in this release");
        continue;
      }
      card.hidden = false;
      card.classList.remove("unavailable");
      card.href = asset.url;
      const size = formatSize(asset.size);
      if (note) note.textContent = size ? `${asset.name} \u00b7 ${size}` : asset.name;
      if (key === recommended) {
        card.classList.add("recommended");
        primary = { key, asset };
      }
    }

    const button = $("[data-primary-download]");
    const detail = $("[data-primary-detail]");
    if (primary && button) {
      button.href = primary.asset.url;
      button.textContent = `Download for ${LABELS[primary.key]}`;
      const size = formatSize(primary.asset.size);
      if (detail) {
        detail.textContent = `Version ${release.version}${size ? ` \u00b7 ${size}` : ""} \u00b7 Other systems below.`;
      }
    } else {
      if (button) button.textContent = "Download Nightshift";
      if (detail) detail.textContent = `Version ${release.version} \u00b7 Pick your system below.`;
    }
  }

  function trackSections() {
    const links = new Map(
      $$("[data-rail] a[href^='#']").map((a) => [a.getAttribute("href").slice(1), a]),
    );
    if (!links.size || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          for (const [id, link] of links) {
            if (id === entry.target.id) link.setAttribute("aria-current", "true");
            else link.removeAttribute("aria-current");
          }
        }
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    for (const id of links.keys()) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }
  }

  async function init() {
    for (const link of $$("[data-releases-link]")) link.href = RELEASES_PAGE;
    trackSections();
    setState("loading");
    const [release, platform] = await Promise.all([loadRelease(), detectPlatform()]);
    if (release) renderRelease(release, platform);
    else renderSoon();
  }

  globalThis.NightshiftSite = { parseRelease, findAsset, RELEASE_REPOSITORY };
  if (typeof document !== "undefined") init();
})();
