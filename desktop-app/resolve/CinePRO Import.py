# =============================================================
#  CinePRO Import — script para DaVinci Resolve
#
#  Importa os arquivos que voce enviou pelo app CinePRO
#  ("-> Resolve") para o Media Pool, num bin "CinePRO", e
#  adiciona na timeline atual (se houver uma aberta).
#
#  Como usar no Resolve:
#    Workspace > Scripts > CinePRO Import
#
#  A fila fica em:
#    macOS:   ~/Library/Application Support/CinePRO/resolve-queue
#    Windows: %APPDATA%/CinePRO/resolve-queue
#  Apos importar, os arquivos saem da fila (movidos pra /done).
#
#  Funciona no Resolve FREE (roda de dentro do app). Nao requer Studio.
# =============================================================

import os
import sys
import shutil

def queue_dir():
    if sys.platform == "win32":
        base = os.environ.get("APPDATA", os.path.expanduser("~"))
        return os.path.join(base, "CinePRO", "resolve-queue")
    return os.path.expanduser("~/Library/Application Support/CinePRO/resolve-queue")

def main():
    try:
        resolve = bmd.scriptapp("Resolve")  # global do ambiente de scripts do Resolve
    except NameError:
        print("[CinePRO] Rode este script DENTRO do Resolve (Workspace > Scripts).")
        return

    if resolve is None:
        print("[CinePRO] Nao consegui falar com o Resolve.")
        return

    q = queue_dir()
    if not os.path.isdir(q):
        print("[CinePRO] Fila vazia (%s). Use '-> Resolve' no app CinePRO primeiro." % q)
        return

    files = [os.path.join(q, f) for f in sorted(os.listdir(q))
             if os.path.isfile(os.path.join(q, f)) and not f.startswith(".")]
    if not files:
        print("[CinePRO] Fila vazia. Use '-> Resolve' no app CinePRO primeiro.")
        return

    pm = resolve.GetProjectManager()
    project = pm.GetCurrentProject()
    if project is None:
        print("[CinePRO] Abra um projeto no Resolve primeiro.")
        return

    media_pool = project.GetMediaPool()
    root = media_pool.GetRootFolder()

    # Bin "CinePRO" (cria se nao existir)
    target_bin = None
    for f in (root.GetSubFolderList() or []):
        if f.GetName() == "CinePRO":
            target_bin = f
            break
    if target_bin is None:
        target_bin = media_pool.AddSubFolder(root, "CinePRO")
    if target_bin is not None:
        media_pool.SetCurrentFolder(target_bin)

    items = media_pool.ImportMedia(files)
    n = len(items) if items else 0
    print("[CinePRO] Importados %d arquivo(s) para o bin CinePRO." % n)

    # Se ha timeline aberta, adiciona os clips no fim dela
    timeline = project.GetCurrentTimeline()
    if timeline is not None and items:
        try:
            media_pool.AppendToTimeline(items)
            print("[CinePRO] Adicionados na timeline '%s'." % timeline.GetName())
        except Exception as e:
            print("[CinePRO] Importado no Media Pool; arraste pra timeline. (%s)" % e)
    else:
        print("[CinePRO] Sem timeline aberta — arraste do Media Pool quando quiser.")

    # Move os importados pra /done (mantem a fila limpa)
    if n:
        done = os.path.join(q, "done")
        try:
            os.makedirs(done)
        except OSError:
            pass
        for p in files:
            try:
                shutil.move(p, os.path.join(done, os.path.basename(p)))
            except Exception:
                pass

main()
