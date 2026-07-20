#!/bin/bash
# =============================================================
#  CinePRO — Build unificado .pkg (macOS)
#
#  Gera UM ÚNICO instalador que coloca:
#    /Applications/CinePRO.app                        ← app desktop (Electron)
#    /Library/Application Support/Adobe/CEP/...       ← plugin CEP do Premiere
#
#  Uso: ./build.sh [versão]   # ex: ./build.sh 1.0.0
# =============================================================

set -e

VERSION="${1:-1.0.0}"
# Remove o prefixo "v" se vier (ex: "v1.0.0" → "1.0.0")
VERSION="${VERSION#v}"

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DIST="$ROOT/installer/dist"
BUILD="$HERE/.build"
PAYLOAD="$BUILD/payload"
ELECTRON_DIR="$ROOT/desktop-app"

# Nome estável (sem versão) — facilita link permanente na LP
OUTPUT_NAME="CinePRO.pkg"

echo "════════════════════════════════════════════════════"
echo "  Building CinePRO v$VERSION installer (.pkg)"
echo "════════════════════════════════════════════════════"

# 1. Build da Electron .app (se ainda não tiver)
echo "→ Buildando desktop app (Electron)..."
if [ ! -d "$ELECTRON_DIR/node_modules" ]; then
  ( cd "$ELECTRON_DIR" && npm install --silent )
fi
( cd "$ELECTRON_DIR" && npx electron-builder --mac --dir 2>&1 | tail -5 )

# A .app gerada vai pra installer/dist/mac-arm64/CinePRO.app
ELECTRON_APP="$DIST/mac-arm64/CinePRO.app"
if [ ! -d "$ELECTRON_APP" ]; then
  ELECTRON_APP="$DIST/mac/CinePRO.app"
fi

if [ ! -d "$ELECTRON_APP" ]; then
  echo "❌ Não achei a CinePRO.app gerada pelo Electron"
  exit 1
fi

echo "  ✓ App em: $ELECTRON_APP ($(du -sh "$ELECTRON_APP" | cut -f1))"

# 2. Limpa e prepara payload
rm -rf "$BUILD"
mkdir -p "$PAYLOAD/Applications"
mkdir -p "$PAYLOAD/Library/Application Support/Adobe/CEP/extensions/CinePRO"
mkdir -p "$DIST"

# 3. Copia a .app pra /Applications/
echo "→ Copiando CinePRO.app pra /Applications..."
cp -R "$ELECTRON_APP" "$PAYLOAD/Applications/"

# 4. Copia o plugin CEP pra Library/.../extensions/CinePRO/
echo "→ Copiando plugin CEP..."
PLUGIN_DEST="$PAYLOAD/Library/Application Support/Adobe/CEP/extensions/CinePRO"
rsync -a \
  --exclude='/installer' \
  --exclude='/desktop-app' \
  --exclude='/firebase' \
  --exclude='/.claude' \
  --exclude='/.github' \
  --exclude='/audit' \
  --exclude='/manifest' \
  --exclude='/landing-page' \
  --exclude='/node_modules' \
  --exclude='*.log' \
  --exclude='.DS_Store' \
  --exclude='SETUP.md' \
  --exclude='INICIO_RAPIDO.md' \
  --exclude='serve.py' \
  "$ROOT/" "$PLUGIN_DEST/"

# Bundle do manifest pré-gerado (boot offline-safe)
if [ -f "$ROOT/manifest/dist/manifest.json" ]; then
  echo "→ Bundling manifest pré-gerado..."
  cp "$ROOT/manifest/dist/manifest.json" "$PLUGIN_DEST/manifest.json"
  echo "  ✓ Manifest: $(du -h "$PLUGIN_DEST/manifest.json" | cut -f1)"
else
  echo "⚠️  manifest.json não encontrado — plugin vai usar fallback live ou CDN"
fi

# v1.3: Bundled Essentials — ~750 assets universais em /Library/Application Support/CinePRO/bundle
BUNDLE_SRC="$ROOT/bundle/dist"
BUNDLE_DEST="$PAYLOAD/Library/Application Support/CinePRO/bundle"
if [ -d "$BUNDLE_SRC" ] && [ -f "$BUNDLE_SRC/manifest-bundle.json" ]; then
  echo "→ Bundling Essentials Pack (assets universais)..."
  mkdir -p "$BUNDLE_DEST"
  rsync -a "$BUNDLE_SRC/" "$BUNDLE_DEST/"
  echo "  ✓ Bundle: $(du -sh "$BUNDLE_DEST" | cut -f1) ($(find "$BUNDLE_DEST" -type f | wc -l | tr -d ' ') arquivos)"
else
  echo "ℹ️  Bundle Essentials não encontrado em $BUNDLE_SRC — instalador vai sem essa otimização"
fi

echo "  ✓ Plugin: $(du -sh "$PLUGIN_DEST" | cut -f1)"
echo "  ✓ Payload total: $(du -sh "$PAYLOAD" | cut -f1)"

# 5. Empacota o componente
echo "→ Empacotando componente..."
# Component plist com BundleIsVersionChecked=false: sem isso o Installer PULA
# a substituição do .app quando o instalado tem CFBundleVersion "maior" que o
# payload (nos mordeu no re-baseline 1.6.x -> 1.0).
COMPONENTS="$BUILD/components.plist"
pkgbuild --analyze --root "$PAYLOAD" "$COMPONENTS"
i=0
while /usr/libexec/PlistBuddy -c "Print :$i" "$COMPONENTS" >/dev/null 2>&1; do
  /usr/libexec/PlistBuddy -c "Set :$i:BundleIsVersionChecked false" "$COMPONENTS" 2>/dev/null || true
  i=$((i+1))
done
echo "  ✓ Version-check desligado em $i bundle(s)"
pkgbuild \
  --root "$PAYLOAD" \
  --component-plist "$COMPONENTS" \
  --identifier "com.cinepro.plugin" \
  --version "$VERSION" \
  --scripts "$HERE/scripts" \
  --ownership recommended \
  "$BUILD/CinePRO.pkg"

# 6. Instalador com UI
echo "→ Construindo instalador final..."
productbuild \
  --distribution "$HERE/distribution.xml" \
  --resources "$HERE/resources" \
  --package-path "$BUILD" \
  --version "$VERSION" \
  "$DIST/${OUTPUT_NAME}"

# 7. Aplica o ícone CinePRO no .pkg
PNG_LOGO="$ROOT/icons/logo-1024.png"
PKG_FILE="$DIST/${OUTPUT_NAME}"
if [ -f "$PNG_LOGO" ] && command -v Rez >/dev/null && command -v SetFile >/dev/null; then
  echo "→ Aplicando ícone CinePRO no .pkg..."
  CARRIER="$BUILD/_icon-carrier.png"
  RSRC="$BUILD/_icon.rsrc"
  cp "$PNG_LOGO" "$CARRIER"
  /usr/bin/sips -i "$CARRIER" >/dev/null
  /usr/bin/DeRez -only icns "$CARRIER" > "$RSRC"
  /usr/bin/Rez -append "$RSRC" -o "$PKG_FILE"
  /usr/bin/SetFile -a C "$PKG_FILE"
  echo "  ✓ Ícone aplicado"
fi

# 8. Limpa intermediários (mantém só o .pkg final)
rm -rf "$BUILD"

echo ""
echo "✅ Pronto!"
echo ""
echo "   Arquivo:  $PKG_FILE"
echo "   Tamanho:  $(du -h "$PKG_FILE" | cut -f1)"
echo "   Inclui:   /Applications/CinePRO.app + plugin CEP"
echo ""
