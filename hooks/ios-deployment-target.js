#!/usr/bin/env node

/**
 * OneSignal 2.16.2's podspec declares iOS 4.3. Xcode 27 no longer supports
 * that deployment target, so keep the OneSignal Pods target aligned with this
 * app's configured iOS 16.0 minimum after Cordova regenerates the Podfile.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = process.env.CORDOVA_ROOT || process.cwd();
const iosDir = path.join(projectRoot, 'platforms', 'ios');
const podfilePath = path.join(iosDir, 'Podfile');
const marker = '# OneSignal iOS deployment target override (managed by plugin)';

if (!fs.existsSync(podfilePath)) {
  // The plugin can also be prepared for a non-iOS platform.
  process.exit(0);
}

let podfile = fs.readFileSync(podfilePath, 'utf8');
const alreadyConfigured = podfile.includes(marker);

const override = [
  `    ${marker}`,
  "    installer.pods_project.targets.each do |target|",
  "      next unless target.name == 'OneSignal'",
  '      target.build_configurations.each do |config|',
  "        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '16.0'",
  '      end',
  '    end',
].join('\n');

const postInstallStart = /^post_install\s+do\s+\|installer\|\s*$/m;
const match = postInstallStart.exec(podfile);

if (!alreadyConfigured && match) {
  // Cordova-generated Podfiles use a top-level, unindented `end` to close
  // post_install. Insert the override into that block to avoid declaring a
  // second CocoaPods post_install hook.
  const blockStart = match.index + match[0].length;
  const closingEnd = /^end\s*$/m;
  closingEnd.lastIndex = blockStart;
  const endMatch = closingEnd.exec(podfile);
  if (!endMatch) {
    throw new Error(`Could not locate the end of the Podfile post_install block: ${podfilePath}`);
  }
  podfile = podfile.slice(0, endMatch.index) + `${override}\n` + podfile.slice(endMatch.index);
} else if (!alreadyConfigured) {
  podfile += `\npost_install do |installer|\n${override}\nend\n`;
}

if (!alreadyConfigured) {
  fs.writeFileSync(podfilePath, podfile);
}

// Cordova's iOS prepare can run pod install before after_prepare hooks. Run it
// again so the deployment target override is applied to the generated Pods project.
execFileSync('pod', ['install'], { cwd: iosDir, stdio: 'inherit' });
