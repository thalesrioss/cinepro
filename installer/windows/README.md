# 🪟 CinePRO — Build do instalador Windows

O instalador Windows usa **Inno Setup** (gratuito, padrão da indústria).

## Como buildar (no Windows)

### 1. Instalar o Inno Setup
Baixe e instale: **https://jrsoftware.org/isdl.php**
(Versão 6 ou superior)

### 2. Copiar o projeto pra um PC Windows
Você precisa do projeto completo (pasta `CinePRO/`) na máquina Windows.

### 3. Compilar
**Opção A — pela GUI:**
1. Abra o Inno Setup Compiler
2. Arquivo → Abrir → `installer/windows/CinePRO.iss`
3. Build → Compile (F9)

**Opção B — pela linha de comando (PowerShell):**
```powershell
cd C:\caminho\para\CinePRO\installer\windows
& 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe' CinePRO.iss
```

### 4. O resultado
Gera o arquivo:
```
installer/dist/CinePRO-1.0.0-Setup.exe
```

Esse `.exe` o usuário Windows baixa e dá duplo-clique. O instalador:
- ✅ Verifica se o Premiere tá fechado
- ✅ Instala em `%APPDATA%\Adobe\CEP\extensions\CinePRO`
- ✅ Habilita PlayerDebugMode no registro (CEP 9–13)
- ✅ Cria entrada de "desinstalar" no Painel de Controle

## Não tem PC Windows?

Opções pra buildar do Mac:
1. **Máquina virtual** (Parallels, VMware) com Windows
2. **GitHub Actions** — workflow gratuito que builda automaticamente:

```yaml
# .github/workflows/build-windows.yml
name: Build Windows Installer
on: workflow_dispatch
jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install Inno Setup
        run: choco install innosetup -y
      - name: Compile
        run: |
          & 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe' installer\windows\CinePRO.iss
      - uses: actions/upload-artifact@v4
        with:
          name: CinePRO-Windows-Setup
          path: installer/dist/*.exe
```

Faz commit desse workflow, vai em Actions → "Build Windows Installer" → Run. Em 2 min você baixa o `.exe`.
