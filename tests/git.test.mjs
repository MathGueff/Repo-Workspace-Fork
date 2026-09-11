import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  checkoutRepos,
  discoverGitRepos,
  currentBranchName,
  pullRepos,
  syncRepos,
} from "../scripts/lib/git.mjs";

function git(cwd, args) {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} falhou: ${r.stderr || r.stdout}`);
  }
  return r;
}

describe("git switch", () => {
  /** @type {string} */
  let tmp;
  /** @type {string} */
  let cleanRepo;
  /** @type {string} */
  let dirtyRepo;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repo-workspace-git-"));
    cleanRepo = path.join(tmp, "clean");
    dirtyRepo = path.join(tmp, "dirty");

    for (const dir of [cleanRepo, dirtyRepo]) {
      fs.mkdirSync(dir);
      git(dir, ["init"]);
      git(dir, ["config", "user.email", "test@example.com"]);
      git(dir, ["config", "user.name", "Test"]);
      fs.writeFileSync(path.join(dir, "a.txt"), "a");
      git(dir, ["add", "a.txt"]);
      git(dir, ["commit", "-m", "init"]);
      git(dir, ["branch", "-M", "main"]);
      git(dir, ["branch", "feature"]);
    }

    fs.writeFileSync(path.join(dirtyRepo, "dirty.txt"), "x");
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("discoverGitRepos encontra clones com .git", () => {
    const names = discoverGitRepos(tmp);
    assert.deepEqual(names, ["clean", "dirty"]);
  });

  it("checkoutRepos troca branch limpa e pula working tree sujo", () => {
    const result = checkoutRepos({
      branch: "feature",
      repos: ["clean", "dirty"],
      reposRoot: tmp,
    });

    assert.equal(currentBranchName(cleanRepo), "feature");
    assert.equal(result.okCount, 1);
    assert.equal(result.skippedCount, 1);
    assert.equal(result.exitCode, 1);
  });

  it("checkoutRepos marca ok quando já está na branch", () => {
    const result = checkoutRepos({
      branch: "feature",
      repos: ["clean"],
      reposRoot: tmp,
    });
    assert.equal(result.okCount, 1);
    assert.equal(result.exitCode, 0);
  });
});

describe("git pull", () => {
  /** @type {string} */
  let tmp;
  /** @type {string} */
  let bare;
  /** @type {string} */
  let cleanRepo;
  /** @type {string} */
  let dirtyRepo;
  /** @type {string} */
  let behindRepo;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repo-workspace-pull-"));
    bare = path.join(tmp, "origin.git");
    cleanRepo = path.join(tmp, "clean");
    dirtyRepo = path.join(tmp, "dirty");
    behindRepo = path.join(tmp, "behind");

    git(tmp, ["init", "--bare", "-b", "main", bare]);

    const seed = path.join(tmp, "seed");
    fs.mkdirSync(seed);
    git(seed, ["init", "-b", "main"]);
    git(seed, ["config", "user.email", "test@example.com"]);
    git(seed, ["config", "user.name", "Test"]);
    fs.writeFileSync(path.join(seed, "a.txt"), "a");
    git(seed, ["add", "a.txt"]);
    git(seed, ["commit", "-m", "init"]);
    git(seed, ["remote", "add", "origin", bare]);
    git(seed, ["push", "-u", "origin", "main"]);

    for (const dir of [cleanRepo, dirtyRepo, behindRepo]) {
      git(tmp, ["clone", bare, dir]);
      git(dir, ["config", "user.email", "test@example.com"]);
      git(dir, ["config", "user.name", "Test"]);
    }

    fs.writeFileSync(path.join(dirtyRepo, "dirty.txt"), "x");

    fs.writeFileSync(path.join(seed, "a.txt"), "b");
    git(seed, ["add", "a.txt"]);
    git(seed, ["commit", "-m", "remote update"]);
    git(seed, ["push", "origin", "main"]);
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("pullRepos atualiza repo limpo, pula sujo e faz ff-only no atrasado", () => {
    const beforeContent = fs.readFileSync(
      path.join(behindRepo, "a.txt"),
      "utf8",
    );
    assert.equal(beforeContent, "a");

    const result = pullRepos({
      repos: ["clean", "dirty", "behind"],
      reposRoot: tmp,
    });

    assert.equal(result.okCount, 2);
    assert.equal(result.skippedCount, 1);
    assert.equal(result.errorCount, 0);
    assert.equal(result.exitCode, 1);
    assert.equal(
      fs.readFileSync(path.join(behindRepo, "a.txt"), "utf8"),
      "b",
    );
  });

  it("pullRepos marca ok quando já está atualizado", () => {
    const result = pullRepos({
      repos: ["clean"],
      reposRoot: tmp,
    });
    assert.equal(result.okCount, 1);
    assert.equal(result.exitCode, 0);
  });
});

describe("git sync", () => {
  /** @type {string} */
  let tmp;
  /** @type {string} */
  let bare;
  /** @type {string} */
  let cleanRepo;
  /** @type {string} */
  let dirtyRepo;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "repo-workspace-sync-"));
    bare = path.join(tmp, "origin.git");
    cleanRepo = path.join(tmp, "clean");
    dirtyRepo = path.join(tmp, "dirty");

    git(tmp, ["init", "--bare", "-b", "main", bare]);

    const seed = path.join(tmp, "seed");
    fs.mkdirSync(seed);
    git(seed, ["init", "-b", "main"]);
    git(seed, ["config", "user.email", "test@example.com"]);
    git(seed, ["config", "user.name", "Test"]);
    fs.writeFileSync(path.join(seed, "a.txt"), "a");
    git(seed, ["add", "a.txt"]);
    git(seed, ["commit", "-m", "init"]);
    git(seed, ["branch", "feature"]);
    git(seed, ["remote", "add", "origin", bare]);
    git(seed, ["push", "-u", "origin", "main"]);
    git(seed, ["push", "-u", "origin", "feature"]);

    git(seed, ["switch", "feature"]);
    fs.writeFileSync(path.join(seed, "a.txt"), "feature-content");
    git(seed, ["add", "a.txt"]);
    git(seed, ["commit", "-m", "feature update"]);
    git(seed, ["push", "origin", "feature"]);

    for (const dir of [cleanRepo, dirtyRepo]) {
      git(tmp, ["clone", bare, dir]);
      git(dir, ["config", "user.email", "test@example.com"]);
      git(dir, ["config", "user.name", "Test"]);
    }

    fs.writeFileSync(path.join(dirtyRepo, "dirty.txt"), "x");
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("syncRepos troca branch, puxa e pula working tree sujo", () => {
    assert.equal(currentBranchName(cleanRepo), "main");
    assert.equal(fs.readFileSync(path.join(cleanRepo, "a.txt"), "utf8"), "a");

    const result = syncRepos({
      branch: "feature",
      repos: ["clean", "dirty"],
      reposRoot: tmp,
    });

    assert.equal(result.okCount, 1);
    assert.equal(result.skippedCount, 1);
    assert.equal(result.errorCount, 0);
    assert.equal(result.exitCode, 1);
    assert.equal(currentBranchName(cleanRepo), "feature");
    assert.equal(
      fs.readFileSync(path.join(cleanRepo, "a.txt"), "utf8"),
      "feature-content",
    );
  });

  it("syncRepos na mesma branch só atualiza com pull", () => {
    const result = syncRepos({
      branch: "feature",
      repos: ["clean"],
      reposRoot: tmp,
    });
    assert.equal(result.okCount, 1);
    assert.equal(result.exitCode, 0);
    assert.equal(currentBranchName(cleanRepo), "feature");
  });
});
