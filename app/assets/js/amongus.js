const { ipcRenderer } = require('electron')

const $ = id => document.getElementById(id)
let lastState = null

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

function showUpdatePrompt(prompt) {
    return new Promise(resolve => {
        const modal = $('updatePrompt')
        const confirm = $('updatePromptConfirm')
        const decline = $('updatePromptDecline')

        $('updatePromptTitle').textContent = prompt.title
        $('updatePromptMessage').textContent = prompt.message
        $('updatePromptDetail').textContent = prompt.detail || ''
        confirm.textContent = prompt.confirmLabel || 'Tak'
        decline.textContent = prompt.declineLabel || 'Nie'
        modal.hidden = false

        function finish(confirmed) {
            confirm.removeEventListener('click', onConfirm)
            decline.removeEventListener('click', onDecline)
            modal.hidden = true
            resolve(confirmed)
        }

        function onConfirm() {
            finish(true)
        }

        function onDecline() {
            finish(false)
        }

        confirm.addEventListener('click', onConfirm)
        decline.addEventListener('click', onDecline)
    })
}

function updateModBadge(id, hasUpdate, latestVersion) {
    const badge = $(id)
    badge.hidden = !hasUpdate
    if(hasUpdate) {
        badge.textContent = `Update -> ${latestVersion}`
        badge.title = `Kliknij, aby zaktualizowac do ${latestVersion}`
    }
}

function updateReleaseLink(modId, hasUpdate, url) {
    document.querySelectorAll(`[data-mod-release="${modId}"]`).forEach(button => {
        const disabled = hasUpdate || !url
        button.disabled = disabled
        button.classList.toggle('disabledLink', disabled)
        button.title = hasUpdate
            ? 'Link wylaczony, bo jest dostepna aktualizacja.'
            : (url ? 'Otworz release na GitHubie.' : 'Brak linku do release.')
    })
}

