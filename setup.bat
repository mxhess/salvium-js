@echo off
setlocal enabledelayedexpansion

REM ══════════════════════════════════════════════════════════════════════
REM  salvium-js build setup (Windows)
REM
REM  Detects dependencies, provides install instructions, builds all
REM  components when ready.
REM
REM  Usage:
REM    setup.bat              Build everything
REM    setup.bat --check      Check dependencies only
REM    setup.bat --js-only    JS library only (bun install)
REM    setup.bat --no-miner   Build WASM components, skip native miner
REM ══════════════════════════════════════════════════════════════════════

set CHECK_ONLY=0
set JS_ONLY=0
set NO_MINER=0
set MISSING_COUNT=0

for %%A in (%*) do (
    if "%%A"=="--check"    set CHECK_ONLY=1
    if "%%A"=="--js-only"  set JS_ONLY=1
    if "%%A"=="--no-miner" set NO_MINER=1
    if "%%A"=="--help"     goto :usage
    if "%%A"=="-h"         goto :usage
)

goto :start

:usage
echo Usage: setup.bat [--check] [--js-only] [--no-miner]
echo.
echo   --check      Check dependencies only, don't build
echo   --js-only    Only install JS dependencies (skip WASM and native builds)
echo   --no-miner   Build WASM components but skip native miner
exit /b 0

:start
echo.
echo  salvium-js build setup (Windows)
echo  ================================
echo.

REM ── Detect architecture ───────────────────────────────────────────────

set ARCH=%PROCESSOR_ARCHITECTURE%
echo  Platform: Windows %ARCH%
echo.

REM ── Check Bun (required) ──────────────────────────────────────────────

echo  Required: Runtime
echo  -----------------

where bun >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=*" %%V in ('bun --version 2^>nul') do set BUN_VER=%%V
    echo   [OK]   bun !BUN_VER!
) else (
    echo   [MISS] bun -- powershell -c "irm bun.sh/install.ps1 | iex"
    set /a MISSING_COUNT+=1
    echo.
    echo  Bun is required. Install it first:
    echo    powershell -c "irm bun.sh/install.ps1 | iex"
    echo.
    if %CHECK_ONLY%==1 exit /b 1
    echo  Cannot continue without bun.
    exit /b 1
)

REM ── Check Rust toolchain ──────────────────────────────────────────────

if %JS_ONLY%==1 goto :skip_rust

echo.
echo  Required: Rust toolchain
echo  ------------------------

where rustc >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=*" %%V in ('rustc --version 2^>nul') do set RUSTC_VER=%%V
    echo   [OK]   !RUSTC_VER!
) else (
    echo   [MISS] rustc -- winget install Rustlang.Rustup  (or https://rustup.rs)
    set /a MISSING_COUNT+=1
)

where cargo >nul 2>&1
if %errorlevel%==0 (
    echo   [OK]   cargo
) else (
    echo   [MISS] cargo -- (installed with rustup)
    set /a MISSING_COUNT+=1
)

REM Check wasm32 target
where rustup >nul 2>&1
if %errorlevel%==0 (
    rustup target list --installed 2>nul | findstr /c:"wasm32-unknown-unknown" >nul 2>&1
    if !errorlevel!==0 (
        echo   [OK]   wasm32-unknown-unknown target
    ) else (
        echo   [MISS] wasm32-unknown-unknown target -- rustup target add wasm32-unknown-unknown
        set /a MISSING_COUNT+=1
    )
)

where wasm-pack >nul 2>&1
if %errorlevel%==0 (
    echo   [OK]   wasm-pack
) else (
    echo   [MISS] wasm-pack -- cargo install wasm-pack
    set /a MISSING_COUNT+=1
)

:skip_rust

REM ── Check C/C++ toolchain ─────────────────────────────────────────────

if %JS_ONLY%==1 goto :skip_cxx
if %NO_MINER%==1 goto :skip_cxx

echo.
echo  Required: C/C++ toolchain (for native miner)
echo  ---------------------------------------------

set HAS_CXX=0

where cl >nul 2>&1
if %errorlevel%==0 (
    echo   [OK]   MSVC cl.exe
    set HAS_CXX=1
)

if %HAS_CXX%==0 (
    where g++ >nul 2>&1
    if !errorlevel!==0 (
        echo   [OK]   g++
        set HAS_CXX=1
    )
)

if %HAS_CXX%==0 (
    where clang++ >nul 2>&1
    if !errorlevel!==0 (
        echo   [OK]   clang++
        set HAS_CXX=1
    )
)

if %HAS_CXX%==0 (
    echo   [MISS] C++ compiler -- winget install Microsoft.VisualStudio.2022.BuildTools
    echo          (select "Desktop development with C++" workload)
    set /a MISSING_COUNT+=1
)

where cmake >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=*" %%V in ('cmake --version 2^>nul ^| findstr /n "." ^| findstr "^1:"') do set CMAKE_VER=%%V
    echo   [OK]   cmake
) else (
    echo   [MISS] cmake -- winget install Kitware.CMake
    set /a MISSING_COUNT+=1
)

