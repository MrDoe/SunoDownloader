// background.js
const api = (typeof browser !== 'undefined') ? browser : chrome;

let stopFetchRequested = false;
let isFetching = false;

let stopDownloadRequested = false;
let isDownloading = false;
let currentDownloadJobId = 0;
let activeDownloadIds = new Set();

const DOWNLOAD_STATE_KEY = 'sunoDownloadState';

async function getSunoTab() {
    // On Firefox Android the options page is often the active tab.
    // We therefore search for a Suno tab in the current window as fallback.
    try {
        const activeTabs = await api.tabs.query({ active: true, currentWindow: true });
        const active = activeTabs?.[0];
        if (active?.url && active.url.includes('suno.com')) return active;

        const windowTabs = await api.tabs.query({ currentWindow: true });
        const sunoInWindow = windowTabs.find(t => t.url && t.url.includes('suno.com'));
        if (sunoInWindow) return sunoInWindow;

        const allTabs = await api.tabs.query({});
        return allTabs.find(t => t.url && t.url.includes('suno.com')) || null;
    } catch (e) {
        return null;
    }
}

async function persistDownloadState(extra = {}) {
    try {
        await api.storage.local.set({
            [DOWNLOAD_STATE_KEY]: {
                isDownloading,
                stopRequested: stopDownloadRequested,
                jobId: currentDownloadJobId,
                activeDownloadIds: Array.from(activeDownloadIds),
                ...extra
            }
        });
    } catch (e) {
        // ignore
    }
}

async function readPersistedDownloadState() {
    try {
        const result = await api.storage.local.get(DOWNLOAD_STATE_KEY);
        return result?.[DOWNLOAD_STATE_KEY] || null;
    } catch (e) {
        return null;
    }
}

function broadcastDownloadState() {
    try {
        api.runtime.sendMessage({
            action: 'download_state',
            isDownloading,
            stopRequested: stopDownloadRequested,
            jobId: currentDownloadJobId
        });
    } catch (e) {
        // ignore
    }
}

// Keep active download IDs in sync (best-effort)
try {
    api.downloads?.onChanged?.addListener((delta) => {
        if (!delta || typeof delta.id !== 'number') return;
        const state = delta.state?.current;
        if (state === 'complete' || state === 'interrupted') {
            if (activeDownloadIds.delete(delta.id)) {
                persistDownloadState();
            }
        }
    });
} catch (e) {
    // ignore
}

