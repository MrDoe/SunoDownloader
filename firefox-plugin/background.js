// background.js
const api = (typeof browser !== 'undefined') ? browser : chrome;

let stopFetchRequested = false;
let isFetching = false;

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
        api.tabs.query({ active: true, currentWindow: true }).then(tabs => {
            if (tabs[0]) {
                api.scripting.executeScript({
                    target: { tabId: tabs[0].id },
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
        downloadSelectedSongs(message.folderName, message.songs, message.format || 'mp3');
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
        const tabs = await api.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0 || !tabs[0].url.includes("suno.com")) {
            api.runtime.sendMessage({ action: "fetch_error", error: "❌ Error: Please open Suno.com in the active tab." });
            return;
        }
        const tabId = tabs[0].id;

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

async function downloadSelectedSongs(folderName, songs, format = 'mp3') {
    const cleanFolder = folderName.replace(/[^a-zA-Z0-9_-]/g, "");
    
    function sanitizeFilename(name) {
        return name.replace(/[<>:"/\\|?*]/g, "").trim().substring(0, 100);
    }
    
    const formatLabel = format.toUpperCase();
    logToPopup(`🚀 Starting download of ${songs.length} ${formatLabel} files...`);
    
    let downloadedCount = 0;
    let failedCount = 0;
    
    // For WAV downloads, we need to use the authenticated API
    if (format === 'wav') {
        // Get the active tab to execute the WAV conversion requests
        const tabs = await api.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0 || !tabs[0].url.includes("suno.com")) {
            logToPopup("❌ Error: Please open Suno.com for WAV downloads.");
            api.runtime.sendMessage({ action: "download_complete" });
            return;
        }
        const tabId = tabs[0].id;
        
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
            const title = song.title || `Untitled_${song.id}`;
            const filename = `${cleanFolder}/${sanitizeFilename(title)}_${song.id.slice(-4)}.wav`;
            
            try {
                // Request WAV conversion and poll until ready
                const wavResult = await api.scripting.executeScript({
                    target: { tabId: tabId },
                    world: "MAIN",
                    func: async (clipId, authToken) => {
                        try {
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
                
                if (result?.error) {
                    logToPopup(`⚠️ WAV failed: ${title} (${result.error})`);
                    failedCount++;
                    continue;
                }
                
                if (result?.url) {
                    await api.downloads.download({
                        url: result.url,
                        filename: filename,
                        conflictAction: "uniquify"
                    });
                    downloadedCount++;
                    
                    if (downloadedCount % 5 === 0) {
                        logToPopup(`📥 Downloaded ${downloadedCount}/${songs.length}...`);
                    }
                } else {
                    logToPopup(`⚠️ No WAV URL: ${title}`);
                    failedCount++;
                }
            } catch (err) {
                logToPopup(`⚠️ Failed: ${title}`);
                failedCount++;
            }
            
            // Longer delay for WAV to avoid rate limiting
            await new Promise(r => setTimeout(r, 500));
        }
    } else {
        // MP3 downloads - direct from CDN
        for (const song of songs) {
            if (song.audio_url) {
                const title = song.title || `Untitled_${song.id}`;
                const filename = `${cleanFolder}/${sanitizeFilename(title)}_${song.id.slice(-4)}.mp3`;
                
                try {
                    await api.downloads.download({
                        url: song.audio_url,
                        filename: filename,
                        conflictAction: "uniquify"
                    });
                    downloadedCount++;
                    
                    if (downloadedCount % 5 === 0) {
                        logToPopup(`📥 Downloaded ${downloadedCount}/${songs.length}...`);
                    }
                } catch (err) {
                    logToPopup(`⚠️ Failed: ${title}`);
                    failedCount++;
                }
                
                await new Promise(r => setTimeout(r, 200));
            }
        }
    }
    
    if (failedCount > 0) {
        logToPopup(`🎉 COMPLETE! Downloaded ${downloadedCount} songs (${failedCount} failed).`);
    } else {
        logToPopup(`🎉 COMPLETE! Downloaded ${downloadedCount} songs.`);
    }
    api.runtime.sendMessage({ action: "download_complete" });
}

function logToPopup(text) {
    try { api.runtime.sendMessage({ action: "log", text: text }); } catch (e) {}
}

