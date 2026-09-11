import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./root.mjs";

const DEFAULT_GIT_IGNORE = new Set([
  "node_modules",
  ".git",
  ".tools",
  ".cursor",
  ".docs",
  ".doc",
  ".issues",
  ".reviews",
  "scripts",
  "tests",
]);

/**
 * @param {string} repoPath
 * @param {string[]} args
 */
export function runGit(repoPath, args) {
  const result = spawnSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  const text = [result.stdout, result.stderr].filter(Boolean).join("").trim();
  return {
    exitCode: result.status ?? 1,
    text,
  };
}

export function isGitRepo(repoPath) {
  return existsSync(repoPath) && existsSync(join(repoPath, ".git"));
}

/**
 * Pastas irmãs com `.git` sob a raiz.
 * @param {string} [reposRoot]
 * @param {Iterable<string>} [extraIgnore]
 * @returns {string[]}
 */
export function discoverGitRepos(reposRoot = ROOT, extraIgnore = []) {
  if (!existsSync(reposRoot)) return [];

  const ignore = new Set([...DEFAULT_GIT_IGNORE, ...extraIgnore]);

  return readdirSync(reposRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !ignore.has(d.name))
    .map((d) => d.name)
    .filter((name) => isGitRepo(join(reposRoot, name)))
    .sort((a, b) => a.localeCompare(b));
}

export function localBranchExists(repoPath, branch) {
  return (
    runGit(repoPath, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])
      .exitCode === 0
  );
}