function applyState(state) {
    lastState = state
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
    $('aUnlockerVersionLabel').textContent = state.versions.aUnlocker || 'Brak'
    $('readyMiraVersionLabel').textContent = state.versions.mira || 'Brak'
    $('readyExtensionVersionLabel').textContent = state.versions.extension || 'Brak'
    $('readyAleLuduVersionLabel').textContent = state.versions.aleLudu || 'Brak'
    $('readyAUnlockerVersionLabel').textContent = state.versions.aUnlocker || 'Brak'
    updateModBadge('miraUpdateBadge', state.status.availableUpdates.mira, state.latestVersions.mira)
    updateModBadge('extensionUpdateBadge', state.status.availableUpdates.extension, state.latestVersions.extension)
    updateModBadge('aleLuduUpdateBadge', state.status.availableUpdates.aleLudu, state.latestVersions.aleLudu)
    updateModBadge('aUnlockerUpdateBadge', state.status.availableUpdates.aUnlocker, state.latestVersions.aUnlocker)
    updateModBadge('readyMiraUpdateBadge', state.status.availableUpdates.mira, state.latestVersions.mira)
    updateModBadge('readyExtensionUpdateBadge', state.status.availableUpdates.extension, state.latestVersions.extension)
    updateModBadge('readyAleLuduUpdateBadge', state.status.availableUpdates.aleLudu, state.latestVersions.aleLudu)
    updateModBadge('readyAUnlockerUpdateBadge', state.status.availableUpdates.aUnlocker, state.latestVersions.aUnlocker)
    updateReleaseLink('mira', state.status.availableUpdates.mira, state.releaseUrls.mira)
    updateReleaseLink('extension', state.status.availableUpdates.extension, state.releaseUrls.extension)
    updateReleaseLink('aleLudu', state.status.availableUpdates.aleLudu, state.releaseUrls.aleLudu)
    updateReleaseLink('aUnlocker', state.status.availableUpdates.aUnlocker, state.releaseUrls.aUnlocker)
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

async function reinstallEverything() {
    log('Robie czysta instalacje gry i modow...')
    toast('Robie czysta instalacje...')
    const result = await ipcRenderer.invoke('amongus:reinstall-everything')
    result.messages.forEach(log)
    toast(result.summary)
    await refreshState()
}

async function updateSingleMod(modId) {
    const labels = {
        mira: 'TOU Mira',
        extension: 'MegaChujoweExt',
        aleLudu: 'AleLuduMod',
        aUnlocker: 'AUnlocker'
    }
    log(`Aktualizuje ${labels[modId] || modId}...`)
    toast(`Aktualizuje ${labels[modId] || modId}...`)
    const result = await ipcRenderer.invoke('amongus:update-mod', modId)
    result.messages.forEach(log)
    toast(result.summary)
    await refreshState()
}

async function openModRelease(modId) {
    const result = await ipcRenderer.invoke('amongus:open-mod-release', modId)
    toast(result.message)
    log(result.message)
}

async function launchGame() {
    const result = await ipcRenderer.invoke('amongus:launch-game')
    log(result.message)
    toast(result.message)
}

async function openPluginsFolder() {
    const result = await ipcRenderer.invoke('amongus:open-plugins-folder')
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

function openDebugMenu() {
    $('debugMenu').hidden = false
}

function closeDebugMenu() {
    $('debugMenu').hidden = true
}

async function showDebugUpdatePrompt(kind) {
    await showUpdatePrompt(kind === 'confirmSkip'
        ? {
            title: 'Czy aby na pewno?',
            message: 'Pominac aktualizacje do wersji 1.0.1?',
            detail: 'Bez aktualizacji launcher zostanie na aktualnej wersji.',
            confirmLabel: 'Jednak aktualizuj',
            declineLabel: 'Tak, pomin'
        }
        : {
            title: 'Aktualizacja dostepna',
            message: 'Zaktualizowac launcher do wersji 1.0.1?',
            detail: 'Aktualizacja poprawia launcher i moze byc wymagana do dalszego dzialania modow.',
            confirmLabel: 'Tak, aktualizuj',
            declineLabel: 'Nie'
        })
}

function runDebugScreen(screen) {
    closeDebugMenu()
    $('loadingScreen').hidden = true
    $('shell').hidden = false

    if(screen === 'ready') {
        $('readyLaunchBand').hidden = false
        $('setupWorkspace').hidden = true
        $('consolePanel').hidden = true
        $('toggleConsole').textContent = 'Pokaz konsole'
        return
    }

    if(screen === 'setup') {
        $('readyLaunchBand').hidden = true
        $('setupWorkspace').hidden = false
        $('consolePanel').hidden = true
        $('toggleConsole').textContent = 'Pokaz konsole'
        return
    }

    if(screen === 'console') {
        $('readyLaunchBand').hidden = true
        $('setupWorkspace').hidden = false
        $('consolePanel').hidden = false
        $('toggleConsole').textContent = 'Ukryj konsole'
        return
    }

    if(screen === 'loading') {
        $('shell').hidden = true
        $('loadingScreen').hidden = false
        setLoading(58, 'Debug: test loading screena...')
        return
    }

    if(screen === 'update' || screen === 'confirmSkip') {
        showDebugUpdatePrompt(screen).then(() => {
            if(lastState) {
                applyState(lastState)
            }
        })
    }
}

function bind() {
    $('frameMinimize').addEventListener('click', () => ipcRenderer.send('window:minimize'))
    $('frameClose').addEventListener('click', () => ipcRenderer.send('window:close'))
    $('repairLauncher').addEventListener('click', diagnoseRepair)
    $('autoFindGame').addEventListener('click', autoFindGame)
    $('installEverything').addEventListener('click', installEverything)
    $('reinstallEverything').addEventListener('click', reinstallEverything)
    $('launchGame').addEventListener('click', launchGame)
    $('readyLaunchGame').addEventListener('click', launchGame)
    $('openPlugins').addEventListener('click', openPluginsFolder)
    $('readyOpenPlugins').addEventListener('click', openPluginsFolder)
    $('selectSourceDir').addEventListener('click', selectSourceDir)
    $('toggleDebug').addEventListener('click', openDebugMenu)
    $('closeDebugMenu').addEventListener('click', closeDebugMenu)
    document.querySelectorAll('[data-debug-screen]').forEach(button => {
        button.addEventListener('click', () => runDebugScreen(button.dataset.debugScreen))
    })
    document.querySelectorAll('[data-update-mod]').forEach(button => {
        button.addEventListener('click', () => updateSingleMod(button.dataset.updateMod))
    })
    document.querySelectorAll('[data-mod-release]').forEach(button => {
        button.addEventListener('click', () => openModRelease(button.dataset.modRelease))
    })
    $('toggleConsole').addEventListener('click', toggleConsole)
    ipcRenderer.on('amongus:bootstrap-progress', (_event, update) => {
        setLoading(update.progress, update.message)
        log(update.message)
    })
    ipcRenderer.on('program-update-prompt', async (_event, prompt) => {
        const confirmed = await showUpdatePrompt(prompt)
        ipcRenderer.send('program-update-prompt-response', prompt.id, confirmed)
    })
    bootstrap().catch(err => {
        setLoading(100, `Blad startu: ${err.message}`)
        log(`Blad startu: ${err.message}`)
        toast(`Blad startu: ${err.message}`)
        setTimeout(hideLoading, 1400)
    })
}

window.addEventListener('DOMContentLoaded', bind)
