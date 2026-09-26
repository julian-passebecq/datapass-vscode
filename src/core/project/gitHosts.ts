/**
 * Git hosts (0.16): which service a repository lives on — GitHub, Azure DevOps or GitLab — its
 * identity, and the web pages a person opens from DataPass (the repository, its pull requests,
 * its pipelines, its boards or issues). Pure: URL construction only. DataPass never calls these
 * services' APIs and sends nothing to them; a page opens on the person's click, after a confirmation.
 *
 * One repository has several addresses. Azure DevOps has five for the same repository:
 *
 *   https://dev.azure.com/{org}/{project}/_git/{repo}
 *   https://{org}@dev.azure.com/{org}/{project}/_git/{repo}                    what "Clone" copies
 *   git@ssh.dev.azure.com:v3/{org}/{project}/{repo}                             SSH
 *   https://{org}.visualstudio.com/[DefaultCollection/]{project}/_git/{repo}    legacy
 *   {org}@vs-ssh.visualstudio.com:v3/{org}/{project}/{repo}                     legacy SSH
 *
 * remoteIdentity() maps all of them to dev.azure.com/{org}/{project}/_git/{repo}, so a clone made
 * with one form is recognised as the repository a manifest declares with another.
 */

export type GitHostKind = "github" | "azure-devops" | "gitlab";
export const GIT_HOST_LABELS: Readonly<Record<GitHostKind, string>> = { github: "GitHub", "azure-devops": "Azure DevOps", gitlab: "GitLab" };

/** Host and path segments of a remote (decoded, original case), without protocol, credentials, port, query or ".git". */
export interface RemoteParts { host: string; segments: string[] }

const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

