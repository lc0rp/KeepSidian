@echo off
REM Setup script to create symlinks to the 6 core Obsidian projects
REM Run this from anywhere: scripts\setup-ref-links.bat

REM Change to project root (parent of scripts folder)
cd /d "%~dp0\.."

REM Check Node.js version (requires v16+)
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js v16+ from https://nodejs.org/
    exit /b 1
)

echo Setting up symlinks to core Obsidian projects...

REM Central .ref location (one level up from project)
set "CENTRAL_REF_ROOT=..\.ref"
set "CENTRAL_REF=..\.ref\obsidian-dev"

REM Create central .ref root if it doesn't exist
if not exist "%CENTRAL_REF_ROOT%" mkdir "%CENTRAL_REF_ROOT%"

REM Create obsidian-dev subfolder if it doesn't exist
if not exist "%CENTRAL_REF%" mkdir "%CENTRAL_REF%"

REM Ensure plugins and themes folders exist
if not exist "%CENTRAL_REF%\plugins" mkdir "%CENTRAL_REF%\plugins"
if not exist "%CENTRAL_REF%\themes" mkdir "%CENTRAL_REF%\themes"

REM Check if git is available
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: git is not installed or not in PATH
    echo Please install git from https://git-scm.com/
    exit /b 1
)

REM Clone the 6 core repos if they don't exist, or pull latest if they do
if not exist "%CENTRAL_REF%\obsidian-api" (
    echo Cloning obsidian-api...
    cd "%CENTRAL_REF%"
    git clone https://github.com/obsidianmd/obsidian-api.git obsidian-api
    if %errorlevel% neq 0 (
        echo ERROR: Failed to clone obsidian-api
        echo Check your internet connection and try again
        cd "%~dp0\.."
        exit /b 1
    )
    cd "%~dp0\.."
) else (
    echo Updating obsidian-api...
    cd "%CENTRAL_REF%\obsidian-api"
    git pull
    if %errorlevel% neq 0 (
        echo WARNING: Failed to update obsidian-api (continuing anyway)
    )
    cd "%~dp0\.."
)

if not exist "%CENTRAL_REF%\obsidian-sample-plugin" (
    echo Cloning obsidian-sample-plugin...
    cd "%CENTRAL_REF%"
    git clone https://github.com/obsidianmd/obsidian-sample-plugin.git obsidian-sample-plugin
    if %errorlevel% neq 0 (
        echo ERROR: Failed to clone obsidian-sample-plugin
        echo Check your internet connection and try again
        cd "%~dp0\.."
        exit /b 1
    )
    cd "%~dp0\.."
) else (
    echo Updating obsidian-sample-plugin...
    cd "%CENTRAL_REF%\obsidian-sample-plugin"
    git pull
    if %errorlevel% neq 0 (
        echo WARNING: Failed to update obsidian-sample-plugin (continuing anyway)
    )
    cd "%~dp0\.."
)

if not exist "%CENTRAL_REF%\obsidian-developer-docs" (
    echo Cloning obsidian-developer-docs...
    cd "%CENTRAL_REF%"
    git clone https://github.com/obsidianmd/obsidian-developer-docs.git obsidian-developer-docs
    if %errorlevel% neq 0 (
        echo ERROR: Failed to clone obsidian-developer-docs
        echo Check your internet connection and try again
        cd "%~dp0\.."
        exit /b 1
    )
    cd "%~dp0\.."
) else (
    echo Updating obsidian-developer-docs...
    cd "%CENTRAL_REF%\obsidian-developer-docs"
    git pull
    if %errorlevel% neq 0 (
        echo WARNING: Failed to update obsidian-developer-docs (continuing anyway)
    )
    cd "%~dp0\.."
)

