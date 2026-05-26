#!/bin/bash
# =============================================================
#  CinePRO — Gera ícones nativos pros instaladores
#
#  Entrada:  icons/logo.jpg (qualquer tamanho >= 256x256)
#  Saídas:
#    icons/logo.icns   (macOS — multi-resolução até 1024@2x)
#    icons/logo.ico    (Windows — multi-resolução até 256x256)
# =============================================================

set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SRC="$ROOT/icons/logo.jpg"
TMP="$HERE/.icons-tmp"

if [ ! -f "$SRC" ]; then
  echo "❌ Arquivo $SRC não encontrado"
  exit 1
fi

echo "→ Gerando ícones de $SRC..."

rm -rf "$TMP"
mkdir -p "$TMP/Logo.iconset"

# 1. Upscale pra base 1024x1024
sips -z 1024 1024 "$SRC" --out "$TMP/master.png" > /dev/null

# 2. Geração das resoluções pro .iconset (padrão Apple)
sips -z 16   16   "$TMP/master.png" --out "$TMP/Logo.iconset/icon_16x16.png"      > /dev/null
sips -z 32   32   "$TMP/master.png" --out "$TMP/Logo.iconset/icon_16x16@2x.png"   > /dev/null
sips -z 32   32   "$TMP/master.png" --out "$TMP/Logo.iconset/icon_32x32.png"      > /dev/null
sips -z 64   64   "$TMP/master.png" --out "$TMP/Logo.iconset/icon_32x32@2x.png"   > /dev/null
sips -z 128  128  "$TMP/master.png" --out "$TMP/Logo.iconset/icon_128x128.png"    > /dev/null
sips -z 256  256  "$TMP/master.png" --out "$TMP/Logo.iconset/icon_128x128@2x.png" > /dev/null
sips -z 256  256  "$TMP/master.png" --out "$TMP/Logo.iconset/icon_256x256.png"    > /dev/null
sips -z 512  512  "$TMP/master.png" --out "$TMP/Logo.iconset/icon_256x256@2x.png" > /dev/null
sips -z 512  512  "$TMP/master.png" --out "$TMP/Logo.iconset/icon_512x512.png"    > /dev/null
sips -z 1024 1024 "$TMP/master.png" --out "$TMP/Logo.iconset/icon_512x512@2x.png" > /dev/null

# 3. .icns (macOS nativo)
iconutil -c icns -o "$ROOT/icons/logo.icns" "$TMP/Logo.iconset"
echo "✓ Gerado: icons/logo.icns ($(du -h "$ROOT/icons/logo.icns" | cut -f1))"

# 4. .ico (Windows) — empacota PNGs em ICO via Python
python3 "$HERE/png-to-ico.py" \
  "$TMP/Logo.iconset/icon_16x16.png" \
  "$TMP/Logo.iconset/icon_32x32.png" \
  "$TMP/Logo.iconset/icon_128x128.png" \
  "$TMP/Logo.iconset/icon_256x256.png" \
  > "$ROOT/icons/logo.ico"
echo "✓ Gerado: icons/logo.ico ($(du -h "$ROOT/icons/logo.ico" | cut -f1))"

# 5. PNG limpo pra usos diversos (welcome screen do installer, etc)
cp "$TMP/master.png" "$ROOT/icons/logo-1024.png"
sips -z 256 256 "$TMP/master.png" --out "$ROOT/icons/logo-256.png" > /dev/null
echo "✓ Gerado: icons/logo-1024.png, logo-256.png"

# 6. Limpa
rm -rf "$TMP"

echo ""
echo "✅ Ícones gerados em icons/"
ls -lh "$ROOT/icons/" | grep -E "logo\." | awk '{print "  " $9 " (" $5 ")"}'
