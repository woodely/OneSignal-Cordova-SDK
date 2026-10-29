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

// ---------- OneSignal deployment target ----------
if (fs.existsSync(podfilePath)) {
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

  // Cordova's iOS prepare can run pod install before after_prepare hooks.
  execFileSync('pod', ['install'], { cwd: iosDir, stdio: 'inherit' });
}

// ---------- openURL fix ----------
const appDir = path.join(iosDir, 'App');
const destFile = path.join(appDir, 'UIApplication+OpenURLFix.m');
const srcFile = path.join(__dirname, '..', 'src', 'ios', 'UIApplication+OpenURLFix.m');

if (fs.existsSync(srcFile) && fs.existsSync(appDir)) {
  fs.copyFileSync(srcFile, destFile);
  console.log('Copied UIApplication+OpenURLFix.m');

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
        console.log('Added UIApplication+OpenURLFix.m to Xcode project');
      } else if (alreadyAdded) {
        console.log('UIApplication+OpenURLFix.m already in Xcode project');
      }
    }
  } catch (err) {
    console.warn(
      'Could not auto-add UIApplication+OpenURLFix.m to the Xcode project. ' +
      'Add it manually once in Xcode (right-click App group → Add Files). ' +
      'Error:', err.message
    );
  }
} else if (!fs.existsSync(srcFile)) {
  console.warn('openURL fix source not found at:', srcFile);
}