// Handle browser action click - open options page on Android
api.action.onClicked.addListener(async () => {
    try {
        const platformInfo = await api.runtime.getPlatformInfo();
        // On Android, the popup doesn't work, so open the options page
        if (platformInfo.os === 'android') {
            api.runtime.openOptionsPage();
        }
        // On other platforms, the popup will open naturally (no need to handle)
    } catch (e) {
        console.error('Error handling action click:', e);
    }
});

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "fetch_feed_page") {
        (async () => {
            try {
                const token = message.token;
                const cursorValue = message.cursor || null;
                const isPublicOnly = !!message.isPublicOnly;

                if (!token) {
                    sendResponse({ ok: false, status: 0, error: "Missing token" });
                    return;
                }

                const body = {
                    limit: 20,
                    filters: {
                        disliked: "False",
                        trashed: "False",
                        fromStudioProject: { presence: "False" }
                    }
                };

                if (isPublicOnly) {
                    body.filters.public = "True";
                }
                if (cursorValue) {
                    body.cursor = cursorValue;
                }

                const controller = new AbortController();
                const timeoutMs = 20000;
                const timeout = setTimeout(() => controller.abort(), timeoutMs);

                const response = await fetch('https://studio-api.prod.suno.com/api/feed/v3', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(body),
                    signal: controller.signal
                });

                clearTimeout(timeout);

                const status = response.status;
                let data = null;
                try {
                    data = await response.json();
                } catch (e) {
                    // ignore
                }

                sendResponse({
                    ok: response.ok,
                    status,
                    data
                });
            } catch (e) {
                sendResponse({ ok: false, status: 0, error: e?.message || String(e) });
            }
        })();
        return true;
    }

    if (message.action === "fetch_songs") {
        stopFetchRequested = false;
        isFetching = true;
        fetchSongsList(message.isPublicOnly, message.maxPages, message.checkNewOnly, message.knownIds);
    }
    
    if (message.action === "get_fetch_state") {
        sendResponse({ isFetching: isFetching });
        return true;
    }
    
    if (message.action === "stop_fetch") {
        stopFetchRequested = true;
        isFetching = false;
        // Notify content script to stop
        getSunoTab().then(tab => {
            if (tab?.id) {
                api.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => { window.sunoStopFetch = true; }
                });
            }
        });
    }
    
    if (message.action === "check_stop") {
        sendResponse({ stop: stopFetchRequested });
        return true;
    }

    if (message.action === "download_selected") {
        if (isDownloading) {
            logToPopup("⚠️ Download already running. Stop it first.");
            return;
        }
        stopDownloadRequested = false;
        isDownloading = true;
        currentDownloadJobId += 1;
        activeDownloadIds = new Set();
        persistDownloadState({ startedAt: Date.now() });
        broadcastDownloadState();
        downloadSelectedSongs(message.folderName, message.songs, message.format || 'mp3', currentDownloadJobId);
    }

    if (message.action === "stop_download") {
        stopDownloadRequested = true;
        isDownloading = false;
        persistDownloadState({ stoppedAt: Date.now() });
        broadcastDownloadState();

        // Try to cancel in-progress browser downloads (best-effort)
        readPersistedDownloadState().then((state) => {
            const persistedIds = Array.isArray(state?.activeDownloadIds) ? state.activeDownloadIds : [];
            const idsToCancel = Array.from(new Set([...Array.from(activeDownloadIds), ...persistedIds]));
            for (const id of idsToCancel) {
                try { api.downloads.cancel(id); } catch (e) {}
            }
        });

        // Notify the Suno page to stop any in-page WAV polling
        getSunoTab().then(tab => {
            if (tab?.id) {
                api.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => { window.sunoStopDownload = true; }
                });
            }
        });

        try { api.runtime.sendMessage({ action: "download_stopped" }); } catch (e) {}
    }

    if (message.action === "get_download_state") {
        // Prefer persisted state (helps when popup is reopened)
        readPersistedDownloadState().then((state) => {
            if (state) {
                sendResponse({
                    isDownloading: !!state.isDownloading,
                    stopRequested: !!state.stopRequested,
                    jobId: state.jobId || 0
                });
            } else {
                sendResponse({
                    isDownloading,
                    stopRequested: stopDownloadRequested,
                    jobId: currentDownloadJobId
                });
            }
        });
        return true;
    }

    if (message.action === "download_item") {
        api.downloads.download({
            url: message.url,
            filename: message.filename,
            conflictAction: "uniquify"
        });
    }
    
    if (message.action === "songs_list") {
        isFetching = false;
        // Forward songs list from content script to popup
        api.runtime.sendMessage({ 
            action: "songs_fetched", 
            songs: message.songs,
            checkNewOnly: message.checkNewOnly
        });
    }
    
    if (message.action === "fetch_error_internal") {
        isFetching = false;
        api.runtime.sendMessage({ action: "fetch_error", error: message.error });
    }
});

async function fetchSongsList(isPublicOnly, maxPages, checkNewOnly = false, knownIds = []) {
    try {
        const tab = await getSunoTab();
        if (!tab?.id || !tab.url || !tab.url.includes("suno.com")) {
            api.runtime.sendMessage({ action: "fetch_error", error: "❌ Error: Please open Suno.com in the active tab." });
            return;
        }
        const tabId = tab.id;

        if (!checkNewOnly) {
            logToPopup("🔑 Extracting Auth Token...");
        }

        const tokenResults = await api.scripting.executeScript({
            target: { tabId: tabId },
            world: "MAIN",
            func: async () => {
                try {
                    if (window.Clerk && window.Clerk.session) {
                        return await window.Clerk.session.getToken();
                    }
                    return null;
                } catch (e) { return null; }
            }
        });

        const token = tokenResults[0]?.result;

        if (!token) {
            api.runtime.sendMessage({ action: "fetch_error", error: "❌ Error: Could not find Auth Token. Log in first!" });
            return;
        }

        if (!checkNewOnly) {
            logToPopup("✅ Token found! Fetching songs list...");
        }

        await api.scripting.executeScript({
            target: { tabId: tabId },
            func: (t, p, m, c, k) => { 
                window.sunoAuthToken = t; 
                window.sunoPublicOnly = p;
                window.sunoMaxPages = m;
                window.sunoCheckNewOnly = c;
                window.sunoKnownIds = k;
                window.sunoStopFetch = false;
                window.sunoMode = "fetch";
            },
            args: [token, isPublicOnly, maxPages, checkNewOnly, knownIds]
        });

        await api.scripting.executeScript({
            target: { tabId: tabId },
            files: ["content.js"]
        });

    } catch (err) {
        console.error(err);
        api.runtime.sendMessage({ action: "fetch_error", error: "❌ System Error: " + err.message });
    }
}

