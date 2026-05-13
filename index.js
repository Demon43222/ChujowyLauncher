const remoteMain = require('@electron/remote/main')
remoteMain.initialize()

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const { autoUpdater } = require('electron-updater')
const AdmZip = require('adm-zip')
const ejse = require('ejs-electron')
const fs = require('fs')
const fse = require('fs-extra')
const https = require('https')
const path = require('path')
const { spawn } = require('child_process')
const { pathToFileURL } = require('url')

const REPOS = {
    mira: 'AU-Avengers/TOU-Mira',
    extension: 'HekerB/TownOfUsMegaChujoweExtension',
    aleLudu: 'townofus-pl/AleLuduMod',
    aUnlocker: 'astra1dev/AUnlocker'
}
const LEGENDARY_REPO = 'derrod/legendary'
const EPIC_APP_ID = '963137e4c29d4c79a81323b8fab03a40'

const COMMON_STEAM_PATHS = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Steam'),
    path.join(process.env.LOCALAPPDATA || '', 'Steam'),
    'D:\\SteamLibrary',
    'D:\\Steam',
    'D:\\',
    'D:\\Gry\\Steam'
].filter(Boolean)

let win
let updateDownloadDialogVisible = false
let updatePromptCounter = 0
const updatePromptResolvers = new Map()

function emitBootstrapProgress(step, progress, message) {
    win?.webContents?.send('amongus:bootstrap-progress', {
        step,
        progress,
        message
    })
}

function getPlatformIcon() {
    return path.join(__dirname, '..', 'app', 'assets', 'images', 'SealCircle.ico')
}

async function showUpdateDialog(options) {
    if(!win || win.isDestroyed()) {
        return { response: 1 }
    }
    return dialog.showMessageBox(win, options)
}

function askUpdatePrompt(options) {
    if(!win || win.isDestroyed()) {
        return Promise.resolve(false)
    }

    const id = ++updatePromptCounter
    return new Promise(resolve => {
        updatePromptResolvers.set(id, resolve)
        win.webContents.send('program-update-prompt', {
            id,
            ...options
        })
    })
}

async function shouldDownloadProgramUpdate(info) {
    const wantsUpdate = await askUpdatePrompt({
        title: 'Aktualizacja dostepna',
        message: `Zaktualizowac launcher do wersji ${info.version}?`,
        detail: 'Aktualizacja poprawia launcher i moze byc wymagana do dalszego dzialania modow.',
        confirmLabel: 'Tak, aktualizuj',
        declineLabel: 'Nie'
    })

    if(wantsUpdate) {
        return true
    }

    const changedMind = await askUpdatePrompt({
        title: 'Czy aby na pewno?',
        message: `Pominac aktualizacje do wersji ${info.version}?`,
        detail: 'Bez aktualizacji launcher zostanie na aktualnej wersji.',
        confirmLabel: 'Jednak aktualizuj',
        declineLabel: 'Tak, pomin'
    })

    return changedMind
}

function initProgramUpdater() {
    if(!app.isPackaged) {
        return
    }

    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false

    autoUpdater.on('update-available', async info => {
        if(await shouldDownloadProgramUpdate(info)) {
            try {
                await autoUpdater.downloadUpdate()
            } catch(err) {
                await showUpdateDialog({
                    type: 'error',
                    title: 'Nie udalo sie pobrac aktualizacji',
                    message: 'Updater nie mogl pobrac nowej wersji.',
                    detail: err.message || String(err),
                    buttons: ['OK'],
                    noLink: true
                })
            }
        }
    })

    autoUpdater.on('download-progress', async progress => {
        if(updateDownloadDialogVisible) {
            return
        }
        updateDownloadDialogVisible = true
        await showUpdateDialog({
            type: 'info',
            title: 'Pobieranie aktualizacji',
            message: 'Aktualizacja jest pobierana w tle.',
            detail: `Start pobierania: ${Math.max(0, Math.round(progress.percent || 0))}%`,
            buttons: ['OK'],
            noLink: true
        })
    })

    autoUpdater.on('update-downloaded', async info => {
        updateDownloadDialogVisible = false
        const result = await showUpdateDialog({
            type: 'info',
            title: 'Aktualizacja gotowa',
            message: `Wersja ${info.version} zostala pobrana.`,
            detail: 'Zainstalowac ja teraz?',
            buttons: ['Zainstaluj', 'Pozniej'],
            defaultId: 0,
            cancelId: 1,
            noLink: true
        })

        if(result.response === 0) {
            autoUpdater.quitAndInstall()
        }
    })

    autoUpdater.on('error', async err => {
        updateDownloadDialogVisible = false
        await showUpdateDialog({
            type: 'warning',
            title: 'Updater napotkal problem',
            message: 'Nie udalo sie sprawdzic lub pobrac aktualizacji.',
            detail: err.message || String(err),
            buttons: ['OK'],
            noLink: true
        })
    })

    setTimeout(() => {
        autoUpdater.checkForUpdates().catch(() => {})
    }, 1500)
}

function userDataRoot() {
    return path.join(app.getPath('userData'), 'amongus')
}

function configPath() {
    return path.join(userDataRoot(), 'config.json')
}

function managedGameDir() {
    return path.join(userDataRoot(), 'managed-instance')
}

function metadataPath() {
    return path.join(userDataRoot(), 'mods.json')
}

function legendaryDir() {
    return path.join(userDataRoot(), 'legendary')
}

function legendaryExePath() {
    return path.join(legendaryDir(), 'legendary.exe')
}

async function ensureDir(dir) {
    await fs.promises.mkdir(dir, { recursive: true })
}

