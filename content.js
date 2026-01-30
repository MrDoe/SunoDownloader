// content.js
(async function() {
    function log(text) {
        chrome.runtime.sendMessage({ action: "log", text: text });
    }

    function sanitizeFilename(name) {
        return name.replace(/[<>:"/\\|?*]/g, "").trim().substring(0, 100);
    }

    const token = window.sunoAuthToken;
    const folderName = window.sunoDownloadFolder || "Suno_Songs";
    const isPublicOnly = window.sunoPublicOnly; // <--- Retrieve boolean
    const cleanFolder = folderName.replace(/[^a-zA-Z0-9_-]/g, "");

    if (!token) {
        log("❌ Fatal: No Auth Token received.");
        return;
    }

    const mode = isPublicOnly ? "Public Songs Only" : "All Songs";
    log(`🚀 Scraper started (${mode})...`);

    let page = 0;
    let keepGoing = true;
    let foundCount = 0;

    try {
        while (keepGoing) {
            log(`Scanning Page ${page}...`);

            const response = await fetch(`https://studio-api.prod.suno.com/api/feed/v2?page=${page}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.status === 401) {
                log("❌ Error 401: Token expired.");
                break;
            }
            if (!response.ok) {
                log(`❌ API Error: ${response.status}`);
                break;
            }

            const data = await response.json();
            const clips = data.clips;

            if (!clips || clips.length === 0) {
                log("✅ End of list.");
                keepGoing = false;
                break;
            }

            for (const clip of clips) {
                // <--- FILTER LOGIC HERE --->
                if (isPublicOnly && !clip.is_public) {
                    continue; // Skip if user wants public only, but clip is private
                }

                if (clip.audio_url) {
                    const title = clip.title || `Untitled_${clip.id}`;
                    const filename = `${cleanFolder}/${sanitizeFilename(title)}_${clip.id.slice(-4)}.mp3`;

                    chrome.runtime.sendMessage({
                        action: "download_item",
                        url: clip.audio_url,
                        filename: filename
                    });
                    
                    foundCount++;
                }
            }

            page++;
            await new Promise(r => setTimeout(r, 1500));
        }
        
        log(`🎉 COMPLETE! Scanned ${foundCount} songs.`);

    } catch (err) {
        log(`❌ Critical Error: ${err.message}`);
    }
})();

