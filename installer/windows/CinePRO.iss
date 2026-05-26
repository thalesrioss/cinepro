; =============================================================
;  CinePRO — Inno Setup script (Windows)
;
;  Como compilar:
;    1. Instale Inno Setup: https://jrsoftware.org/isdl.php
;    2. Abra esse arquivo no Inno Setup Compiler
;    3. Build → Compile (F9)
;    4. Gera o .exe em ../dist/
;
;  OU pela CLI (PowerShell):
;    & 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe' CinePRO.iss
; =============================================================

#define MyAppName        "CinePRO"
#define MyAppVersion     "1.0.0"
#define MyAppPublisher   "CinePRO"
#define MyAppURL         "https://cinepro.com"
#define MyAppCopyright   "© CinePRO"

[Setup]
AppId={{8F2A3B91-CF7D-4C2A-9B12-CINEPRO00001}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppCopyright={#MyAppCopyright}

; Instala em %APPDATA% (per-user, sem precisar de admin)
DefaultDirName={userappdata}\Adobe\CEP\extensions\CinePRO
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest

; Visual
WizardStyle=modern
SetupIconFile=..\..\icons\logo.ico
WizardImageFile=
WizardSmallImageFile=
DisableWelcomePage=no
DisableReadyPage=no
DisableFinishedPage=no

; Saída
OutputDir=..\dist
OutputBaseFilename=CinePRO-{#MyAppVersion}-Setup
Compression=lzma2/ultra
SolidCompression=yes
UninstallDisplayIcon={app}\icons\logo.ico
UninstallDisplayName={#MyAppName} {#MyAppVersion}

; Idioma
LanguageDetectionMethod=none

[Languages]
Name: "ptbr"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Files]
; Copia tudo do projeto pra dentro da pasta de instalação
; EXCETO as pastas de dev (installer, firebase, etc)
Source: "..\..\index.html";        DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\CSXS\*";            DestDir: "{app}\CSXS"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\css\*";             DestDir: "{app}\css";   Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\js\*";              DestDir: "{app}\js";    Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\jsx\*";             DestDir: "{app}\jsx";   Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\icons\*";           DestDir: "{app}\icons"; Flags: ignoreversion recursesubdirs createallsubdirs

[Registry]
; Habilita PlayerDebugMode pra CEP 9–13 (cobre Premiere 2019–2026)
Root: HKCU; Subkey: "SOFTWARE\Adobe\CSXS.9";  ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "SOFTWARE\Adobe\CSXS.10"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "SOFTWARE\Adobe\CSXS.11"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "SOFTWARE\Adobe\CSXS.12"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "SOFTWARE\Adobe\CSXS.13"; ValueType: string; ValueName: "PlayerDebugMode"; ValueData: "1"; Flags: uninsdeletevalue

[Code]
// Avisa se o Premiere estiver aberto antes de instalar
function InitializeSetup(): Boolean;
var
  ResultCode: Integer;
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
ptbr.WelcomeLabel2=Esse assistente vai instalar o CinePRO no seu Adobe Premiere Pro.%n%nAntes de continuar, feche o Premiere se estiver aberto.
ptbr.FinishedHeadingLabel=CinePRO instalado!
ptbr.FinishedLabel=O plugin CinePRO foi instalado com sucesso.%n%nAbra o Adobe Premiere Pro e vá em Janela → Extensões → CinePRO.

en.WelcomeLabel1=Welcome to CinePRO setup
en.WelcomeLabel2=This wizard will install CinePRO into your Adobe Premiere Pro.%n%nPlease close Premiere if it's open before continuing.
en.FinishedHeadingLabel=CinePRO installed!
en.FinishedLabel=The CinePRO plugin was installed successfully.%n%nOpen Adobe Premiere Pro and go to Window → Extensions → CinePRO.