if not exist "%CENTRAL_REF%\obsidian-plugin-docs" (
    echo Cloning obsidian-plugin-docs...
    cd "%CENTRAL_REF%"
    git clone https://github.com/obsidianmd/obsidian-plugin-docs.git obsidian-plugin-docs
    if %errorlevel% neq 0 (
        echo ERROR: Failed to clone obsidian-plugin-docs
        echo Check your internet connection and try again
        cd "%~dp0\.."
        exit /b 1
    )
    cd "%~dp0\.."
) else (
    echo Updating obsidian-plugin-docs...
    cd "%CENTRAL_REF%\obsidian-plugin-docs"
    git pull
    if %errorlevel% neq 0 (
        echo WARNING: Failed to update obsidian-plugin-docs (continuing anyway)
    )
    cd "%~dp0\.."
)

if not exist "%CENTRAL_REF%\obsidian-sample-theme" (
    echo Cloning obsidian-sample-theme...
    cd "%CENTRAL_REF%"
    git clone https://github.com/obsidianmd/obsidian-sample-theme.git obsidian-sample-theme
    if %errorlevel% neq 0 (
        echo ERROR: Failed to clone obsidian-sample-theme
        echo Check your internet connection and try again
        cd "%~dp0\.."
        exit /b 1
    )
    cd "%~dp0\.."
) else (
    echo Updating obsidian-sample-theme...
    cd "%CENTRAL_REF%\obsidian-sample-theme"
    git pull
    if %errorlevel% neq 0 (
        echo WARNING: Failed to update obsidian-sample-theme (continuing anyway)
    )
    cd "%~dp0\.."
)

if not exist "%CENTRAL_REF%\eslint-plugin" (
    echo Cloning eslint-plugin...
    cd "%CENTRAL_REF%"
    git clone https://github.com/obsidianmd/eslint-plugin.git eslint-plugin
    if %errorlevel% neq 0 (
        echo ERROR: Failed to clone eslint-plugin
        echo Check your internet connection and try again
        cd "%~dp0\.."
        exit /b 1
    )
    cd "%~dp0\.."
) else (
    echo Updating eslint-plugin...
    cd "%CENTRAL_REF%\eslint-plugin"
    git pull
    if %errorlevel% neq 0 (
        echo WARNING: Failed to update eslint-plugin (continuing anyway)
    )
    cd "%~dp0\.."
)

REM Ensure project .ref directory exists
if not exist ".ref" mkdir .ref

REM Create symlinks for each core project
echo Creating symlink: obsidian-api
if exist ".ref\obsidian-api" rmdir ".ref\obsidian-api"
mklink /J ".ref\obsidian-api" "%CENTRAL_REF%\obsidian-api"

echo Creating symlink: obsidian-sample-plugin
if exist ".ref\obsidian-sample-plugin" rmdir ".ref\obsidian-sample-plugin"
mklink /J ".ref\obsidian-sample-plugin" "%CENTRAL_REF%\obsidian-sample-plugin"

echo Creating symlink: obsidian-developer-docs
if exist ".ref\obsidian-developer-docs" rmdir ".ref\obsidian-developer-docs"
mklink /J ".ref\obsidian-developer-docs" "%CENTRAL_REF%\obsidian-developer-docs"

echo Creating symlink: obsidian-plugin-docs
if exist ".ref\obsidian-plugin-docs" rmdir ".ref\obsidian-plugin-docs"
mklink /J ".ref\obsidian-plugin-docs" "%CENTRAL_REF%\obsidian-plugin-docs"

echo Creating symlink: obsidian-sample-theme
if exist ".ref\obsidian-sample-theme" rmdir ".ref\obsidian-sample-theme"
mklink /J ".ref\obsidian-sample-theme" "%CENTRAL_REF%\obsidian-sample-theme"

echo Creating symlink: eslint-plugin
if exist ".ref\eslint-plugin" rmdir ".ref\eslint-plugin"
mklink /J ".ref\eslint-plugin" "%CENTRAL_REF%\eslint-plugin"

echo.
echo Setup complete!
echo.
echo Verifying symlinks...
dir .ref