export function remoteParts(url: string | undefined): RemoteParts | undefined {
  if (!url) return undefined;
  const u = url.trim();
  let host: string, path: string;
  const scp = /^[A-Za-z0-9._-]+@([A-Za-z0-9.-]+):(.+)$/.exec(u);
  if (scp) { host = scp[1]!; path = scp[2]!; }
  else {
    const m = /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(u);
    if (!m) return undefined;
    host = m[1]!;
    path = m[2]!.split(/[?#]/)[0]!;
  }
  if (!/^[A-Za-z0-9.-]+$/.test(host)) return undefined;
  const segments = path.replace(/\/+$/, "").replace(/\.git$/i, "").split("/").filter(Boolean).map(decode);
  if (!segments.length) return undefined;
  return { host: host.toLowerCase(), segments };
}

/** Organization, project and repository of an Azure DevOps remote, in any of its forms. */
export function azureDevOpsParts(p: RemoteParts): { org: string; project: string; repo: string } | undefined {
  const s = p.segments;
  const isGit = (x: string | undefined) => x?.toLowerCase() === "_git";
  if (p.host === "dev.azure.com") {
    if (s.length === 4 && isGit(s[2])) return { org: s[0]!, project: s[1]!, repo: s[3]! };
    // {org}/_git/{repo}: the repository of the project that has the same name.
    if (s.length === 3 && isGit(s[1])) return { org: s[0]!, project: s[2]!, repo: s[2]! };
    return undefined;
  }
  if (p.host === "ssh.dev.azure.com" || p.host === "vs-ssh.visualstudio.com") {
    return s.length === 4 && s[0]!.toLowerCase() === "v3" ? { org: s[1]!, project: s[2]!, repo: s[3]! } : undefined;
  }
  const legacy = /^([a-z0-9][a-z0-9-]*)\.visualstudio\.com$/.exec(p.host);
  if (legacy) {
    const rest = s[0]?.toLowerCase() === "defaultcollection" ? s.slice(1) : s;
    if (rest.length === 3 && isGit(rest[1])) return { org: legacy[1]!, project: rest[0]!, repo: rest[2]! };
    if (rest.length === 2 && isGit(rest[0])) return { org: legacy[1]!, project: rest[1]!, repo: rest[1]! };
  }
  return undefined;
}

const encodeAll = (segments: readonly string[]) => segments.map(s => encodeURIComponent(s)).join("/");

/**
 * host/path, lowercased, without protocol, credentials, port or .git: the identity of a Git remote.
 * Azure DevOps remotes, in any form, become dev.azure.com/{org}/{project}/_git/{repo}.
 */
export function remoteIdentity(url: string | undefined): string | undefined {
  const p = remoteParts(url);
  if (!p) return undefined;
  const ado = azureDevOpsParts(p);
  const id = ado ? `dev.azure.com/${encodeAll([ado.org, ado.project, "_git", ado.repo])}` : `${p.host}/${encodeAll(p.segments)}`;
  return id.toLowerCase();
}

/** The repository's own name (original case): the folder a clone usually gets. */
export function repositoryName(url: string | undefined): string | undefined {
  const p = remoteParts(url);
  if (!p) return undefined;
  return azureDevOpsParts(p)?.repo ?? p.segments[p.segments.length - 1];
}

export interface GitHostRepo {
  kind: GitHostKind;
  label: string;
  /** Host of the web pages (github.com, dev.azure.com, gitlab.com, gitlab.example.com). */
  host: string;
  /** https page of the repository. */
  web: string;
  /** Repository name, and its owner / organization and project where the host has them. */
  name: string;
  owner?: string;
  org?: string;
  project?: string;
}

/** The host a remote lives on, when DataPass knows it. A self-managed GitLab is recognised when its host name starts with "gitlab.". */
export function gitHostOf(url: string | undefined): GitHostRepo | undefined {
  const p = remoteParts(url);
  if (!p) return undefined;
  const ado = azureDevOpsParts(p);
  if (ado) {
    return { kind: "azure-devops", label: GIT_HOST_LABELS["azure-devops"], host: "dev.azure.com", web: `https://dev.azure.com/${encodeAll([ado.org, ado.project])}/_git/${encodeURIComponent(ado.repo)}`, name: ado.repo, org: ado.org, project: ado.project };
  }
  if (p.host === "github.com" || p.host === "www.github.com" || p.host === "ssh.github.com") {
    if (p.segments.length !== 2) return undefined;
    return { kind: "github", label: GIT_HOST_LABELS.github, host: "github.com", web: `https://github.com/${encodeAll(p.segments)}`, name: p.segments[1]!, owner: p.segments[0] };
  }
  if (p.host === "gitlab.com" || p.host === "altssh.gitlab.com" || /^gitlab\.[a-z0-9.-]+$/.test(p.host)) {
    if (p.segments.length < 2) return undefined;
    const host = p.host === "altssh.gitlab.com" ? "gitlab.com" : p.host;
    return { kind: "gitlab", label: GIT_HOST_LABELS.gitlab, host, web: `https://${host}/${encodeAll(p.segments)}`, name: p.segments[p.segments.length - 1]!, owner: p.segments.slice(0, -1).join("/") };
  }
  return undefined;
}

export type WebLinkId = "repository" | "pull-requests" | "pipelines" | "boards";
export const WEB_LINK_IDS: readonly WebLinkId[] = ["repository", "pull-requests", "pipelines", "boards"];
export interface WebLink { id: WebLinkId; label: string; url: string }

/** The repository's pages on its host: repository, pull (merge) requests, pipelines / Actions, boards / issues. */
export function repositoryWebLinks(url: string | undefined): WebLink[] {
  const h = gitHostOf(url);
  if (!h) return [];
  switch (h.kind) {
    case "github": return [
      { id: "repository", label: "Repository", url: h.web },
      { id: "pull-requests", label: "Pull requests", url: `${h.web}/pulls` },
      { id: "pipelines", label: "Actions (workflow runs)", url: `${h.web}/actions` },
      { id: "boards", label: "Issues", url: `${h.web}/issues` }
    ];
    case "azure-devops": {
      const project = `https://dev.azure.com/${encodeAll([h.org!, h.project!])}`;
      return [
        { id: "repository", label: "Repository (Repos)", url: h.web },
        { id: "pull-requests", label: "Pull requests", url: `${h.web}/pullrequests` },
        { id: "pipelines", label: "Pipelines", url: `${project}/_build` },
        { id: "boards", label: "Boards (work items)", url: `${project}/_workitems` }
      ];
    }
    case "gitlab": return [
      { id: "repository", label: "Repository", url: h.web },
      { id: "pull-requests", label: "Merge requests", url: `${h.web}/-/merge_requests` },
      { id: "pipelines", label: "Pipelines", url: `${h.web}/-/pipelines` },
      { id: "boards", label: "Issues", url: `${h.web}/-/issues` }
    ];
  }
}

/**
 * The only user name DataPass accepts in a remote: Azure DevOps puts the organization before "@"
 * in the address its Clone button copies (https://{org}@dev.azure.com/{org}/…), and in its legacy
 * SSH address ({org}@vs-ssh.visualstudio.com:v3/{org}/…). A name that differs from the
 * organization could be a token, so it is refused like any other credential.
 */
export const AZURE_HTTPS_WITH_ORG = /^https:\/\/([A-Za-z0-9][A-Za-z0-9._-]*)@dev\.azure\.com\/\1\/[^\s]+$/;
export const AZURE_LEGACY_SSH = /^([A-Za-z0-9][A-Za-z0-9._-]*)@vs-ssh\.visualstudio\.com:v3\/\1\/[A-Za-z0-9._%/-]+$/;