async function downloadSelectedSongs(folderName, songs, format = 'mp3', jobId = 0) {
    const cleanFolder = folderName.replace(/[^a-zA-Z0-9_-]/g, "");
    
    function sanitizeFilename(name) {
        return name.replace(/[<>:"/\\|?*]/g, "").trim().substring(0, 100);
    }
    
    const formatLabel = format.toUpperCase();
    logToPopup(`🚀 Starting download of ${songs.length} ${formatLabel} files...`);

    // Firefox Android: subfolders in downloads filename are often unsupported.
    let isAndroid = false;
    try {
        const platformInfo = await api.runtime.getPlatformInfo();
        isAndroid = platformInfo?.os === 'android';
    } catch (e) {
        // ignore
    }

    if (isAndroid) {
        logToPopup('📱 Android detected: saving files without subfolders.');
    }

    // Ensure in-page stop flag exists (used for WAV polling)
    try {
        const tab = await getSunoTab();
        if (tab?.id && tab.url && tab.url.includes("suno.com")) {
            await api.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => { window.sunoStopDownload = false; }
            });
        }
    } catch (e) {
        // ignore
    }
    
    let downloadedCount = 0;
    let failedCount = 0;
    
    // For WAV downloads, we need to use the authenticated API
    if (format === 'wav') {
        // Get the active tab to execute the WAV conversion requests
        const tab = await getSunoTab();
        if (!tab?.id || !tab.url || !tab.url.includes("suno.com")) {
            logToPopup("❌ Error: Please open Suno.com for WAV downloads.");
            api.runtime.sendMessage({ action: "download_complete" });
            return;
        }
        const tabId = tab.id;
        
        // Get auth token
        const tokenResults = await api.scripting.executeScript({
            target: { tabId: tabId },
            world: "MAIN",
            func: async () => {
                try {
                    if (window.Clerk && window.Clerk.session) {
                        return await window.Clerk.session.getToken();
                    }
                    return null;
                } catch (e) { return null; }
            }
        });
        
        const token = tokenResults[0]?.result;
        if (!token) {
            logToPopup("❌ Error: Could not get auth token for WAV download.");
            api.runtime.sendMessage({ action: "download_complete" });
            return;
        }
        
        for (const song of songs) {
            if (stopDownloadRequested || !isDownloading || jobId !== currentDownloadJobId) {
                logToPopup("⏹️ Download stopped by user.");
                break;
            }
            const title = song.title || `Untitled_${song.id}`;
            const baseName = `${sanitizeFilename(title)}_${song.id.slice(-4)}.wav`;
            const folderPrefix = sanitizeFilename(cleanFolder);
            const filename = isAndroid
                ? (folderPrefix ? `${folderPrefix}-${baseName}` : baseName)
                : `${cleanFolder}/${baseName}`;
            
            try {
                // Request WAV conversion and poll until ready
                const wavResult = await api.scripting.executeScript({
                    target: { tabId: tabId },
                    world: "MAIN",
                    func: async (clipId, authToken) => {
                        try {
                            if (window.sunoStopDownload) {
                                return { stopped: true };
                            }
                            // Step 1: Start the conversion
                            const convertResponse = await fetch(`https://studio-api.prod.suno.com/api/gen/${clipId}/convert_wav/`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${authToken}`
                                }
                            });
                            
                            if (!convertResponse.ok) {
                                return { error: `Convert HTTP ${convertResponse.status}` };
                            }
                            
                            // Step 2: Poll for the WAV file URL
                            const maxAttempts = 30;
                            for (let i = 0; i < maxAttempts; i++) {
                                if (window.sunoStopDownload) {
                                    return { stopped: true };
                                }
                                await new Promise(r => setTimeout(r, 1000));
                                
                                const pollResponse = await fetch(`https://studio-api.prod.suno.com/api/gen/${clipId}/wav_file/`, {
                                    method: 'GET',
                                    headers: {
                                        'Authorization': `Bearer ${authToken}`
                                    }
                                });
                                
                                if (pollResponse.ok) {
                                    const data = await pollResponse.json();
                                    const wavUrl = data.wav_file_url || data.url || data.download_url;
                                    if (wavUrl) {
                                        return { url: wavUrl };
                                    }
                                    if (data.status === 'complete' || data.status === 'ready') {
                                        return { url: wavUrl };
                                    }
                                } else if (pollResponse.status === 404 || pollResponse.status === 202) {
                                    // Still processing, continue polling
                                    continue;
                                } else {
                                    return { error: `Poll HTTP ${pollResponse.status}` };
                                }
                            }
                            return { error: 'Timeout waiting for WAV' };
                        } catch (e) {
                            return { error: e.message };
                        }
                    },
                    args: [song.id, token]
                });
                
                const result = wavResult[0]?.result;

                if (result?.stopped) {
                    logToPopup("⏹️ Download stopped by user.");
                    break;
                }
                
                if (result?.error) {
                    logToPopup(`⚠️ WAV failed: ${title} (${result.error})`);
                    failedCount++;
                    continue;
                }
                
                if (result?.url) {
                    const downloadId = await api.downloads.download({
                        url: result.url,
                        filename: filename,
                        conflictAction: "uniquify"
                    });
                    if (typeof downloadId === 'number') {
                        activeDownloadIds.add(downloadId);
                        persistDownloadState();
                    }
                    downloadedCount++;
                    
                    if (downloadedCount % 5 === 0) {
                        logToPopup(`📥 Downloaded ${downloadedCount}/${songs.length}...`);
                    }
                } else {
                    logToPopup(`⚠️ No WAV URL: ${title}`);
                    failedCount++;
                }
            } catch (err) {
                const msg = (err && (err.message || err.toString)) ? (err.message || err.toString()) : '';
                logToPopup(`⚠️ Failed: ${title}${msg ? ` (${msg})` : ''}`);
                failedCount++;
            }
            
            // Longer delay for WAV to avoid rate limiting
            await new Promise(r => setTimeout(r, 500));
        }
    } else {
        // MP3 downloads - direct from CDN
        for (const song of songs) {
            if (stopDownloadRequested || !isDownloading || jobId !== currentDownloadJobId) {
                logToPopup("⏹️ Download stopped by user.");
                break;
            }
            if (song.audio_url) {
                const title = song.title || `Untitled_${song.id}`;
                const baseName = `${sanitizeFilename(title)}_${song.id.slice(-4)}.mp3`;
                const folderPrefix = sanitizeFilename(cleanFolder);
                const filename = isAndroid
                    ? (folderPrefix ? `${folderPrefix}-${baseName}` : baseName)
                    : `${cleanFolder}/${baseName}`;
                
                try {
                    const downloadId = await api.downloads.download({
                        url: song.audio_url,
                        filename: filename,
                        conflictAction: "uniquify"
                    });
                    if (typeof downloadId === 'number') {
                        activeDownloadIds.add(downloadId);
                        persistDownloadState();
                    }
                    downloadedCount++;
                    
                    if (downloadedCount % 5 === 0) {
                        logToPopup(`📥 Downloaded ${downloadedCount}/${songs.length}...`);
                    }
                } catch (err) {
                    const msg = (err && (err.message || err.toString)) ? (err.message || err.toString()) : '';
                    logToPopup(`⚠️ Failed: ${title}${msg ? ` (${msg})` : ''}`);
                    failedCount++;
                }
                
                await new Promise(r => setTimeout(r, 200));
            }
        }
    }
    
    const stopped = stopDownloadRequested || !isDownloading || jobId !== currentDownloadJobId;
    if (stopped) {
        logToPopup(`⏹️ STOPPED. Downloaded ${downloadedCount} song(s) (${failedCount} failed).`);
    } else if (failedCount > 0) {
        logToPopup(`🎉 COMPLETE! Downloaded ${downloadedCount} songs (${failedCount} failed).`);
    } else {
        logToPopup(`🎉 COMPLETE! Downloaded ${downloadedCount} songs.`);
    }

    // Reset download state
    stopDownloadRequested = false;
    isDownloading = false;
    activeDownloadIds = new Set();
    persistDownloadState({ finishedAt: Date.now() });
    broadcastDownloadState();

    api.runtime.sendMessage({ action: "download_complete", stopped: stopped });
}

function logToPopup(text) {
    try { api.runtime.sendMessage({ action: "log", text: text }); } catch (e) {}
}

