const { ipcRenderer } = require('electron')

const $ = id => document.getElementById(id)

function toast(message) {
    $('toast').textContent = message
    $('toast').hidden = false
    clearTimeout(toast.timeout)
    toast.timeout = setTimeout(() => {
        $('toast').hidden = true
    }, 3600)
}

function log(message) {
    const stamp = new Date().toLocaleTimeString('pl-PL')
    $('logOutput').textContent += `[${stamp}] ${message}\n`
    $('logOutput').scrollTop = $('logOutput').scrollHeight
}

function setLoading(progress, message) {
    $('loadingTitle').textContent = message
    $('loadingProgressBar').style.width = `${Math.max(0, Math.min(100, progress))}%`
    $('loadingProgressValue').textContent = `${Math.max(0, Math.min(100, progress))}%`
}

function hideLoading() {
    $('loadingScreen').hidden = true
    $('shell').hidden = false
}

function applyState(state) {
    const readyToPlay = state.status.gameReady && state.status.modsReady
    $('lastAction').textContent = state.status.lastAction || 'Brak'
    $('gameStateLabel').textContent = state.status.gameReady ? 'Gotowe' : 'Nie gotowe'
    $('foundGameLabel').textContent = state.config.sourceGameDir ? 'Znaleziono' : 'Nie znaleziono'
    $('modsStateLabel').textContent = state.status.updatesAvailable
        ? 'Aktualizacja dostepna'
        : (state.status.modsReady ? 'Gotowe' : 'Do przygotowania')
    $('miraVersionLabel').textContent = state.versions.mira || 'Brak'
    $('extensionVersionLabel').textContent = state.versions.extension || 'Brak'
    $('aleLuduVersionLabel').textContent = state.versions.aleLudu || 'Brak'
    $('readyMiraVersionLabel').textContent = state.versions.mira || 'Brak'
    $('readyExtensionVersionLabel').textContent = state.versions.extension || 'Brak'
    $('readyAleLuduVersionLabel').textContent = state.versions.aleLudu || 'Brak'
    $('autoFindGame').hidden = state.status.sourceDetectedAutomatically
    $('selectSourceDir').hidden = state.status.sourceDetectedAutomatically
    $('readyLaunchBand').hidden = !readyToPlay
    $('setupWorkspace').hidden = readyToPlay
    $('installEverything').textContent = state.status.updatesAvailable ? 'Aktualizuj mody' : 'Przygotuj wszystko'
}

async function refreshState() {
    applyState(await ipcRenderer.invoke('amongus:get-state'))
}

async function bootstrap() {
    setLoading(2, 'Sprawdzam stan launchera...')
    const result = await ipcRenderer.invoke('amongus:bootstrap')
    applyState(result.state)
    if(result.summary) {
        log(result.summary)
    }
    hideLoading()
}

async function autoFindGame() {
    log('Szukam gry automatycznie...')
    const result = await ipcRenderer.invoke('amongus:auto-find-game')
    log(result.message)
    toast(result.message)
    await refreshState()
}

async function installEverything() {
    log('Przygotowuje gre i mody...')
    const result = await ipcRenderer.invoke('amongus:install-everything')
    result.messages.forEach(log)
    toast(result.summary)
    await refreshState()
}

async function launchGame() {
    const result = await ipcRenderer.invoke('amongus:launch-game')
    log(result.message)
    toast(result.message)
}

async function selectSourceDir() {
    const selected = await ipcRenderer.invoke('amongus:select-source-dir')
    if(!selected) {
        return
    }
    await ipcRenderer.invoke('amongus:save-config', {
        sourceGameDir: selected,
        sourceDetection: 'manual'
    })
    log(`Uzyto folderu wskazanego recznie: ${selected}`)
    toast('Folder gry zapisany.')
    await refreshState()
}

async function diagnoseRepair() {
    log('Sprawdzam stan launchera...')
    const result = await ipcRenderer.invoke('amongus:diagnose-repair')
    log(result.message)
    toast(result.message)
    await refreshState()
}

function toggleConsole() {
    const panel = $('consolePanel')
    panel.hidden = !panel.hidden
    $('toggleConsole').textContent = panel.hidden ? 'Pokaz konsole' : 'Ukryj konsole'
}

function bind() {
    $('frameMinimize').addEventListener('click', () => ipcRenderer.send('window:minimize'))
    $('frameClose').addEventListener('click', () => ipcRenderer.send('window:close'))
    $('repairLauncher').addEventListener('click', diagnoseRepair)
    $('autoFindGame').addEventListener('click', autoFindGame)
    $('installEverything').addEventListener('click', installEverything)
    $('launchGame').addEventListener('click', launchGame)
    $('readyLaunchGame').addEventListener('click', launchGame)
    $('selectSourceDir').addEventListener('click', selectSourceDir)
    $('toggleConsole').addEventListener('click', toggleConsole)
    ipcRenderer.on('amongus:bootstrap-progress', (_event, update) => {
        setLoading(update.progress, update.message)
        log(update.message)
    })
    bootstrap().catch(err => {
        setLoading(100, `Blad startu: ${err.message}`)
        log(`Blad startu: ${err.message}`)
        toast(`Blad startu: ${err.message}`)
        setTimeout(hideLoading, 1400)
    })
}

window.addEventListener('DOMContentLoaded', bind)
