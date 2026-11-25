import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = path.resolve(desktopDir, '../..');
const apiDir = path.join(repoRoot, 'apps/api');
const stageDir = path.join(desktopDir, 'stage');
const stagedApi = path.join(stageDir, 'api');
const releaseDir = path.join(desktopDir, 'release');
const appPath = path.join(releaseDir, 'DartClip.app');
const dmgPath = path.join(releaseDir, 'DartClip-arm64.dmg');
const contents = path.join(appPath, 'Contents');
const resources = path.join(contents, 'Resources');
const sqliteClient = path.join(apiDir, 'node_modules/.prisma/sqlite-client');
const sqliteInit = path.join(apiDir, 'prisma/sqlite-init.sql');
const webDist = path.join(repoRoot, 'apps/web/dist-desktop');
const workerDir = path.join(repoRoot, 'worker/desktop/dist/dartclip-worker');
const electronApp = path.join(desktopDir, 'node_modules/electron/dist/Electron.app');
const icon = path.join(repoRoot, 'apps/web/public/app-icon-1024.png');

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: repoRoot, stdio: 'inherit', ...options });
}

function copy(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  run('cp', ['-a', source, target]);
}

function recreate(target) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
}

function stageApi() {
  run('pnpm', ['--filter', 'api', 'deploy', '--prod', '--legacy', stagedApi], {
    env: { ...process.env, npm_config_ignore_scripts: 'true' },
  });
  const stagedDist = path.join(stagedApi, 'dist');
  fs.rmSync(stagedDist, { recursive: true, force: true });
  copy(path.join(apiDir, 'dist'), stagedDist);
  copy(sqliteInit, path.join(stagedApi, 'prisma/sqlite-init.sql'));
  const stagedSqliteClient = path.join(stagedApi, 'node_modules/.prisma/sqlite-client');
  fs.rmSync(stagedSqliteClient, { recursive: true, force: true });
  copy(sqliteClient, stagedSqliteClient);

  // The API imports enums and Prisma null sentinels from @prisma/client in both modes.
  // Deploy doesn't carry the client generated in the workspace's pnpm virtual store.
  const workspaceRequire = createRequire(path.join(apiDir, 'package.json'));
  const deployedRequire = createRequire(path.join(stagedApi, 'package.json'));
  const generated = path.dirname(createRequire(workspaceRequire.resolve('@prisma/client')).resolve('.prisma/client/default'));
  const deployedClient = deployedRequire.resolve('@prisma/client');
  const stagedGenerated = path.resolve(path.dirname(deployedClient), '../../.prisma/client');
  if (path.relative(stagedApi, stagedGenerated).startsWith('..')) {
    throw new Error('The deployed Prisma dependency resolves outside the staged API.');
  }
  fs.rmSync(stagedGenerated, { recursive: true, force: true });
  copy(generated, stagedGenerated);

  // Electron's Node won't strip TypeScript published under node_modules. Make a real,
  // standalone package and transpile its entry point before putting it there.
  const stagedShared = path.join(stagedApi, 'node_modules/@clipper/shared');
  const shared = path.join(repoRoot, 'packages/shared');
  recreate(stagedShared);
  copy(path.join(shared, 'src'), path.join(stagedShared, 'src'));
  const manifest = JSON.parse(fs.readFileSync(path.join(shared, 'package.json'), 'utf8'));
  const ts = workspaceRequire('typescript');
  const { outputText } = ts.transpileModule(fs.readFileSync(path.join(stagedShared, 'src/index.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  fs.writeFileSync(path.join(stagedShared, 'index.cjs'), outputText);
  manifest.main = './index.cjs';
  manifest.exports['.'] = './index.cjs';
  fs.writeFileSync(path.join(stagedShared, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  // Prune broken or out-of-bundle workspace symlinks left by `pnpm deploy --legacy`
  // (e.g. .pnpm/node_modules/{web,api}) so macOS `codesign --verify --deep --strict` succeeds cleanly.
  pruneExternalSymlinks(path.join(stagedApi, 'node_modules'), stagedApi);
}

function pruneExternalSymlinks(dir, rootDir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      let target;
      try { target = fs.realpathSync(full); }
      catch { target = null; }
      const rel = target ? path.relative(rootDir, target) : null;
      if (!target || !rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
        fs.unlinkSync(full);
      }
    } else if (entry.isDirectory()) {
      pruneExternalSymlinks(full, rootDir);
    }
  }
}

function makeIcon() {
  const iconset = path.join(stageDir, 'AppIcon.iconset');
  fs.mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const pixels = size * scale;
      const filename = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
      run('sips', ['-z', String(pixels), String(pixels), icon, '--out', path.join(iconset, filename)]);
    }
  }
  run('iconutil', ['-c', 'icns', iconset, '-o', path.join(resources, 'AppIcon.icns')]);
}

function renameBundle(version) {
  const plist = path.join(contents, 'Info.plist');
  const entries = {
    CFBundleName: 'DartClip',
    CFBundleDisplayName: 'DartClip',
    CFBundleIdentifier: 'site.rencraft.dartclip',
    CFBundleExecutable: 'DartClip',
    CFBundleIconFile: 'AppIcon',
    CFBundleShortVersionString: version,
    CFBundleVersion: version,
  };
  for (const [key, value] of Object.entries(entries)) {
    const pb = '/usr/libexec/PlistBuddy';
    let exists = true;
    try { execFileSync(pb, ['-c', `Print :${key}`, plist], { stdio: 'ignore' }); }
    catch { exists = false; }
    run(pb, ['-c', exists ? `Set :${key} ${value}` : `Add :${key} string ${value}`, plist]);
  }
}

function main() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('Mac packaging requires an Apple Silicon Mac running arm64 Node.');
  }
  const required = [path.join(apiDir, 'dist/main.js'), sqliteInit, sqliteClient,
    path.join(webDist, 'index.html'), path.join(workerDir, 'dartclip-worker'), electronApp, icon];
  const missing = required.filter((file) => !fs.existsSync(file));
  if (missing.length) {
    throw new Error(`Missing prebuilt inputs:\n${missing.join('\n')}\nInstall dependencies and run pnpm --filter desktop package:mac:full.`);
  }
  const architectures = execFileSync('lipo', ['-archs', path.join(electronApp, 'Contents/MacOS/Electron')], { encoding: 'utf8' });
  if (!architectures.trim().split(/\s+/).includes('arm64')) throw new Error('The installed Electron build does not support arm64.');

  fs.mkdirSync(releaseDir, { recursive: true });
  // Unique staging prevents an interrupted build from being mistaken for the current one.
  recreate(stageDir);
  try {
    stageApi();
    fs.rmSync(appPath, { recursive: true, force: true });
    copy(electronApp, appPath);
    fs.renameSync(path.join(contents, 'MacOS/Electron'), path.join(contents, 'MacOS/DartClip'));
    fs.rmSync(path.join(resources, 'default_app.asar'), { force: true });
    makeIcon();
    const { version } = JSON.parse(fs.readFileSync(path.join(desktopDir, 'package.json'), 'utf8'));
    renameBundle(version);
    for (const file of ['package.json', 'main.js', 'preload.js', 'settings-store.js', 'static-server.js', 'api-process.js']) {
      copy(path.join(desktopDir, file), path.join(resources, 'app', file));
    }
    copy(webDist, path.join(resources, 'web'));
    // Ship runtime inputs only, not unrelated files copied by deploy.
    for (const file of ['package.json', 'dist', 'prisma/sqlite-init.sql', 'node_modules']) {
      copy(path.join(stagedApi, file), path.join(resources, 'api', file));
    }
    copy(workerDir, path.join(resources, 'dartclip-worker'));
    run('codesign', ['--force', '--deep', '--sign', '-', appPath]);

    const dmgStage = path.join(stageDir, 'dmg');
    copy(appPath, path.join(dmgStage, 'DartClip.app'));
    fs.symlinkSync('/Applications', path.join(dmgStage, 'Applications'));
    run('hdiutil', ['create', '-volname', 'DartClip', '-srcfolder', dmgStage, '-ov', '-format', 'UDZO', dmgPath]);
    console.log(`Packaged:\n${appPath}\n${dmgPath}`);
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

try { main(); }
catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
