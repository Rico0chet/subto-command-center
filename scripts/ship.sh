#!/bin/bash
# Build the Windows installer and split it for delivery. Usage: scripts/ship.sh 0.4.0
set -e
V="$1"; cd "$(dirname "$0")/.."
sed -i "s/\"version\": \"[0-9.]*\"/\"version\": \"$V\"/" package.json
npm run vendor >/dev/null
npx vite build >/dev/null
npm test 2>&1 | grep -E "^# (pass|fail)"
export WINEDEBUG=-all
npx electron-builder --win nsis --x64 >/dev/null 2>&1
F=release/SubTo-Command-Center-Setup-$V.exe
O=/mnt/user-data/outputs/v${V//./}
rm -rf "$O"; mkdir -p "$O"
split -b 25M -d -a 2 "$F" "$O/installer.part"
H=$(sha256sum "$F" | cut -d' ' -f1)
PARTS=$(cd "$O" && ls installer.part* | tr '\n' '+' | sed 's/+$//')
printf '@echo off\r\ncd /d "%%~dp0"\r\necho Building the SubTo Command Center %s installer...\r\ncopy /b %s "..\\SubTo-Command-Center-Setup-%s.exe" >nul\r\nif errorlevel 1 (echo Something went wrong. & pause & exit /b 1)\r\necho.\r\necho Done! The installer is in your subto command hub folder:\r\necho SubTo-Command-Center-Setup-%s.exe\r\necho.\r\necho Expected SHA256: %s\r\ncertutil -hashfile "..\\SubTo-Command-Center-Setup-%s.exe" SHA256\r\npause\r\n' "$V" "$PARTS" "$V" "$V" "$H" "$V" > "$O/Build-Installer.bat"
zip -qr "$O/source-$V.zip" . -x "node_modules/*" "release*/*" "dist-renderer/*"
ls "$O"
