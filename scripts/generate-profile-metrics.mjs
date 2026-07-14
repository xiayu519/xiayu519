import { writeFile } from "node:fs/promises";

const username = process.env.METRICS_USER || "xiayu519";
const token = process.env.GITHUB_TOKEN || "";

const publicHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": `${username}-profile-metrics`,
  "X-GitHub-Api-Version": "2022-11-28",
};

async function githubJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...publicHeaders, ...(options.headers || {}) },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }
  return response.json();
}

const user = await githubJson(`https://api.github.com/users/${username}`);
const repositories = await githubJson(
  `https://api.github.com/users/${username}/repos?per_page=100&type=owner&sort=updated`,
);

const ownedRepositories = repositories.filter(
  (repository) => !repository.fork && repository.name !== username,
);

const languageTotals = new Map();
for (const repository of ownedRepositories) {
  const languages = await githubJson(repository.languages_url);
  for (const [language, bytes] of Object.entries(languages)) {
    languageTotals.set(language, (languageTotals.get(language) || 0) + bytes);
  }
}

const starredRepositories = await githubJson(
  `https://api.github.com/users/${username}/starred?per_page=100`,
);

let contributions = {
  totalCommitContributions: 0,
  totalIssueContributions: 0,
  totalPullRequestContributions: 0,
  totalPullRequestReviewContributions: 0,
  contributionCalendar: { totalContributions: 0 },
};

if (token) {
  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          totalCommitContributions
          totalIssueContributions
          totalPullRequestContributions
          totalPullRequestReviewContributions
          contributionCalendar { totalContributions }
        }
      }
    }
  `;
  const result = await githubJson("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables: { login: username } }),
  });
  if (result.errors?.length) {
    throw new Error(result.errors.map((error) => error.message).join("; "));
  }
  contributions = result.data.user.contributionsCollection;
}

const totalLanguageBytes = [...languageTotals.values()].reduce(
  (sum, value) => sum + value,
  0,
);
const languages = [...languageTotals.entries()]
  .sort((left, right) => right[1] - left[1])
  .slice(0, 8)
  .map(([name, bytes]) => ({
    name,
    bytes,
    percentage: totalLanguageBytes ? (bytes / totalLanguageBytes) * 100 : 0,
  }));

const languageColors = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  "C#": "#178600",
  Python: "#3572A5",
  PowerShell: "#012456",
  ShaderLab: "#222c37",
  Shell: "#89e051",
  Batchfile: "#C1F12E",
  C: "#555555",
  "C++": "#f34b7d",
  Java: "#b07219",
  Lua: "#000080",
};

const escapeXml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const number = new Intl.NumberFormat("en-US");
const joinedYears = Math.max(
  0,
  Math.floor((Date.now() - new Date(user.created_at).getTime()) / 31_556_952_000),
);

const activityRows = [
  `${number.format(contributions.totalCommitContributions)} commits`,
  `${number.format(contributions.totalPullRequestContributions)} pull requests`,
  `${number.format(contributions.totalPullRequestReviewContributions)} pull request reviews`,
  `${number.format(contributions.totalIssueContributions)} issues`,
  `${number.format(contributions.contributionCalendar.totalContributions)} contributions`,
];

const communityRows = [
  `${number.format(user.public_repos)} public repositories`,
  `${number.format(user.followers)} followers`,
  `Following ${number.format(user.following)} users`,
  `Starred ${number.format(starredRepositories.length)} repositories`,
  `${number.format(languages.length)} languages`,
];

const rowText = (rows, x, startY) =>
  rows
    .map(
      (text, index) =>
        `<text class="item" x="${x}" y="${startY + index * 24}">• ${escapeXml(text)}</text>`,
    )
    .join("\n");

let barX = 40;
const barWidth = 720;
const languageSegments = languages
  .map((language, index) => {
    const width =
      index === languages.length - 1
        ? 40 + barWidth - barX
        : Math.max(1, (language.percentage / 100) * barWidth);
    const segment = `<rect x="${barX.toFixed(2)}" y="365" width="${width.toFixed(2)}" height="12" fill="${languageColors[language.name] || "#8b949e"}" />`;
    barX += width;
    return segment;
  })
  .join("\n");

const languageLegend = languages
  .map((language, index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 40 + column * 370;
    const y = 410 + row * 28;
    const color = languageColors[language.name] || "#8b949e";
    return `<circle cx="${x + 6}" cy="${y - 5}" r="6" fill="${color}" />
      <text class="item" x="${x + 20}" y="${y}">${escapeXml(language.name)} · ${language.percentage.toFixed(1)}%</text>`;
  })
  .join("\n");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="530" viewBox="0 0 800 530" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(username)} GitHub profile metrics</title>
  <desc id="description">Public GitHub activity and programming language statistics.</desc>
  <style>
    .title { font: 700 22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #0969da; }
    .subtitle { font: 400 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #636c76; }
    .heading { font: 600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #0969da; }
    .item { font: 400 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #1f2328; }
    .divider { stroke: #d0d7de; stroke-width: 1; }
    @media (prefers-color-scheme: dark) {
      .title, .heading { fill: #4493f8; }
      .subtitle { fill: #9198a1; }
      .item { fill: #f0f6fc; }
      .divider { stroke: #3d444d; }
    }
  </style>
  <text class="title" x="40" y="42">${escapeXml(username)}</text>
  <text class="subtitle" x="40" y="67">Joined GitHub ${joinedYears} years ago · Followed by ${number.format(user.followers)} users</text>
  <line class="divider" x1="40" y1="88" x2="760" y2="88" />

  <text class="heading" x="40" y="123">Activity in the last year</text>
  ${rowText(activityRows, 40, 153)}

  <text class="heading" x="420" y="123">Community stats</text>
  ${rowText(communityRows, 420, 153)}

  <line class="divider" x1="40" y1="315" x2="760" y2="315" />
  <text class="heading" x="40" y="345">Most used languages</text>
  ${languageSegments}
  ${languageLegend}
</svg>
`;

await writeFile("github-metrics-left.svg", svg, "utf8");
console.log(
  `Generated github-metrics-left.svg with ${languages.length} languages from ${ownedRepositories.length} repositories`,
);
