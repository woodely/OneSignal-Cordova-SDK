#!/usr/bin/env node

/**
 * OneSignal 2.16.2's podspec declares iOS 4.3. Xcode 27 no longer supports
 * that deployment target, so keep the OneSignal Pods target aligned with this
 * app's configured iOS 16.0 minimum after Cordova regenerates the Podfile.
 *
 * Also installs a UIApplication category that redirects the deprecated openURL:
 * to the modern openURL:options:completionHandler: API (required on iOS 18+).
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

// ---------- openURL fix for iOS 18+ ----------
const appDir = path.join(iosDir, 'App');
const destFile = path.join(appDir, 'UIApplication+OpenURLFix.m');

// Try several possible locations relative to this hook file
const candidates = [
  path.join(__dirname, '..', 'src', 'ios', 'UIApplication+OpenURLFix.m'),
  path.join(__dirname, 'src', 'ios', 'UIApplication+OpenURLFix.m'),
  path.join(__dirname, '..', 'UIApplication+OpenURLFix.m'),
  path.join(__dirname, 'UIApplication+OpenURLFix.m'),
];

const srcFile = candidates.find(p => fs.existsSync(p));

if (srcFile && fs.existsSync(appDir)) {
  fs.copyFileSync(srcFile, destFile);
  console.log('[openURL-fix] Copied UIApplication+OpenURLFix.m to', destFile);

  // Try to add the file to the Xcode project automatically
  try {
    const xcode = require('xcode');
    const pbxPath = path.join(iosDir, 'App.xcodeproj', 'project.pbxproj');
    if (fs.existsSync(pbxPath)) {
      const proj = xcode.project(pbxPath);
      proj.parseSync();
      const target = proj.getFirstTarget();
      const alreadyAdded = proj.hasFile('App/UIApplication+OpenURLFix.m');

      if (!alreadyAdded && target) {
        proj.addSourceFile('App/UIApplication+OpenURLFix.m', {}, target.uuid);
        fs.writeFileSync(pbxPath, proj.writeSync());
        console.log('[openURL-fix] Added UIApplication+OpenURLFix.m to Xcode project');
      } else if (alreadyAdded) {
        console.log('[openURL-fix] UIApplication+OpenURLFix.m already in Xcode project');
      }
    }
  } catch (err) {
    console.warn(
      '[openURL-fix] Could not auto-add to pbxproj (add the file manually in Xcode if needed):',
      err.message
    );
  }
} else if (!srcFile) {
  console.warn('[openURL-fix] Source UIApplication+OpenURLFix.m not found. Checked:', candidates);
}
