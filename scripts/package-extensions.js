#!/usr/bin/env node
"use strict";

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");

function usage() {
  console.log(`Usage: node scripts/package-extensions.js [options]

Options:
  --configuration <Debug|Release>  Build configuration. Default: Release
  --output-directory <path>        Artifact output directory. Default: artifacts
  --skip-verify                    Skip npm run verify
  --skip-visualstudio              Skip Visual Studio VSIX packaging
  --skip-vscode                    Skip VS Code-compatible VSIX packaging
  --skip-jetbrains                 Skip JetBrains plugin packaging
  --help                           Show this help

Visual Studio VSIX packaging requires Windows and the Visual Studio SDK build tools.
On non-Windows platforms the Visual Studio package step is skipped automatically.`);
}

function parseArgs(argv) {
  const options = {
    configuration: "Release",
    outputDirectory: path.join(root, "artifacts"),
    skipVerify: false,
    skipVisualStudio: false,
    skipVSCode: false,
    skipJetBrains: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--configuration" || arg === "-c") {
      const value = argv[++i];
      if (value !== "Debug" && value !== "Release") {
        throw new Error("--configuration must be Debug or Release");
      }
      options.configuration = value;
      continue;
    }
    if (arg === "--output-directory" || arg === "--output" || arg === "-o") {
      const value = argv[++i];
      if (!value) throw new Error("--output-directory requires a path");
      options.outputDirectory = path.resolve(process.cwd(), value);
      continue;
    }
    if (arg === "--skip-verify") {
      options.skipVerify = true;
      continue;
    }
    if (arg === "--skip-visualstudio") {
      options.skipVisualStudio = true;
      continue;
    }
    if (arg === "--skip-vscode") {
      options.skipVSCode = true;
      continue;
    }
    if (arg === "--skip-jetbrains") {
      options.skipJetBrains = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function step(name, action) {
  console.log("");
  console.log(`==> ${name}`);
  return action();
}

function run(command, args, cwd) {
  const result = childProcess.spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status}`);
  }
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function normalizeForGradle(value) {
  return value.replace(/\\/g, "/");
}

function compareVersions(a, b) {
  const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const count = Math.max(left.length, right.length);
  for (let i = 0; i < count; i += 1) {
    const delta = (left[i] || 0) - (right[i] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function getLatestVsSdkToolsPath() {
  const packagesRoot = path.join(os.homedir(), ".nuget", "packages", "microsoft.vssdk.buildtools");
  if (!fs.existsSync(packagesRoot)) return null;

  const packages = fs.readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareVersions)
    .reverse();

  for (const version of packages) {
    const tools = path.join(packagesRoot, version, "tools");
    if (fs.existsSync(tools)) return tools;
  }

  return null;
}

function readVsixVersion(manifestPath) {
  const manifest = readText(manifestPath);
  const match = manifest.match(/<Identity\b[^>]*\bVersion="([^"]+)"/);
  if (!match) throw new Error(`Could not find Identity Version in ${manifestPath}`);
  return match[1];
}

function packageVisualStudio(options, packages) {
  if (process.platform !== "win32") {
    console.log("");
    console.log("==> Package Visual Studio VSIX");
    console.log("Skipping Visual Studio VSIX: this package step requires Windows and the Visual Studio SDK build tools.");
    return;
  }

  step("Package Visual Studio VSIX", () => {
    const project = path.join(root, "extensions", "visualstudio", "ContextToAgent.csproj");
    const manifest = path.join(root, "extensions", "visualstudio", "source.extension.vsixmanifest");
    const version = readVsixVersion(manifest);
    const vsixPath = path.join(options.outputDirectory, `ContextToAgent-visualstudio-${version}.vsix`);
    const projectDir = path.dirname(project);
    const outputPath = path.join(projectDir, "bin", options.configuration, "net472") + path.sep;
    const intermediatePath = path.join(projectDir, "obj", options.configuration, "net472") + path.sep;
    const assemblyPath = path.join(outputPath, "ContextToAgent.VisualStudio.dll");
    const vstoolsPath = getLatestVsSdkToolsPath();

    run("dotnet", ["restore", project], root);

    const msbuildArgs = [
      "msbuild",
      project,
      "/t:Build;GeneratePkgDef;CreateVsixContainer",
      `/p:Configuration=${options.configuration}`,
      `/p:IntermediateOutputPath=${intermediatePath}`,
      `/p:OutputPath=${outputPath}`,
      `/p:OutDir=${outputPath}`,
      `/p:CreatePkgDefAssemblyToProcess=${assemblyPath}`,
      `/p:TargetVsixContainer=${vsixPath}`,
      "/p:DeployExtension=false",
    ];

    if (vstoolsPath) {
      msbuildArgs.push(`/p:VSToolsPath=${vstoolsPath}`);
    }

    run("dotnet", msbuildArgs, root);

    if (!fs.existsSync(vsixPath)) {
      throw new Error(`Visual Studio VSIX was not created: ${vsixPath}`);
    }

    packages.push(vsixPath);
  });
}

function packageVSCode(options, packages) {
  step("Package VS Code-compatible VSIX", () => {
    const vscodeDir = path.join(root, "extensions", "vscode");
    const manifest = path.join(vscodeDir, "package.json");
    const packageJson = readJson(manifest);
    const vsixPath = path.join(options.outputDirectory, `ContextToAgent-vscode-${packageJson.version}.vsix`);

    run("npx", ["--yes", "@vscode/vsce", "package", "--allow-missing-repository", "--out", vsixPath], vscodeDir);

    if (!fs.existsSync(vsixPath)) {
      throw new Error(`VS Code VSIX was not created: ${vsixPath}`);
    }

    packages.push(vsixPath);
  });
}

function packageJetBrains(options, packages) {
  step("Package JetBrains plugin", () => {
    const jetbrainsDir = path.join(root, "extensions", "jetbrains");
    const gradleWrapper = process.platform === "win32"
      ? path.join(jetbrainsDir, "gradlew.bat")
      : path.join(jetbrainsDir, "gradlew");
    const gradleCommand = fs.existsSync(gradleWrapper) ? gradleWrapper : "gradle";
    const gradleProjectCache = path.join(root, ".tmp-gradle-project-cache");
    const gradleBuildDir = path.join(root, ".tmp-jetbrains-build");
    const kotlinProjectDir = path.join(root, ".tmp-kotlin-project");
    const kotlinTempDir = path.join(root, ".tmp-kotlin-temp");

    for (const directory of [gradleProjectCache, gradleBuildDir, kotlinProjectDir, kotlinTempDir]) {
      ensureDirectory(directory);
    }

    const gradleArgs = [
      "--project-cache-dir",
      normalizeForGradle(gradleProjectCache),
      `-Dorg.gradle.project.buildDir=${normalizeForGradle(gradleBuildDir)}`,
      `-Pkotlin.project.persistent.dir=${normalizeForGradle(kotlinProjectDir)}`,
      "-Pkotlin.compiler.execution.strategy=in-process",
      `-Djava.io.tmpdir=${normalizeForGradle(kotlinTempDir)}`,
      "buildPlugin",
    ];

    run(gradleCommand, gradleArgs, jetbrainsDir);

    const distributionsDir = path.join(gradleBuildDir, "distributions");
    const distributions = fs.readdirSync(distributionsDir)
      .filter((name) => name.endsWith(".zip"))
      .map((name) => ({
        name,
        fullPath: path.join(distributionsDir, name),
        mtimeMs: fs.statSync(path.join(distributionsDir, name)).mtimeMs,
      }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    if (distributions.length === 0) {
      throw new Error("JetBrains plugin ZIP was not created.");
    }

    const distribution = distributions[0];
    const version = distribution.name
      .replace(/\.zip$/, "")
      .replace(/^context-to-agent-jetbrains-/, "");
    const target = path.join(options.outputDirectory, `ContextToAgent-jetbrains-${version}.zip`);
    fs.copyFileSync(distribution.fullPath, target);
    packages.push(target);
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  ensureDirectory(options.outputDirectory);

  if (!options.skipVerify) {
    step("Verify project", () => run("npm", ["run", "verify"], root));
  }

  const packages = [];

  if (!options.skipVisualStudio) {
    packageVisualStudio(options, packages);
  }
  if (!options.skipVSCode) {
    packageVSCode(options, packages);
  }
  if (!options.skipJetBrains) {
    packageJetBrains(options, packages);
  }

  console.log("");
  console.log("Packages created:");
  for (const packagePath of packages) {
    console.log(`  ${packagePath}`);
  }
}

try {
  main();
} catch (error) {
  console.error("");
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
}
