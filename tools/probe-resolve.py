#!/usr/bin/env python3
# =============================================================
#  CinePRO — Probe do DaVinci Resolve (ADR-010)
#
#  Responde a pergunta que decide a arquitetura: o scripting
#  EXTERNO funciona nesta instalação, ou só de dentro do Resolve?
#
#  Se funcionar, o app pode dirigir o Resolve direto (Option C) e o
#  usuário nunca precisa abrir Workspace > Scripts. Se não, ficamos
#  na Option B (fila + script), que funciona no free.
#
#  SÓ LEITURA — não cria, move nem altera nada no seu projeto.
#
#  Uso:  abra o Resolve com um projeto, então:
#        python3 tools/probe-resolve.py
# =============================================================

import os
import sys

API = "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting"
LIB = "/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so"

os.environ.setdefault("RESOLVE_SCRIPT_API", API)
os.environ.setdefault("RESOLVE_SCRIPT_LIB", LIB)
sys.path.append(os.path.join(API, "Modules"))


def main():
    print("── CinePRO · probe do Resolve ──\n")

    try:
        import DaVinciResolveScript as dvr
    except Exception as e:
        print("✗ módulo de scripting não importou:", e)
        print("  → Option C descartada. Seguimos com a Option B (fila + script).")
        return

    print("✓ módulo de scripting importado")

    resolve = None
    try:
        resolve = dvr.scriptapp("Resolve")
    except Exception as e:
        print("✗ erro ao conectar:", e)

    if resolve is None:
        print("✗ NÃO conectou ao Resolve.")
        print("  Se o Resolve está ABERTO agora, isso significa que o scripting")
        print("  externo está bloqueado nesta versão (tipicamente: só no Studio).")
        print("  → Option C descartada. Option B (fila + script) atende todo mundo.")
        return

    print("✓ CONECTOU externamente — a Option C é viável")
    print("   versão :", resolve.GetVersionString())
    print("   produto:", resolve.GetProductName())

    pm = resolve.GetProjectManager()
    project = pm.GetCurrentProject() if pm else None
    if not project:
        print("\n⚠ nenhum projeto aberto — abra um e rode de novo pra ver a timeline")
        return

    print("\n── projeto ──")
    print("   nome :", project.GetName())
    fps = project.GetSetting("timelineFrameRate")
    print("   fps  :", fps)

    tl = project.GetCurrentTimeline()
    if not tl:
        print("   (sem timeline aberta)")
        return

    print("\n── timeline ──")
    print("   nome  :", tl.GetName())
    print("   trilhas de vídeo:", tl.GetTrackCount("video"),
          "| áudio:", tl.GetTrackCount("audio"))

    # Cortes = início de cada item da trilha de vídeo 1. Mesma premissa do
    # Premiere: numa sequência editada, a montagem já define os cortes.
    try:
        items = tl.GetItemListInTrack("video", 1) or []
        fpsf = float(fps) if fps else 24.0
        starts = sorted({round((it.GetStart() - tl.GetStartFrame()) / fpsf, 3) for it in items})
        cortes = [s for s in starts if s > 0.05]
        print("   clipes na V1 :", len(items))
        print("   cortes detectados:", len(cortes))
        if cortes:
            print("   primeiros:", ", ".join(str(c) + "s" for c in cortes[:6]))
            if len(cortes) > 1:
                gaps = [round(cortes[i + 1] - cortes[i], 2) for i in range(len(cortes) - 1)]
                print("   menor intervalo entre cortes:", min(gaps), "s")
                print("   → é este número que decide o tamanho máximo do SFX")
    except Exception as e:
        print("   não consegui ler os itens:", e)

    print("\n✓ probe concluído — nada foi alterado no seu projeto")


main()
