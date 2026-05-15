/**
 * Bundles the iOS JS + assets using Metro's programmatic API.
 * No Expo CLI, no network. Useful when you need an offline jsbundle
 * (e.g. embedding in an Xcode-driven release build).
 *
 * Usage:
 *   node scripts/bundle-ios.js [bundleOut] [assetsDest]
 *
 * Defaults:
 *   bundleOut  = <project>/dist/main.jsbundle
 *   assetsDest = dirname(bundleOut)
 *
 * Output layout matches what `react-native bundle` produces, so the
 * resulting tree can be dropped into an .app bundle as-is.
 */
const fs = require('fs');
const path = require('path');
const Metro = require('metro');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const BUNDLE_OUT  = process.argv[2] || path.join(PROJECT_ROOT, 'dist', 'main.jsbundle');
const ASSETS_OUT  = process.argv[3] || path.dirname(BUNDLE_OUT);
const PLATFORM    = 'ios';

// Mirrors the layout react-native bundle writes:
//   <assetsDest>/<httpServerLocation>/<name>[@<scale>x].<type>
function assetDestPath(asset, scale) {
  const suffix = scale === 1 ? '' : `@${scale}x`;
  return path.join(
    asset.httpServerLocation.replace(/^\/+/, ''),
    `${asset.name}${suffix}.${asset.type}`,
  );
}

async function writeAssets(assets, destRoot) {
  let written = 0;
  for (const asset of assets) {
    for (let i = 0; i < asset.scales.length; i++) {
      const src = asset.files[i];
      const rel = assetDestPath(asset, asset.scales[i]);
      const dest = path.join(destRoot, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      written++;
    }
  }
  return written;
}

async function main() {
  console.log('Loading Metro config…');
  const config = await Metro.loadConfig({
    config: path.join(PROJECT_ROOT, 'metro.config.js'),
    projectRoot: PROJECT_ROOT,
  });

  fs.mkdirSync(path.dirname(BUNDLE_OUT), { recursive: true });
  fs.mkdirSync(ASSETS_OUT, { recursive: true });

  console.log(`Bundling JS → ${BUNDLE_OUT}`);
  // Use bundleOut (not out): Metro rewrites `out` to end in `.js`, which
  // would turn main.jsbundle into main.jsbundle.js.
  const result = await Metro.runBuild(config, {
    entry: 'index.js',
    bundleOut: BUNDLE_OUT,
    platform: PLATFORM,
    dev: false,
    minify: true,
    sourceMap: false,
    assets: true,
  });

  const assetCount = await writeAssets(result.assets ?? [], ASSETS_OUT);
  console.log(`Wrote ${assetCount} asset file(s) → ${ASSETS_OUT}`);
  console.log('Done.');
}

// Metro spawns transform workers and watchers that can keep the event loop
// alive after the build resolves. Force exit so this script is usable in CI.
main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });
