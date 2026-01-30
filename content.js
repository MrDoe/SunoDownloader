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
    const knownIds = new Set(window.sunoKnownIds || []);
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
    const pageSize = 20; // Request larger pages (default is typically 20)
    const parallelPages = 1; // Fetch 1 page at once

    async function fetchPage(pageNum) {
        let retries = 0;
        const maxRetries = 5;
        
        while (retries < maxRetries) {
            const response = await fetch(`https://studio-api.prod.suno.com/api/feed/v2?page=${pageNum}&page_size=${pageSize}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (response.status === 429) {
                retries++;
                const waitTime = Math.pow(2, retries) * 1000; // 1s, 2s, 4s, 8s, 16s
                log(`⏳ Rate limited. Waiting ${waitTime / 1000}s... (retry ${retries}/${maxRetries})`);
                await new Promise(r => setTimeout(r, waitTime));
                continue;
            }
            
            return response;
        }
        return null;
    }

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
            
            // Calculate how many pages to fetch in parallel
            const pagesToFetch = [];
            for (let i = 0; i < parallelPages; i++) {
                if (maxPages > 0 && page + i >= maxPages) break;
                pagesToFetch.push(page + i);
            }

            if(parallelPages === 1)
                log(`📄 Fetching page ${pagesToFetch[0] + 1}${maxPages > 0 ? '/' + maxPages : ''}...` + 
                    ` Found ${allSongs.length} songs so far...`);
            else
                log(`📄 Pages ${pagesToFetch[0] + 1}-${pagesToFetch[pagesToFetch.length - 1] + 1}${maxPages > 0 ? '/' + maxPages : ''} | Found ${allSongs.length} songs so far...`);

            // Fetch pages in parallel
            const responses = await Promise.all(pagesToFetch.map(p => fetchPage(p)));
            
            let allEmpty = true;
            let foundKnownSong = false;
            
            for (let i = 0; i < responses.length; i++) {
                const response = responses[i];
                
                if (!response) {
                    api.runtime.sendMessage({ action: "fetch_error_internal", error: `❌ API Error: Max retries exceeded` });
                    return;
                }
                
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
                    continue;
                }
                
                //log(`   → Got ${clips.length} clips from page ${pagesToFetch[i] + 1}`);
                allEmpty = false;

                for (const clip of clips) {
                    if (isPublicOnly && !clip.is_public) {
                        continue;
                    }

                    if (checkNewOnly && knownIds.has(clip.id)) {
                        log(`✅ Found known song. ${allSongs.length} new song(s) found.`);
                        foundKnownSong = true;
                        break;
                    }

                    if (clip.audio_url) {
                        allSongs.push({
                            id: clip.id,
                            title: clip.title || `Untitled_${clip.id}`,
                            audio_url: clip.audio_url,
                            is_public: clip.is_public,
                            created_at: clip.created_at
                        });
                    }
                }
                
                if (foundKnownSong) break;
            }

            if (foundKnownSong || allEmpty) {
                if (allEmpty) {
                    log(`✅ End of list. Found ${allSongs.length} songs total.`);
                }
                keepGoing = false;
                break;
            }

            page += parallelPages;
            await new Promise(r => setTimeout(r, 600)); // Delay between batches
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

