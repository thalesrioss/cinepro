# =============================================================
#  CinePRO Import — script para DaVinci Resolve
#
#  Traz os arquivos que voce enviou pelo app CinePRO ("-> Resolve")
#  e coloca NO PLAYHEAD da timeline atual.
#
#  Como usar:
#    Workspace > Scripts > CinePRO Import
#
#  A fila fica em:
#    macOS:   ~/Library/Application Support/CinePRO/resolve-queue
#    Windows: %APPDATA%/CinePRO/resolve-queue
#
#  Funciona no Resolve FREE — roda de dentro do app, nao usa a API
#  externa (que e limitada ao Studio).
# =============================================================

import os
import sys
import shutil


def queue_dir():
    if sys.platform == "win32":
        base = os.environ.get("APPDATA", os.path.expanduser("~"))
        return os.path.join(base, "CinePRO", "resolve-queue")
    return os.path.expanduser("~/Library/Application Support/CinePRO/resolve-queue")


def timecode_to_frames(tc, fps):
    """'HH:MM:SS:FF' -> numero do frame. Aceita ';' de drop-frame."""
    try:
        parts = str(tc).replace(";", ":").split(":")
        if len(parts) != 4:
            return None
        h, m, s, f = [int(p) for p in parts]
        return int(round(((h * 3600 + m * 60 + s) * fps) + f))
    except Exception:
        return None


def free_audio_track(timeline, record_frame, n_frames):
    """
    Primeira trilha de audio SEM clipe ocupando a janela desejada.

    Sem isto o Resolve escolhe a trilha corrente e pode cobrir a voz
    do editor — o mesmo cuidado que o plugin do Premiere ja tem.
    Devolve None se nenhuma estiver livre.
    """
    try:
        total = timeline.GetTrackCount("audio")
    except Exception:
        return None
    fim = record_frame + max(1, n_frames)
    for idx in range(1, total + 1):
        try:
            ocupada = False
            for item in (timeline.GetItemListInTrack("audio", idx) or []):
                if item.GetStart() < fim and item.GetEnd() > record_frame:
                    ocupada = True
                    break
            if not ocupada:
                return idx
        except Exception:
            continue
    return None


def limpar_fila(q, arquivos):
    """Move o processado pra /done — a fila nao pode reimportar na proxima."""
    done = os.path.join(q, "done")
    try:
        os.makedirs(done)
    except OSError:
        pass
    for p in arquivos:
        try:
            shutil.move(p, os.path.join(done, os.path.basename(p)))
        except Exception:
            pass


def main():
    try:
        resolve = bmd.scriptapp("Resolve")  # global do ambiente de scripts
    except NameError:
        print("[CinePRO] Rode este script DENTRO do Resolve (Workspace > Scripts).")
        return

    if resolve is None:
        print("[CinePRO] Nao consegui falar com o Resolve.")
        return

    q = queue_dir()
    arquivos = []
    if os.path.isdir(q):
        arquivos = [os.path.join(q, f) for f in sorted(os.listdir(q))
                    if os.path.isfile(os.path.join(q, f)) and not f.startswith(".")]
    if not arquivos:
        print("[CinePRO] Fila vazia.")
        print("          Abra o app CinePRO, procure o efeito e clique '-> Resolve'.")
        return

    pm = resolve.GetProjectManager()
    project = pm.GetCurrentProject() if pm else None
    if project is None:
        print("[CinePRO] Abra um projeto no Resolve primeiro.")
        print("          Os %d arquivo(s) continuam na fila." % len(arquivos))
        return

    media_pool = project.GetMediaPool()
    root = media_pool.GetRootFolder()

    # Bin "CinePRO" — mantem o projeto do editor organizado
    destino = None
    for f in (root.GetSubFolderList() or []):
        if f.GetName() == "CinePRO":
            destino = f
            break
    if destino is None:
        destino = media_pool.AddSubFolder(root, "CinePRO")
    if destino is not None:
        media_pool.SetCurrentFolder(destino)

    itens = media_pool.ImportMedia(arquivos)
    n = len(itens) if itens else 0
    if not n:
        print("[CinePRO] Nao consegui importar os arquivos da fila.")
        print("          Fila: %s" % q)
        return
    print("[CinePRO] %d arquivo(s) no bin CinePRO." % n)

    timeline = project.GetCurrentTimeline()
    if timeline is None:
        print("[CinePRO] Sem timeline aberta — ficaram no Media Pool.")
        print("          Abra uma timeline e rode de novo pra cair no playhead.")
        limpar_fila(q, arquivos)
        return

    # ── Colocacao NO PLAYHEAD ──────────────────────────────────
    # A versao anterior chamava AppendToTimeline(itens), que joga tudo
    # no FIM da timeline. Pra quem quer um whoosh num corte especifico
    # isso e inutil — o editor tinha que arrastar cada um de volta.
    try:
        fps = float(project.GetSetting("timelineFrameRate") or 24)
    except Exception:
        fps = 24.0

    playhead = timecode_to_frames(timeline.GetCurrentTimecode(), fps)
    if playhead is None:
        print("[CinePRO] Nao consegui ler o playhead — usando o fim da timeline.")
        try:
            media_pool.AppendToTimeline(itens)
            print("[CinePRO] %d no fim de '%s'." % (n, timeline.GetName()))
        except Exception as e:
            print("[CinePRO] Ficaram no Media Pool; arraste pra timeline. (%s)" % e)
        limpar_fila(q, arquivos)
        return

    colocados, falhas = 0, 0
    for item in itens:
        try:
            dur = int(item.GetClipProperty("Frames") or 0) or int(fps)
        except Exception:
            dur = int(fps)

        trilha = free_audio_track(timeline, playhead, dur)
        if trilha is None:
            # Sem trilha livre: cria uma no fim em vez de cobrir audio
            try:
                timeline.AddTrack("audio")
                trilha = timeline.GetTrackCount("audio")
            except Exception:
                trilha = None

        info = {
            "mediaPoolItem": item,
            "startFrame": 0,
            "endFrame": max(1, dur - 1),
            "recordFrame": playhead,
            "mediaType": 2,          # 2 = somente audio
        }
        if trilha:
            info["trackIndex"] = trilha

        try:
            if media_pool.AppendToTimeline([info]):
                colocados += 1
            else:
                falhas += 1
        except Exception:
            falhas += 1

    if colocados:
        print("[CinePRO] %d colocado(s) no playhead de '%s'." % (colocados, timeline.GetName()))
    if falhas:
        print("[CinePRO] %d nao entrou(aram) na timeline — estao no bin CinePRO." % falhas)

    limpar_fila(q, arquivos)


main()
