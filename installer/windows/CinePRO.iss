; =============================================================
;  CinePRO — Inno Setup script (Windows)
;  Instalador único que coloca:
;    %APPDATA%\Adobe\CEP\extensions\CinePRO   → plugin CEP Premiere
;    %LOCALAPPDATA%\Programs\CinePRO          → desktop app (Electron)
;
;  Pré-requisitos (rodam antes deste script):
;    cd desktop-app && npm install && npx electron-builder --win --dir
;    → gera desktop-app/dist/win-unpacked/  (a app)
;
;  Build:
;    & 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe' CinePRO.iss
; =============================================================

#define MyAppName      "CinePRO"
#define MyAppVersion   "1.0.0"
#define MyAppPublisher "CinePRO"
#define MyAppURL       "https://cinepro-rho.vercel.app"

[Setup]
AppId={{8F2A3B91-CF7D-4C2A-9B12-CINEPRO00001}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}

; Instala em %LOCALAPPDATA%\Programs\CinePRO (não precisa de admin)
DefaultDirName={localappdata}\Programs\CinePRO
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest

WizardStyle=modern
SetupIconFile=..\..\icons\logo.ico
UninstallDisplayIcon={app}\CinePRO.exe
UninstallDisplayName={#MyAppName} {#MyAppVersion}

; Saída — nome estável (sem versão) pra links da LP
OutputDir=..\dist
OutputBaseFilename=CinePRO-Setup
Compression=lzma2/ultra
SolidCompression=yes

LanguageDetectionMethod=none

[Languages]
Name: "ptbr"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "en";   MessagesFile: "compiler:Default.isl"

[Files]
; ─── DESKTOP APP (Electron) → %LOCALAPPDATA%\Programs\CinePRO\ ───
; electron-builder output vem pra ../dist/win-unpacked/ (config no package.json)
Source: "..\dist\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; ─── PLUGIN CEP → %APPDATA%\Adobe\CEP\extensions\CinePRO\ ───
Source: "..\..\index.html"; DestDir: "{userappdata}\Adobe\CEP\extensions\CinePRO"; Flags: ignoreversion
Source: "..\..\CSXS\*";     DestDir: "{userappdata}\Adobe\CEP\extensions\CinePRO\CSXS";  Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\css\*";      DestDir: "{userappdata}\Adobe\CEP\extensions\CinePRO\css";   Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\js\*";       DestDir: "{userappdata}\Adobe\CEP\extensions\CinePRO\js";    Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\jsx\*";      DestDir: "{userappdata}\Adobe\CEP\extensions\CinePRO\jsx";   Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\icons\*";    DestDir: "{userappdata}\Adobe\CEP\extensions\CinePRO\icons"; Flags: ignoreversion recursesubdirs createallsubdirs
; Manifest pré-gerado (boot offline-safe)
Source: "..\..\manifest\dist\manifest.json"; DestDir: "{userappdata}\Adobe\CEP\extensions\CinePRO"; Flags: ignoreversion skipifsourcedoesntexist

[Icons]
; Atalho no menu Iniciar + Desktop pra desktop app
Name: "{userprograms}\CinePRO"; Filename: "{app}\CinePRO.exe"
Name: "{userdesktop}\CinePRO";  Filename: "{app}\CinePRO.exe"; Tasks: desktopicon

[Tasks]
Name: desktopicon; Description: "Criar atalho no Desktop"; GroupDescription: "Atalhos:"

[Registry]
; Habilita PlayerDebugMode (CEP 9–13) pro plugin rodar sem assinatura Adobe
Root: HKCU; Subkey: "SOFTWARE\Adobe\CSXS.9";  ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "SOFTWARE\Adobe\CSXS.10"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "SOFTWARE\Adobe\CSXS.11"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "SOFTWARE\Adobe\CSXS.12"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "SOFTWARE\Adobe\CSXS.13"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue

[Run]
; Oferece abrir a desktop app no final da instalação
Filename: "{app}\CinePRO.exe"; Description: "Abrir CinePRO agora"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Também remove o plugin CEP no desinstall
Type: filesandordirs; Name: "{userappdata}\Adobe\CEP\extensions\CinePRO"

[Code]
function InitializeSetup(): Boolean;
var ResultCode: Integer;
begin
  Result := True;
  Exec('powershell.exe',
       '-Command "if (Get-Process ''Adobe Premiere Pro'' -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"',
       '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if ResultCode = 1 then begin
    MsgBox('Por favor, feche o Adobe Premiere Pro antes de instalar o CinePRO.',
           mbCriticalError, MB_OK);
    Result := False;
  end;
end;

[Messages]
ptbr.WelcomeLabel1=Bem-vindo ao instalador do CinePRO
ptbr.WelcomeLabel2=Esse assistente vai instalar o CinePRO no seu Windows.%n%n• Desktop app: gerencia sua assinatura%n• Plugin do Premiere Pro%n%nFeche o Premiere se estiver aberto antes de continuar.
ptbr.FinishedHeadingLabel=CinePRO instalado!
ptbr.FinishedLabel=Pronto! Agora abra o Premiere e vá em Janela → Extensões → CinePRO.

en.WelcomeLabel1=Welcome to CinePRO setup
en.WelcomeLabel2=This wizard will install CinePRO into your Windows.%n%n• Desktop app: manage subscription%n• Premiere Pro plugin%n%nPlease close Premiere if it's open.
en.FinishedHeadingLabel=CinePRO installed!
en.FinishedLabel=Done! Open Premiere and go to Window → Extensions → CinePRO.