export function remoteBranchExists(repoPath, branch) {
  return (
    runGit(repoPath, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/remotes/origin/${branch}`,
    ]).exitCode === 0
  );
}

export function currentBranchName(repoPath) {
  const current = runGit(repoPath, ["branch", "--show-current"]);
  return current.text || "(detached)";
}

/**
 * @param {{ branch: string, repos: string[], reposRoot?: string }} options
 * @returns {{ okCount: number, errorCount: number, skippedCount: number, exitCode: number }}
 */
export function checkoutRepos({ branch, repos, reposRoot = ROOT }) {
  let okCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (const name of repos) {
    const repoPath = join(reposRoot, name);
    const prefix = `[${name}]`;

    if (!existsSync(repoPath)) {
      console.log(`${prefix} erro: pasta não encontrada (${repoPath})`);
      errorCount++;
      continue;
    }

    if (!isGitRepo(repoPath)) {
      console.log(`${prefix} erro: não é um repositório git`);
      errorCount++;
      continue;
    }

    const status = runGit(repoPath, ["status", "--porcelain"]);
    if (status.exitCode !== 0) {
      console.log(`${prefix} erro: falha ao ler status (${status.text})`);
      errorCount++;
      continue;
    }
    if (status.text !== "") {
      console.log(`${prefix} pulado: working tree sujo`);
      skippedCount++;
      continue;
    }

    const fromBranch = currentBranchName(repoPath);

    if (fromBranch === branch) {
      console.log(`${prefix} ok: já em ${branch}`);
      okCount++;
      continue;
    }

    let switchResult;
    if (localBranchExists(repoPath, branch)) {
      switchResult = runGit(repoPath, ["switch", branch]);
    } else if (remoteBranchExists(repoPath, branch)) {
      switchResult = runGit(repoPath, ["switch", "--track", `origin/${branch}`]);
    } else {
      console.log(
        `${prefix} erro: branch '${branch}' não encontrada (local nem origin/${branch})`,
      );
      errorCount++;
      continue;
    }

    if (switchResult.exitCode !== 0) {
      const reason = switchResult.text || `exit ${switchResult.exitCode}`;
      console.log(`${prefix} erro: falha no switch (${reason})`);
      errorCount++;
      continue;
    }

    console.log(`${prefix} ok: ${fromBranch} -> ${branch}`);
    okCount++;
  }

  console.log("");
  console.log(`Resumo: ${okCount} ok, ${errorCount} erro, ${skippedCount} pulado`);

  return {
    okCount,
    errorCount,
    skippedCount,
    exitCode: errorCount + skippedCount > 0 ? 1 : 0,
  };
}

/**
 * `git fetch` + `git pull --ff-only` na branch atual de cada clone.
 * Working tree sujo ou detached HEAD → pulado (sem stash/merge/force).
 *
 * @param {{ repos: string[], reposRoot?: string }} options
 * @returns {{ okCount: number, errorCount: number, skippedCount: number, exitCode: number }}
 */
export function pullRepos({ repos, reposRoot = ROOT }) {
  let okCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (const name of repos) {
    const repoPath = join(reposRoot, name);
    const prefix = `[${name}]`;

    if (!existsSync(repoPath)) {
      console.log(`${prefix} erro: pasta não encontrada (${repoPath})`);
      errorCount++;
      continue;
    }

    if (!isGitRepo(repoPath)) {
      console.log(`${prefix} erro: não é um repositório git`);
      errorCount++;
      continue;
    }

    const status = runGit(repoPath, ["status", "--porcelain"]);
    if (status.exitCode !== 0) {
      console.log(`${prefix} erro: falha ao ler status (${status.text})`);
      errorCount++;
      continue;
    }
    if (status.text !== "") {
      console.log(`${prefix} pulado: working tree sujo`);
      skippedCount++;
      continue;
    }

    const branch = currentBranchName(repoPath);
    if (!branch || branch === "(detached)") {
      console.log(`${prefix} pulado: HEAD detached`);
      skippedCount++;
      continue;
    }

    const fetchResult = runGit(repoPath, ["fetch", "origin"]);
    if (fetchResult.exitCode !== 0) {
      const reason = fetchResult.text || `exit ${fetchResult.exitCode}`;
      console.log(`${prefix} erro: falha no fetch (${reason})`);
      errorCount++;
      continue;
    }

    const pullResult = runGit(repoPath, ["pull", "--ff-only"]);
    if (pullResult.exitCode !== 0) {
      const reason = pullResult.text || `exit ${pullResult.exitCode}`;
      console.log(`${prefix} erro: falha no pull --ff-only (${reason})`);
      errorCount++;
      continue;
    }

    const detail = pullResult.text || "Already up to date.";
    console.log(`${prefix} ok: ${branch} — ${detail.split("\n")[0]}`);
    okCount++;
  }

  console.log("");
  console.log(`Resumo: ${okCount} ok, ${errorCount} erro, ${skippedCount} pulado`);

  return {
    okCount,
    errorCount,
    skippedCount,
    exitCode: errorCount + skippedCount > 0 ? 1 : 0,
  };
}

/**
 * Fetch + switch para `branch` + pull --ff-only (um passo por repo).
 * Working tree sujo → pulado (sem stash/merge/force).
 *
 * @param {{ branch: string, repos: string[], reposRoot?: string }} options
 * @returns {{ okCount: number, errorCount: number, skippedCount: number, exitCode: number }}
 */
export function syncRepos({ branch, repos, reposRoot = ROOT }) {
  let okCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (const name of repos) {
    const repoPath = join(reposRoot, name);
    const prefix = `[${name}]`;

    if (!existsSync(repoPath)) {
      console.log(`${prefix} erro: pasta não encontrada (${repoPath})`);
      errorCount++;
      continue;
    }

    if (!isGitRepo(repoPath)) {
      console.log(`${prefix} erro: não é um repositório git`);
      errorCount++;
      continue;
    }

    const status = runGit(repoPath, ["status", "--porcelain"]);
    if (status.exitCode !== 0) {
      console.log(`${prefix} erro: falha ao ler status (${status.text})`);
      errorCount++;
      continue;
    }
    if (status.text !== "") {
      console.log(`${prefix} pulado: working tree sujo`);
      skippedCount++;
      continue;
    }

    const fromBranch = currentBranchName(repoPath);

    const fetchResult = runGit(repoPath, ["fetch", "origin"]);
    if (fetchResult.exitCode !== 0) {
      const reason = fetchResult.text || `exit ${fetchResult.exitCode}`;
      console.log(`${prefix} erro: falha no fetch (${reason})`);
      errorCount++;
      continue;
    }

    if (fromBranch !== branch) {
      let switchResult;
      if (localBranchExists(repoPath, branch)) {
        switchResult = runGit(repoPath, ["switch", branch]);
      } else if (remoteBranchExists(repoPath, branch)) {
        switchResult = runGit(repoPath, [
          "switch",
          "--track",
          `origin/${branch}`,
        ]);
      } else {
        console.log(
          `${prefix} erro: branch '${branch}' não encontrada (local nem origin/${branch})`,
        );
        errorCount++;
        continue;
      }

      if (switchResult.exitCode !== 0) {
        const reason = switchResult.text || `exit ${switchResult.exitCode}`;
        console.log(`${prefix} erro: falha no switch (${reason})`);
        errorCount++;
        continue;
      }
    }

    const pullResult = runGit(repoPath, ["pull", "--ff-only"]);
    if (pullResult.exitCode !== 0) {
      const reason = pullResult.text || `exit ${pullResult.exitCode}`;
      console.log(`${prefix} erro: falha no pull --ff-only (${reason})`);
      errorCount++;
      continue;
    }

    const detail = pullResult.text || "Already up to date.";
    const switchPart =
      fromBranch === branch ? `já em ${branch}` : `${fromBranch} -> ${branch}`;
    console.log(`${prefix} ok: ${switchPart} — ${detail.split("\n")[0]}`);
    okCount++;
  }

  console.log("");
  console.log(`Resumo: ${okCount} ok, ${errorCount} erro, ${skippedCount} pulado`);

  return {
    okCount,
    errorCount,
    skippedCount,
    exitCode: errorCount + skippedCount > 0 ? 1 : 0,
  };
}