:skip_cxx

REM ── Summary ───────────────────────────────────────────────────────────

echo.
if %MISSING_COUNT% gtr 0 (
    echo  Missing dependencies: %MISSING_COUNT%
    echo  Install the tools listed above, then re-run setup.bat
    echo.
    if %CHECK_ONLY%==1 exit /b 1
    echo  Some components may fail to build. Continuing with what's available...
    echo.
) else (
    echo  All dependencies satisfied.
    echo.
)

if %CHECK_ONLY%==1 exit /b 0

REM ── Build ─────────────────────────────────────────────────────────────

set BUILT=0
set BUILD_FAILED=0

REM 1. Install JS dependencies
echo.
echo  Installing JS dependencies...
echo  -----------------------------
call bun install
if %errorlevel%==0 (
    echo   [OK]   JS dependencies
    set /a BUILT+=1
) else (
    echo   [FAIL] JS dependencies
    set /a BUILD_FAILED+=1
)

if %JS_ONLY%==1 goto :results

REM 2. Build WASM crypto
where wasm-pack >nul 2>&1
if %errorlevel%==0 (
    where cargo >nul 2>&1
    if !errorlevel!==0 (
        echo.
        echo  Building WASM crypto...
        echo  -----------------------
        pushd crates\salvium-crypto
        set RUSTFLAGS=-Ctarget-feature=+simd128
        call wasm-pack build --target web --out-dir ../../src/crypto/wasm
        if !errorlevel!==0 (
            echo   [OK]   WASM crypto
            set /a BUILT+=1
        ) else (
            echo   [FAIL] WASM crypto
            set /a BUILD_FAILED+=1
        )
        popd
    )
) else (
    echo   [SKIP] WASM crypto (missing wasm-pack or cargo)
    set /a BUILD_FAILED+=1
)

REM 3. Build RandomX WASM
echo.
echo  Building RandomX WASM...
echo  ------------------------
call bun run build:wasm
if %errorlevel%==0 (
    echo   [OK]   RandomX WASM
    set /a BUILT+=1
) else (
    echo   [FAIL] RandomX WASM
    set /a BUILD_FAILED+=1
)

REM 4. Build native miner
if %NO_MINER%==1 goto :results

where cargo >nul 2>&1
if %errorlevel%==0 (
    where cmake >nul 2>&1
    if !errorlevel!==0 (
        echo.
        echo  Building native miner...
        echo  ------------------------
        pushd crates\salvium-miner
        call cargo build --release
        if !errorlevel!==0 (
            echo   [OK]   Native miner
            set /a BUILT+=1
        ) else (
            echo   [FAIL] Native miner
            set /a BUILD_FAILED+=1
        )
        popd
    ) else (
        echo   [SKIP] Native miner (missing cmake)
        set /a BUILD_FAILED+=1
    )
) else (
    echo   [SKIP] Native miner (missing cargo)
    set /a BUILD_FAILED+=1
)

:results

REM ── Results ───────────────────────────────────────────────────────────

echo.
echo  Build Results
echo  =============
echo.
echo  Built: %BUILT%  Failed/Skipped: %BUILD_FAILED%
echo.

if exist src\crypto\wasm\salvium_crypto_bg.wasm (
    echo   WASM crypto:  src\crypto\wasm\salvium_crypto_bg.wasm
)
if exist build\randomx.wasm (
    echo   RandomX WASM: build\randomx.wasm
)
if exist crates\salvium-miner\target\release\salvium-miner.exe (
    echo   Native miner: crates\salvium-miner\target\release\salvium-miner.exe
)

echo.
if %BUILD_FAILED%==0 (
    echo  All components built successfully.
    echo.
    echo  Quick start:
    echo    bun test\run.js                    -- Run tests
    if exist crates\salvium-miner\target\release\salvium-miner.exe (
        echo    crates\salvium-miner\target\release\salvium-miner.exe --benchmark  -- Benchmark miner
    )
) else (
    echo  Some components failed. Check output above.
)

echo.
exit /b %BUILD_FAILED%
