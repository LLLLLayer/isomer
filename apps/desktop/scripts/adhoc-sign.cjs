/** electron-builder afterPack hook: ad-hoc sign the mac bundle. An unsigned
 * (invalid-signature) app is SIGKILLed on Apple Silicon; ad-hoc keeps the
 * download launchable until a real Developer ID + notarization exists. */
const { execSync } = require('node:child_process')

exports.default = function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`
  execSync(`codesign --force --deep --sign - "${app}"`, { stdio: 'inherit' })
}
