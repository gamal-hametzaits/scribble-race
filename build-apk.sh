#!/usr/bin/env bash
# Builds the signed APK without Gradle: aapt2 + javac + d8 + zipalign + apksigner.
# Needs: ANDROID_BT (build-tools 34 dir), ANDROID_JAR (platform 34 android.jar), JDK 17, KEYSTORE, KSP (password env).
set -euo pipefail
cd "$(dirname "$0")/android"
rm -rf build && mkdir -p build/classes build/dex build/assets/www res/mipmap-xxxhdpi
base64 -d ic_launcher.png.b64 > res/mipmap-xxxhdpi/ic_launcher.png
cp ../web/{index.html,style.css,game.js,physics.js,peerjs.min.js} build/assets/www/
"$ANDROID_BT/aapt2" compile --dir res -o build/res.zip
"$ANDROID_BT/aapt2" link -o build/unsigned.apk -I "$ANDROID_JAR" --manifest AndroidManifest.xml -A build/assets build/res.zip --auto-add-overlay
javac --release 8 -classpath "$ANDROID_JAR" -d build/classes src/com/gamal/scribblerace/*.java
"$ANDROID_BT/d8" --min-api 24 --lib "$ANDROID_JAR" --output build/dex $(find build/classes -name '*.class')
(cd build/dex && zip -q ../unsigned.apk classes.dex)
"$ANDROID_BT/zipalign" -f -p 4 build/unsigned.apk build/aligned.apk
"$ANDROID_BT/apksigner" sign --ks "$KEYSTORE" --ks-key-alias scribble --ks-pass env:KSP --key-pass env:KSP --out build/scribble-race.apk build/aligned.apk
echo "built android/build/scribble-race.apk"
