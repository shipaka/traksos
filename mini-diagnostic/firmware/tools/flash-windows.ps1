$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
try {
    $m = Get-Content -Raw manifest.json | ConvertFrom-Json
    if ($m.target -ne 'esp32' -or $m.flashBytes -ne 4194304 -or $m.offset -ne 0 -or $m.purpose -ne 'USB-only BLE bench' -or $m.image -ne 'traksos-bench-esp32-4mb.bin') {
        throw 'Unexpected image manifest.'
    }
    $image = Join-Path $PSScriptRoot $m.image
    if ((Get-FileHash -Algorithm SHA256 $image).Hash -ne $m.sha256) { throw 'Image checksum mismatch.' }
    Write-Host 'BENCH ONLY: ESP32-WROOM-32, 4 MB. Disconnect all trailer, CAN and power boards.'
    Write-Host 'Flashing replaces existing program and data in the image range. Use a dedicated test board.'
    if ((Read-Host 'Type YES to confirm a USB-only dedicated test ESP32') -cne 'YES') { throw 'Cancelled.' }
    if (-not (Get-Command py -ErrorAction SilentlyContinue)) { throw 'Install Python 3 for Windows from python.org first.' }
    & py -3 -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Python environment failed.' }
    $python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
    & $python -m pip install esptool==4.8.1
    if ($LASTEXITCODE -ne 0) { throw 'esptool installation failed.' }
    & $python -m serial.tools.list_ports
    $port = Read-Host 'Enter the COM port of the dedicated ESP32'
    if ($port -notmatch '^COM[1-9][0-9]*$') { throw 'Invalid COM port.' }
    & $python -m esptool --chip esp32 --port $port --baud 115200 flash_id
    if ($LASTEXITCODE -ne 0) { throw 'ESP32 detection failed.' }
    if ((Read-Host 'Confirm detected board is classic ESP32 with 4 MB flash: type YES') -cne 'YES') { throw 'Cancelled.' }
    & $python -m esptool --chip esp32 --port $port --baud 115200 --before default_reset --after hard_reset write_flash 0x0 $image
    if ($LASTEXITCODE -ne 0) { throw 'Write failed.' }
    Write-Host 'Write completed. Open Mini Diagnostic and check the USB-only BLE handshake.'
    exit 0
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