async function readJson(filePath, fallback) {
    try {
        return JSON.parse(await fs.promises.readFile(filePath, 'utf8'))
    } catch(_err) {
        return fallback
    }
}

async function writeJson(filePath, value) {
    await ensureDir(path.dirname(filePath))
    await fs.promises.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function readConfig() {
    const config = await readJson(configPath(), {})
    return {
        platform: config.platform || 'steam',
        sourceGameDir: config.sourceGameDir || '',
        sourceDetection: config.sourceDetection || '',
        managedGameDir: config.managedGameDir || managedGameDir(),
        epicInstalledGameDir: config.epicInstalledGameDir || ''
    }
}

async function writeConfig(update) {
    const current = await readConfig()
    const merged = {
        ...current,
        ...update,
        managedGameDir: update.managedGameDir || current.managedGameDir || managedGameDir()
    }
    await writeJson(configPath(), merged)
    return merged
}

async function readMetadata() {
    return readJson(metadataPath(), {
        mira: null,
        extension: null,
        aleLudu: null,
        latestVersions: {
            mira: null,
            extension: null,
            aleLudu: null,
            aUnlocker: null
        },
        availableUpdates: {
            mira: false,
            extension: false,
            aleLudu: false,
            aUnlocker: false
        },
        lastAction: ''
    })
}

async function writeMetadata(update) {
    const current = await readMetadata()
    const merged = {
        ...current,
        ...update
    }
    await writeJson(metadataPath(), merged)
    return merged
}

function gameExePath(gameDir) {
    return path.join(gameDir, 'Among Us.exe')
}

function pluginsDir(gameDir) {
    return path.join(gameDir, 'BepInEx', 'plugins')
}

function resolveGameDir(candidate) {
    if(!candidate) {
        return ''
    }
    const direct = normalizePath(candidate)
    if(fs.existsSync(gameExePath(direct))) {
        return direct
    }
    const nested = path.join(direct, 'AmongUs')
    if(fs.existsSync(gameExePath(nested))) {
        return nested
    }
    return ''
}

function normalizePath(candidate) {
    try {
        return path.resolve(candidate).replace(/[\\/]+$/, '')
    } catch(_err) {
        return String(candidate || '').replace(/\//g, '\\').replace(/[\\/]+$/, '')
    }
}

async function parseSteamLibraryFolders(filePath) {
    try {
        const content = await fs.promises.readFile(filePath, 'utf8')
        return [...content.matchAll(/"path"\s*"([^"]+)"/gi)]
            .map(match => match[1])
            .filter(Boolean)
            .map(rawPath => rawPath.replace(/\\\\/g, '\\'))
    } catch(_err) {
        return []
    }
}

async function getSteamLibraryPaths() {
    const libraries = new Set()

    for(const basePath of COMMON_STEAM_PATHS) {
        const normalizedBase = normalizePath(basePath)
        if(fs.existsSync(normalizedBase)) {
            libraries.add(normalizedBase)
        }

        const vdfPath = path.join(normalizedBase, 'steamapps', 'libraryfolders.vdf')
        const parsedLibraries = await parseSteamLibraryFolders(vdfPath)
        for(const libraryPath of parsedLibraries) {
            const normalizedLibrary = normalizePath(libraryPath)
            if(fs.existsSync(normalizedLibrary)) {
                libraries.add(normalizedLibrary)
            }
        }
    }

    return [...libraries]
}

async function detectSteamAmongUsDir() {
    const libraries = await getSteamLibraryPaths()
    for(const libraryPath of libraries) {
        const candidate = path.join(libraryPath, 'steamapps', 'common', 'Among Us')
        if(fs.existsSync(gameExePath(candidate))) {
            return candidate
        }
    }
    return ''
}

function requestRaw(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const client = https.get(url, {
            headers: {
                'User-Agent': 'MCDC-AmongUs-Launcher',
                ...headers
            }
        }, response => {
            if(response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                response.resume()
                const nextUrl = new URL(response.headers.location, url).toString()
                resolve(requestRaw(nextUrl, headers))
                return
            }

            const chunks = []
            response.on('data', chunk => chunks.push(chunk))
            response.on('end', () => {
                resolve({
                    statusCode: response.statusCode,
                    url,
                    headers: response.headers,
                    buffer: Buffer.concat(chunks)
                })
            })
        })
        client.on('error', reject)
    })
}

async function request(url, responseType = 'json') {
    const headers = responseType === 'json'
        ? { Accept: 'application/vnd.github+json' }
        : {}
    const response = await requestRaw(url, headers)

    if(response.statusCode < 200 || response.statusCode >= 300) {
        const detail = response.buffer.toString('utf8').slice(0, 300)
        const error = new Error(`HTTP ${response.statusCode} dla ${url}`)
        error.statusCode = response.statusCode
        error.detail = detail
        throw error
    }

    if(responseType === 'buffer') {
        return response.buffer
    }

    return JSON.parse(response.buffer.toString('utf8'))
}

function decodeHtml(value) {
    return String(value || '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, '\'')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
}

