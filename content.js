// content.js
(async function() {
    const api = (typeof browser !== 'undefined') ? browser : chrome;
    
    function log(text) {
        api.runtime.sendMessage({ action: "log", text: text });
    }

    const token = window.sunoAuthToken;
    const isPublicOnly = window.sunoPublicOnly;
    const maxPages = window.sunoMaxPages || 0; // 0 = unlimited
    const checkNewOnly = window.sunoCheckNewOnly || false;
    const mode = window.sunoMode || "fetch"; // "fetch" to get list

    if (!token) {
        api.runtime.sendMessage({ action: "fetch_error_internal", error: "❌ Fatal: No Auth Token received." });
        return;
    }

    const modeLabel = isPublicOnly ? "Public Songs Only" : "All Songs";
    const pagesLabel = maxPages > 0 ? `, max ${maxPages} pages` : "";
    if (!checkNewOnly) {
        log(`🔍 Fetching songs (${modeLabel}${pagesLabel})...`);
    }

    let page = 0;
    let keepGoing = true;
    let allSongs = [];

    try {
        while (keepGoing) {
            // Check if stop was requested
            if (window.sunoStopFetch) {
                log(`⏹️ Stopped by user. Found ${allSongs.length} songs.`);
                break;
            }
            
            // Check max pages limit
            if (maxPages > 0 && page >= maxPages) {
                log(`✅ Reached max pages limit (${maxPages}). Found ${allSongs.length} songs.`);
                break;
            }
            
            log(`📄 Page ${page + 1}${maxPages > 0 ? '/' + maxPages : ''} | Found ${allSongs.length} songs so far...`);

            const response = await fetch(`https://studio-api.prod.suno.com/api/feed/v2?page=${page}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.status === 401) {
                api.runtime.sendMessage({ action: "fetch_error_internal", error: "❌ Error 401: Token expired." });
                return;
            }
            if (!response.ok) {
                api.runtime.sendMessage({ action: "fetch_error_internal", error: `❌ API Error: ${response.status}` });
                return;
            }

            const data = await response.json();
            const clips = data.clips;

            if (!clips || clips.length === 0) {
                log(`✅ End of list. Found ${allSongs.length} songs total.`);
                keepGoing = false;
                break;
            }

            let addedThisPage = 0;
            for (const clip of clips) {
                // Filter by public/private if requested
                if (isPublicOnly && !clip.is_public) {
                    continue;
                }

                if (clip.audio_url) {
                    allSongs.push({
                        id: clip.id,
                        title: clip.title || `Untitled_${clip.id}`,
                        audio_url: clip.audio_url,
                        is_public: clip.is_public,
                        created_at: clip.created_at
                    });
                    addedThisPage++;
                }
            }

            page++;
            await new Promise(r => setTimeout(r, 500));
        }
        
        log(`✅ Found ${allSongs.length} songs.`);
        
        // Send songs list back to background script
        api.runtime.sendMessage({ 
            action: "songs_list", 
            songs: allSongs,
            checkNewOnly: checkNewOnly
        });

    } catch (err) {
        api.runtime.sendMessage({ action: "fetch_error_internal", error: `❌ Critical Error: ${err.message}` });
    }
})();