async function latestReleaseFromHtml(repo) {
    const response = await requestRaw(`https://github.com/${repo}/releases/latest`, {
        Accept: 'text/html'
    })

    if(response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`HTTP ${response.statusCode} dla https://github.com/${repo}/releases/latest`)
    }

    const html = response.buffer.toString('utf8')
    const tagFromUrl = /\/releases\/tag\/([^/?#]+)/i.exec(response.url)?.[1]
    const tagFromPage = /\/releases\/tag\/([^"?#]+)/i.exec(html)?.[1]
    const tag = decodeURIComponent(tagFromUrl || tagFromPage || '')
    const assetHtml = tag
        ? (await requestRaw(`https://github.com/${repo}/releases/expanded_assets/${encodeURIComponent(tag)}`, {
            Accept: 'text/html'
        })).buffer.toString('utf8')
        : ''
    const combinedHtml = `${html}\n${assetHtml}`
    const escapedRepo = repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const assetPattern = new RegExp(`href=["'](/${escapedRepo}/releases/download/([^/"']+)/([^"']+))["']`, 'g')
    const assetsByUrl = new Map()
    let match

    while((match = assetPattern.exec(combinedHtml)) !== null) {
        const downloadPath = decodeHtml(match[1])
        const assetTag = decodeURIComponent(decodeHtml(match[2]))
        const fileName = decodeURIComponent(decodeHtml(match[3]))
        assetsByUrl.set(downloadPath, {
            name: fileName,
            browser_download_url: `https://github.com${downloadPath}`,
            tag: assetTag
        })
    }

    const assets = [...assetsByUrl.values()]
    if(assets.length === 0) {
        throw new Error(`Nie znalazlem assetow release dla ${repo}${tag ? ` (${tag})` : ''}.`)
    }

    return {
        tag_name: assets[0].tag,
        name: assets[0].tag,
        assets
    }
}

async function latestRelease(repo) {
    try {
        return await request(`https://api.github.com/repos/${repo}/releases/latest`)
    } catch(error) {
        if(error.statusCode === 403 || error.statusCode === 429) {
            return latestReleaseFromHtml(repo)
        }
        throw error
    }
}

function pickLegendaryAsset(release) {
    const assets = release.assets || []
    return assets.find(asset => /legendary.*windows.*x86_64.*\.exe$/i.test(asset.name))
        || assets.find(asset => /windows.*\.exe$/i.test(asset.name))
        || assets.find(asset => /\.exe$/i.test(asset.name))
        || null
}

function pickMiraAsset(release, platform) {
    const assets = release.assets || []
    const zipAssets = assets.filter(asset => /\.zip$/i.test(asset.name))
    const normalizedPlatform = String(platform || '').toLowerCase()
    const platformMatches = normalizedPlatform === 'epic'
        ? [/epic/i, /msstore/i]
        : [/steam/i, /itch/i]

    return zipAssets.find(asset => platformMatches.some(pattern => pattern.test(asset.name)))
        || zipAssets.find(asset => /full|windows/i.test(asset.name))
        || assets.find(asset => /\.zip$/i.test(asset.name))
        || null
}

function pickExtensionAsset(release) {
    const assets = release.assets || []
    return assets.find(asset => /\.dll$/i.test(asset.name))
        || assets.find(asset => /\.zip$/i.test(asset.name))
        || null
}

function pickAleLuduAsset(release) {
    const assets = release.assets || []
    return assets.find(asset => /^AleLuduMod.*\.dll$/i.test(asset.name))
        || assets.find(asset => /\.dll$/i.test(asset.name))
        || assets.find(asset => /\.zip$/i.test(asset.name))
        || null
}

function pickAUnlockerAsset(release, platform) {
    const assets = release.assets || []
    const zipAssets = assets.filter(asset => /\.zip$/i.test(asset.name))
    const normalizedPlatform = String(platform || '').toLowerCase()
    const platformMatches = normalizedPlatform === 'epic'
        ? [/epic/i, /microsoft/i, /xbox/i]
        : [/steam/i, /itch/i]

    return zipAssets.find(asset => /AUnlocker/i.test(asset.name)
            && platformMatches.some(pattern => pattern.test(asset.name)))
        || zipAssets.find(asset => /AUnlocker/i.test(asset.name))
        || assets.find(asset => /^AUnlocker.*\.dll$/i.test(asset.name))
        || assets.find(asset => /\.dll$/i.test(asset.name))
        || null
}

function releaseVersion(release, fallback = '') {
    return release?.tag_name || release?.name || fallback || ''
}

function modReleaseUrl(modId, version) {
    if(!version || !REPOS[modId]) {
        return ''
    }
    return `https://github.com/${REPOS[modId]}/releases/tag/${encodeURIComponent(version)}`
}

async function refreshLatestModStatus() {
    const metadata = await readMetadata()
    try {
        const [miraRelease, extensionRelease, aleLuduRelease, aUnlockerRelease] = await Promise.all([
            latestRelease(REPOS.mira),
            latestRelease(REPOS.extension),
            latestRelease(REPOS.aleLudu),
            latestRelease(REPOS.aUnlocker)
        ])

        const latestVersions = {
            mira: releaseVersion(miraRelease),
            extension: releaseVersion(extensionRelease),
            aleLudu: releaseVersion(aleLuduRelease),
            aUnlocker: releaseVersion(aUnlockerRelease)
        }

        const availableUpdates = {
            mira: Boolean(metadata.mira && latestVersions.mira && metadata.mira !== latestVersions.mira),
            extension: Boolean(metadata.extension && latestVersions.extension && metadata.extension !== latestVersions.extension),
            aleLudu: Boolean(metadata.aleLudu && latestVersions.aleLudu && metadata.aleLudu !== latestVersions.aleLudu),
            aUnlocker: Boolean(metadata.aUnlocker && latestVersions.aUnlocker && metadata.aUnlocker !== latestVersions.aUnlocker)
        }

        await writeMetadata({
            latestVersions,
            availableUpdates
        })
        return {
            latestVersions,
            availableUpdates
        }
    } catch(error) {
        return {
            latestVersions: metadata.latestVersions || {},
            availableUpdates: metadata.availableUpdates || {},
            error: error.message
        }
    }
}

async function bootstrapLauncher() {
    emitBootstrapProgress('start', 5, 'Sprawdzam stan launchera...')
    await refreshLatestModStatus()

    emitBootstrapProgress('detect', 20, 'Szukam plikow gry...')
    let state = await stateSnapshot()
    if(!state.status.sourceGameReady) {
        const detection = await autoFindGame()
        if(!detection.found) {
            emitBootstrapProgress('manual', 100, detection.message)
            return {
                ready: false,
                summary: detection.message,
                state: await stateSnapshot()
            }
        }
        state = await stateSnapshot()
    }

    emitBootstrapProgress('versions', 40, 'Sprawdzam aktualizacje modow...')
    await refreshLatestModStatus()
    state = await stateSnapshot()

    if(!state.status.gameReady || !state.status.modsReady) {
        emitBootstrapProgress('install', 58, state.status.updatesAvailable
            ? 'Aktualizuje mody...'
            : 'Przygotowuje gre i mody...')
        const installResult = await installOrUpdateEverything()
        if(!installResult.ready) {
            emitBootstrapProgress('blocked', 100, installResult.summary)
            return {
                ready: false,
                summary: installResult.summary,
                state: await stateSnapshot()
            }
        }
    }

    emitBootstrapProgress('finish', 100, 'Gotowe do gry.')
    return {
        ready: true,
        summary: 'Gotowe do gry.',
        state: await stateSnapshot()
    }
}

async function downloadAsset(asset, targetPath) {
    const buffer = await request(asset.browser_download_url, 'buffer')
    await ensureDir(path.dirname(targetPath))
    await fs.promises.writeFile(targetPath, buffer)
    return targetPath
}

async function ensureLegendary() {
    if(fs.existsSync(legendaryExePath())) {
        return {
            downloaded: false,
            path: legendaryExePath()
        }
    }

    const release = await latestRelease(LEGENDARY_REPO)
    const asset = pickLegendaryAsset(release)
    if(!asset) {
        throw new Error('Nie znalazlem pliku EXE Legendary w najnowszym release.')
    }
    await downloadAsset(asset, legendaryExePath())
    return {
        downloaded: true,
        path: legendaryExePath(),
        version: release.tag_name || release.name || asset.name
    }
}

function runProcess(fileName, args, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
        const child = spawn(fileName, args, {
            cwd: path.dirname(fileName),
            windowsHide: true
        })
        let stdout = ''
        let stderr = ''
        const timeout = setTimeout(() => {
            child.kill()
            reject(new Error(`Przekroczono czas oczekiwania na: ${args.join(' ')}`))
        }, timeoutMs)

        child.stdout?.on('data', chunk => {
            stdout += chunk.toString('utf8')
        })
        child.stderr?.on('data', chunk => {
            stderr += chunk.toString('utf8')
        })
        child.on('error', error => {
            clearTimeout(timeout)
            reject(error)
        })
        child.on('close', code => {
            clearTimeout(timeout)
            resolve({ code, stdout, stderr })
        })
    })
}

async function runLegendary(args, timeoutMs) {
    await ensureLegendary()
    return runProcess(legendaryExePath(), args, timeoutMs)
}

async function launchLegendaryAuth() {
    await ensureLegendary()
    const child = spawn(legendaryExePath(), ['auth'], {
        cwd: path.dirname(legendaryExePath()),
        detached: true,
        stdio: 'ignore',
        windowsHide: false
    })
    child.unref()
}

async function runLegendaryJson(args, timeoutMs) {
    const result = await runLegendary(args, timeoutMs)
    if(result.code !== 0) {
        throw new Error(result.stderr || result.stdout || `Legendary zakonczyl sie kodem ${result.code}.`)
    }
    if(!result.stdout.trim()) {
        return []
    }
    return JSON.parse(result.stdout)
}

async function inspectEpicAccount() {
    try {
        const games = await runLegendaryJson(['list-games', '--json'], 60000)
        const amongUs = games.find(game =>
            String(game.app_name || '').toLowerCase() === EPIC_APP_ID.toLowerCase()
            || /among us/i.test(String(game.app_title || ''))
        )
        return {
            ready: true,
            authenticated: true,
            owned: Boolean(amongUs),
            details: amongUs || null,
            message: amongUs
                ? 'Among Us znaleziony na koncie Epic.'
                : 'Legendary dziala, ale Among Us nie zostal znaleziony na koncie Epic.'
        }
    } catch(error) {
        return {
            ready: fs.existsSync(legendaryExePath()),
            authenticated: false,
            owned: false,
            details: null,
            message: `Nie udalo sie sprawdzic konta Epic: ${error.message}`
        }
    }
}

async function detectEpicInstalledGameDir() {
    try {
        const installed = await runLegendaryJson(['list-installed', '--json'], 60000)
        const amongUs = installed.find(game =>
            String(game.app_name || '').toLowerCase() === EPIC_APP_ID.toLowerCase()
            || /among us/i.test(String(game.app_title || ''))
        )
        const detected = resolveGameDir(amongUs?.install_path || '')
        return {
            found: Boolean(detected),
            sourceGameDir: detected,
            rawInstallPath: amongUs?.install_path || ''
        }
    } catch(error) {
        return {
            found: false,
            sourceGameDir: '',
            rawInstallPath: '',
            error: error.message
        }
    }
}

async function removeMatchingFiles(dir, pattern) {
    if(!fs.existsSync(dir)) {
        return
    }
    const entries = await fs.promises.readdir(dir)
    await Promise.all(entries
        .filter(entry => pattern.test(entry))
        .map(entry => fs.promises.rm(path.join(dir, entry), { force: true })))
}

async function removeMatchingDirs(dir, pattern) {
    if(!fs.existsSync(dir)) {
        return
    }
    const entries = await fs.promises.readdir(dir, { withFileTypes: true })
    await Promise.all(entries
        .filter(entry => entry.isDirectory() && pattern.test(entry.name))
        .map(entry => fs.promises.rm(path.join(dir, entry.name), { recursive: true, force: true })))
}

function resolveExtractedMiraRoot(extractDir) {
    const entries = fs.readdirSync(extractDir, { withFileTypes: true })
    const directories = entries.filter(entry => entry.isDirectory())
    const files = entries.filter(entry => entry.isFile())

    if(files.length === 0 && directories.length === 1) {
        return path.join(extractDir, directories[0].name)
    }

    return extractDir
}

function hasInstalledMira(gameDir) {
    return fs.existsSync(path.join(gameDir, 'winhttp.dll'))
        && fs.existsSync(path.join(gameDir, 'doorstop_config.ini'))
        && fs.existsSync(path.join(pluginsDir(gameDir), 'MiraAPI.dll'))
        && fs.existsSync(path.join(pluginsDir(gameDir), 'TownOfUsMira.dll'))
}

function hasInstalledExtension(gameDir) {
    return fs.existsSync(pluginsDir(gameDir))
        && fs.readdirSync(pluginsDir(gameDir)).some(fileName =>
            /^TouMegaChujoweExtension.*\.dll$/i.test(fileName)
        )
}

function hasInstalledAleLudu(gameDir) {
    return fs.existsSync(pluginsDir(gameDir))
        && fs.readdirSync(pluginsDir(gameDir)).some(fileName =>
            /^AleLuduMod.*\.dll$/i.test(fileName)
        )
}

function hasInstalledAUnlocker(gameDir) {
    return fs.existsSync(pluginsDir(gameDir))
        && fs.readdirSync(pluginsDir(gameDir)).some(fileName =>
            /^AUnlocker.*\.dll$/i.test(fileName)
        )
}

async function installMira(release, asset, gameDir) {
    const tempZip = path.join(userDataRoot(), 'downloads', asset.name)
    const extractDir = path.join(userDataRoot(), 'downloads', 'mira-extract')
    await downloadAsset(asset, tempZip)
    await fs.promises.rm(extractDir, { recursive: true, force: true })
    await ensureDir(extractDir)
    const zip = new AdmZip(tempZip)
    zip.extractAllTo(extractDir, true)
    const extractedRoot = resolveExtractedMiraRoot(extractDir)
    await removeMatchingDirs(gameDir, /^TouMira-/i)
    await fse.copy(extractedRoot, gameDir, {
        overwrite: true,
        dereference: true
    })
    await fs.promises.rm(tempZip, { force: true })
    await fs.promises.rm(extractDir, { recursive: true, force: true })

    if(!hasInstalledMira(gameDir)) {
        throw new Error('Paczka TOU Mira zostala pobrana, ale pliki loadera nie trafily do katalogu gry.')
    }

    return release.tag_name || release.name || asset.name
}

async function installExtension(release, asset, gameDir) {
    const pluginDir = pluginsDir(gameDir)
    await ensureDir(pluginDir)
    await removeMatchingFiles(pluginDir, /^TownOfUsMegaChujoweExtension.*\.(dll|zip)$/i)

    if(/\.dll$/i.test(asset.name)) {
        const targetDll = path.join(pluginDir, asset.name)
        await downloadAsset(asset, targetDll)
    } else {
        const tempZip = path.join(userDataRoot(), 'downloads', asset.name)
        await downloadAsset(asset, tempZip)
        const zip = new AdmZip(tempZip)
        const dllEntry = zip.getEntries().find(entry => /TownOfUsMegaChujoweExtension.*\.dll$/i.test(entry.entryName))
        if(!dllEntry) {
            throw new Error('Paczka addonu nie zawiera DLL.')
        }
        zip.extractEntryTo(dllEntry.entryName, pluginDir, false, true)
        await fs.promises.rm(tempZip, { force: true })
    }

    if(!hasInstalledExtension(gameDir)) {
        throw new Error('Addon Extension zostal pobrany, ale jego DLL nie trafil do BepInEx/plugins.')
    }

    return release.tag_name || release.name || asset.name
}

async function installAleLudu(release, asset, gameDir) {
    const pluginDir = pluginsDir(gameDir)
    await ensureDir(pluginDir)
    await removeMatchingFiles(pluginDir, /^AleLuduMod.*\.(dll|zip)$/i)

    if(/\.dll$/i.test(asset.name)) {
        const targetDll = path.join(pluginDir, asset.name)
        await downloadAsset(asset, targetDll)
    } else {
        const tempZip = path.join(userDataRoot(), 'downloads', asset.name)
        await downloadAsset(asset, tempZip)
        const zip = new AdmZip(tempZip)
        const dllEntry = zip.getEntries().find(entry => /AleLuduMod.*\.dll$/i.test(entry.entryName))
        if(!dllEntry) {
            throw new Error('Paczka AleLuduMod nie zawiera DLL.')
        }
        zip.extractEntryTo(dllEntry.entryName, pluginDir, false, true)
        await fs.promises.rm(tempZip, { force: true })
    }

    if(!hasInstalledAleLudu(gameDir)) {
        throw new Error('AleLuduMod zostal pobrany, ale jego DLL nie trafil do BepInEx/plugins.')
    }

    return release.tag_name || release.name || asset.name
}

async function installAUnlocker(release, asset, gameDir) {
    const pluginDir = pluginsDir(gameDir)
    await ensureDir(pluginDir)
    await removeMatchingFiles(pluginDir, /^AUnlocker.*\.(dll|zip)$/i)

    if(/\.dll$/i.test(asset.name)) {
        const targetDll = path.join(pluginDir, asset.name)
        await downloadAsset(asset, targetDll)
    } else {
        const tempZip = path.join(userDataRoot(), 'downloads', asset.name)
        await downloadAsset(asset, tempZip)
        const zip = new AdmZip(tempZip)
        const dllEntry = zip.getEntries().find(entry => /AUnlocker.*\.dll$/i.test(entry.entryName))
        if(!dllEntry) {
            throw new Error('Paczka AUnlocker nie zawiera DLL.')
        }
        zip.extractEntryTo(dllEntry.entryName, pluginDir, false, true)
        await fs.promises.rm(tempZip, { force: true })
    }

    if(!hasInstalledAUnlocker(gameDir)) {
        throw new Error('AUnlocker zostal pobrany, ale jego DLL nie trafil do BepInEx/plugins.')
    }

    return release.tag_name || release.name || asset.name
}

async function stateSnapshot() {
    const config = await readConfig()
    const metadata = await readMetadata()
    const sourceGameReady = Boolean(resolveGameDir(config.sourceGameDir))
    const availableUpdates = metadata.availableUpdates || {}
    const updatesAvailable = Boolean(
        availableUpdates.mira
        || availableUpdates.extension
        || availableUpdates.aleLudu
        || availableUpdates.aUnlocker
    )
    const gameReady = Boolean(config.managedGameDir && fs.existsSync(gameExePath(config.managedGameDir)))
    const modsReady = Boolean(
        metadata.mira
        && metadata.extension
        && metadata.aleLudu
        && metadata.aUnlocker
        && hasInstalledMira(config.managedGameDir)
        && hasInstalledExtension(config.managedGameDir)
        && hasInstalledAleLudu(config.managedGameDir)
        && hasInstalledAUnlocker(config.managedGameDir)
        && !updatesAvailable
    )
    return {
        config,
        versions: {
            mira: metadata.mira,
            extension: metadata.extension,
            aleLudu: metadata.aleLudu,
            aUnlocker: metadata.aUnlocker
        },
        releaseUrls: {
            mira: modReleaseUrl('mira', metadata.mira),
            extension: modReleaseUrl('extension', metadata.extension),
            aleLudu: modReleaseUrl('aleLudu', metadata.aleLudu),
            aUnlocker: modReleaseUrl('aUnlocker', metadata.aUnlocker)
        },
        latestVersions: metadata.latestVersions || {},
        status: {
            gameReady,
            modsReady,
            sourceGameReady,
            sourceDetectedAutomatically: config.sourceDetection === 'auto' && sourceGameReady,
            updatesAvailable,
            availableUpdates,
            lastAction: metadata.lastAction,
            legendaryReady: fs.existsSync(legendaryExePath())
        }
    }
}

async function autoFindGame() {
    const steamDir = await detectSteamAmongUsDir()
    if(steamDir) {
        await writeConfig({
            platform: 'steam',
            sourceGameDir: steamDir,
            sourceDetection: 'auto',
            epicInstalledGameDir: ''
        })
        await writeMetadata({
            lastAction: 'Automatycznie wykryto Among Us ze Steam'
        })
        return {
            found: true,
            needsEpicLogin: false,
            sourceGameDir: steamDir,
            platform: 'steam',
            message: 'Znaleziono Among Us ze Steam.'
        }
    }

    await ensureLegendary()
    const epicDir = await detectEpicInstalledGameDir()
    if(epicDir.found) {
        await writeConfig({
            platform: 'epic',
            sourceGameDir: epicDir.sourceGameDir,
            sourceDetection: 'auto',
            epicInstalledGameDir: epicDir.sourceGameDir
        })
        await writeMetadata({
            lastAction: 'Automatycznie wykryto Among Us z Epic'
        })
        return {
            found: true,
            needsEpicLogin: false,
            sourceGameDir: epicDir.sourceGameDir,
            platform: 'epic',
            message: 'Znaleziono Among Us z Epic.'
        }
    }

    const epicAccount = await inspectEpicAccount()
    if(!epicAccount.authenticated) {
        await launchLegendaryAuth()
        await writeMetadata({
            lastAction: 'Potrzebne logowanie do Epic'
        })
        return {
            found: false,
            needsEpicLogin: true,
            sourceGameDir: '',
            platform: '',
            message: 'Nie znalazlem Steam. Otworzylem logowanie Epic. Po zalogowaniu kliknij jeszcze raz.'
        }
    }

    return {
        found: false,
        needsEpicLogin: false,
        sourceGameDir: '',
        platform: '',
        message: epicAccount.owned
            ? 'Konto Epic ma Among Us, ale gra nie wyglada na zainstalowana.'
            : 'Nie znalazlem Among Us na Steam ani Epic.'
    }
}

async function diagnoseRepair() {
    const state = await stateSnapshot()

    if(!state.status.sourceGameReady) {
        const steamDir = await detectSteamAmongUsDir()
        if(steamDir) {
            await writeConfig({
                platform: 'steam',
                sourceGameDir: steamDir,
                sourceDetection: 'auto',
                epicInstalledGameDir: ''
            })
            await writeMetadata({
                lastAction: 'Naprawa: automatycznie wykryto folder gry'
            })
            return {
                level: 'info',
                message: 'Znalazlem folder gry automatycznie. Teraz kliknij Przygotuj wszystko.'
            }
        }

        return {
            level: 'warning',
            message: 'Nie widze folderu gry. Kliknij Wskaz pliki recznie i wybierz katalog z Among Us.exe.'
        }
    }

    if(!state.status.gameReady) {
        return {
            level: 'warning',
            message: 'Gra zostala znaleziona, ale instancja launchera nie jest przygotowana. Kliknij Przygotuj wszystko.'
        }
    }

    if(state.status.updatesAvailable) {
        return {
            level: 'warning',
            message: 'Sa dostepne nowsze wersje modow. Kliknij Aktualizuj mody.'
        }
    }

    if(!state.status.modsReady) {
        return {
            level: 'warning',
            message: 'Instancja gry istnieje, ale mody wymagaja naprawy. Kliknij Przygotuj wszystko.'
        }
    }

    return {
        level: 'success',
        message: 'Wszystko wyglada dobrze. Mozesz kliknac Graj.'
    }
}

async function installOrUpdateEverything() {
    const config = await readConfig()
    let sourceGameDir = resolveGameDir(config.sourceGameDir)

    if(!sourceGameDir) {
        const detection = await autoFindGame()
        if(!detection.found) {
            return {
                ready: false,
                messages: [detection.message],
                summary: detection.message
            }
        }
        sourceGameDir = resolveGameDir(detection.sourceGameDir)
    }

    await ensureDir(path.dirname(config.managedGameDir))
    await fse.copy(sourceGameDir, config.managedGameDir, {
        overwrite: true,
        dereference: true
    })

    const messages = ['Przygotowano instancje gry.']
    const miraRelease = await latestRelease(REPOS.mira)
    const miraAsset = pickMiraAsset(miraRelease, config.platform)
    if(!miraAsset) {
        throw new Error('Nie znalazlem paczki ZIP w latest release TOU Mira.')
    }
    const miraVersion = await installMira(miraRelease, miraAsset, config.managedGameDir)
    messages.push(`Zainstalowano TOU Mira ${miraVersion}.`)

    const extensionRelease = await latestRelease(REPOS.extension)
    const extensionAsset = pickExtensionAsset(extensionRelease)
    if(!extensionAsset) {
        throw new Error('Nie znalazlem assetu DLL ani ZIP w latest release addonu.')
    }
    const extensionVersion = await installExtension(extensionRelease, extensionAsset, config.managedGameDir)
    messages.push(`Zainstalowano extension ${extensionVersion}.`)

    const aleLuduRelease = await latestRelease(REPOS.aleLudu)
    const aleLuduAsset = pickAleLuduAsset(aleLuduRelease)
    if(!aleLuduAsset) {
        throw new Error('Nie znalazlem assetu DLL ani ZIP w latest release AleLuduMod.')
    }
    const aleLuduVersion = await installAleLudu(aleLuduRelease, aleLuduAsset, config.managedGameDir)
    messages.push(`Zainstalowano AleLuduMod ${aleLuduVersion}.`)

    const aUnlockerRelease = await latestRelease(REPOS.aUnlocker)
    const aUnlockerAsset = pickAUnlockerAsset(aUnlockerRelease, config.platform)
    if(!aUnlockerAsset) {
        throw new Error('Nie znalazlem assetu DLL ani ZIP w latest release AUnlocker.')
    }
    const aUnlockerVersion = await installAUnlocker(aUnlockerRelease, aUnlockerAsset, config.managedGameDir)
    messages.push(`Zainstalowano AUnlocker ${aUnlockerVersion}.`)

    await writeMetadata({
        mira: miraVersion,
        extension: extensionVersion,
        aleLudu: aleLuduVersion,
        aUnlocker: aUnlockerVersion,
        lastAction: 'Gra i mody sa gotowe'
    })
    await refreshLatestModStatus()

    return {
        ready: true,
        messages,
        summary: 'Gotowe. Mozesz kliknac Graj.'
    }
}

function isManagedInstancePath(targetPath) {
    const expected = path.resolve(managedGameDir())
    const actual = path.resolve(targetPath || '')
    return actual === expected
}

async function reinstallEverything() {
    const config = await readConfig()
    if(!isManagedInstancePath(config.managedGameDir)) {
        throw new Error('Nie moge wykonac czystej instalacji na niestandardowej sciezce.')
    }

    await fs.promises.rm(config.managedGameDir, { recursive: true, force: true })
    await writeMetadata({
        mira: null,
        extension: null,
        aleLudu: null,
        aUnlocker: null,
        availableUpdates: {
            mira: false,
            extension: false,
            aleLudu: false,
            aUnlocker: false
        },
        lastAction: 'Rozpoczeto czysta instalacje'
    })

    const result = await installOrUpdateEverything()
    return {
        ...result,
        messages: ['Usunieto poprzednia instancje.', ...result.messages],
        summary: result.ready ? 'Czysta instalacja zakonczona.' : result.summary
    }
}

async function updateSingleMod(modId) {
    const config = await readConfig()
    if(!config.managedGameDir || !fs.existsSync(gameExePath(config.managedGameDir))) {
        throw new Error('Najpierw przygotuj instancje gry.')
    }

    const metadataUpdate = {}
    const messages = []

    if(modId === 'mira') {
        const release = await latestRelease(REPOS.mira)
        const asset = pickMiraAsset(release, config.platform)
        if(!asset) {
            throw new Error('Nie znalazlem paczki ZIP w latest release TOU Mira.')
        }
        metadataUpdate.mira = await installMira(release, asset, config.managedGameDir)
        messages.push(`Zaktualizowano TOU Mira do ${metadataUpdate.mira}.`)
    } else if(modId === 'extension') {
        const release = await latestRelease(REPOS.extension)
        const asset = pickExtensionAsset(release)
        if(!asset) {
            throw new Error('Nie znalazlem assetu DLL ani ZIP w latest release addonu.')
        }
        metadataUpdate.extension = await installExtension(release, asset, config.managedGameDir)
        messages.push(`Zaktualizowano MegaChujoweExt do ${metadataUpdate.extension}.`)
    } else if(modId === 'aleLudu') {
        const release = await latestRelease(REPOS.aleLudu)
        const asset = pickAleLuduAsset(release)
        if(!asset) {
            throw new Error('Nie znalazlem assetu DLL ani ZIP w latest release AleLuduMod.')
        }
        metadataUpdate.aleLudu = await installAleLudu(release, asset, config.managedGameDir)
        messages.push(`Zaktualizowano AleLuduMod do ${metadataUpdate.aleLudu}.`)
    } else if(modId === 'aUnlocker') {
        const release = await latestRelease(REPOS.aUnlocker)
        const asset = pickAUnlockerAsset(release, config.platform)
        if(!asset) {
            throw new Error('Nie znalazlem assetu DLL ani ZIP w latest release AUnlocker.')
        }
        metadataUpdate.aUnlocker = await installAUnlocker(release, asset, config.managedGameDir)
        messages.push(`Zaktualizowano AUnlocker do ${metadataUpdate.aUnlocker}.`)
    } else {
        throw new Error('Nieznany mod do aktualizacji.')
    }

    await writeMetadata({
        ...metadataUpdate,
        lastAction: messages[messages.length - 1]
    })
    await refreshLatestModStatus()

    return {
        ready: true,
        messages,
        summary: messages[messages.length - 1]
    }
}

function createWindow() {
    win = new BrowserWindow({
        width: 1080,
        height: 720,
        minWidth: 980,
        minHeight: 640,
        show: false,
        frame: false,
        backgroundColor: '#11130f',
        icon: getPlatformIcon(),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    })

    remoteMain.enable(win.webContents)
    ejse.data('appTitle', 'Chujowy Launcher')
    win.loadURL(pathToFileURL(path.join(__dirname, 'app', 'app.ejs')).toString())
    win.once('ready-to-show', () => {
        win.show()
        win.center()
        win.focus()
    })
    win.removeMenu()
    win.on('closed', () => {
        win = null
    })
}

ipcMain.on('window:minimize', () => win?.minimize())
ipcMain.on('window:close', () => win?.close())
ipcMain.on('program-update-prompt-response', (_event, id, confirmed) => {
    const resolve = updatePromptResolvers.get(id)
    if(!resolve) {
        return
    }
    updatePromptResolvers.delete(id)
    resolve(Boolean(confirmed))
})

ipcMain.handle('amongus:get-state', async () => stateSnapshot())
ipcMain.handle('amongus:bootstrap', async () => bootstrapLauncher())
ipcMain.handle('amongus:diagnose-repair', async () => diagnoseRepair())

ipcMain.handle('amongus:save-config', async (_event, update) => writeConfig(update || {}))
ipcMain.handle('amongus:auto-find-game', async () => autoFindGame())
ipcMain.handle('amongus:install-everything', async () => installOrUpdateEverything())
ipcMain.handle('amongus:reinstall-everything', async () => reinstallEverything())
ipcMain.handle('amongus:update-mod', async (_event, modId) => updateSingleMod(modId))
ipcMain.handle('amongus:open-mod-release', async (_event, modId) => {
    const state = await stateSnapshot()
    const hasUpdate = Boolean(state.status.availableUpdates[modId])
    const url = state.releaseUrls[modId]

    if(hasUpdate || !url) {
        return {
            opened: false,
            message: hasUpdate
                ? 'Najpierw zaktualizuj moda.'
                : 'Brak linku do release tego moda.'
        }
    }

    await shell.openExternal(url)
    return {
        opened: true,
        message: 'Otworzono GitHub release moda.'
    }
})

ipcMain.handle('amongus:select-source-dir', async () => {
    const result = await dialog.showOpenDialog(win, {
        title: 'Wybierz folder z Among Us.exe',
        properties: ['openDirectory']
    })
    if(result.canceled || result.filePaths.length === 0) {
        return null
    }
    return result.filePaths[0]
})

ipcMain.handle('amongus:launch-game', async () => {
    const config = await readConfig()
    const exePath = gameExePath(config.managedGameDir)
    if(!fs.existsSync(exePath)) {
        throw new Error('Brak Among Us.exe w instancji zarzadzanej.')
    }
    const child = spawn(exePath, [], {
        cwd: config.managedGameDir,
        detached: true,
        stdio: 'ignore'
    })
    child.unref()
    await writeMetadata({
        lastAction: 'Uruchomiono gre'
    })
    return {
        message: 'Gra zostala uruchomiona.'
    }
})

ipcMain.handle('amongus:open-plugins-folder', async () => {
    const config = await readConfig()
    const pluginDir = pluginsDir(config.managedGameDir)
    await ensureDir(pluginDir)

    const error = await shell.openPath(pluginDir)
    if(error) {
        throw new Error(error)
    }

    return {
        message: 'Otworzono folder BepInEx/plugins.'
    }
})

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
    await ensureDir(userDataRoot())
    const currentConfig = await readConfig()
    if(currentConfig.platform === 'steam' && !currentConfig.sourceGameDir) {
        const detectedDir = await detectSteamAmongUsDir()
        await writeConfig({
            ...currentConfig,
            sourceGameDir: detectedDir || '',
            sourceDetection: detectedDir ? 'auto' : currentConfig.sourceDetection
        })
        if(detectedDir) {
            await writeMetadata({
                lastAction: 'Automatycznie wykryto instalacje Steam'
            })
        }
    } else {
        await writeConfig(currentConfig)
    }
    await refreshLatestModStatus()
    createWindow()
    initProgramUpdater()
})

app.on('window-all-closed', () => {
    if(process.platform !== 'darwin') {
        app.quit()
    }
})
