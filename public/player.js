const playerEl = document.getElementById('player');
const video = document.getElementById('vid');
const loader = document.getElementById('loader');
const loaderText = document.querySelector('.loader-text');
const loaderPoster = document.querySelector('.loader-poster');
const pf = document.getElementById('pf');
const pth = document.getElementById('pth');
const pw = document.getElementById('pw');
const curTimeEl = document.getElementById('cur-t');
const durTimeEl = document.getElementById('dur-t');
const titlePart = document.querySelector('.title-part');
const capVal = document.getElementById('cap-val');
const qualVal = document.getElementById('qual-val');
const qualityPanel = document.getElementById('sub-quality');
const captionsPanel = document.getElementById('sub-captions');
const captionOverlay = document.getElementById('caption-overlay');
const speedVal = document.getElementById('speed-val');
const downloadBtn = document.getElementById('download-btn');
const nextBtn = document.getElementById('next-btn');

let playing = false;
let hideT = null;
let lastTap = 0;
let drag = false;
let currentQuality = null;
let currentQualityData = null;
let currentCaption = null;
let streamData = null;
let useProxyFallback = false;
let captionCues = [];
let selectedCaptionLabel = 'Off';
let saveStateTimer = null;

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/original';
const TMDB_DEFAULT_LANG = 'en-US';
const STORAGE_PREFIX = 'vidlink-player';

let playerOptions = {
  primaryColor: '#ffffff',
  secondaryColor: 'rgba(255,255,255,0.28)',
  icons: 'vid',
  iconColor: '#ffffff',
  title: true,
  poster: true,
  autoplay: false,
  nextbutton: false,
  player: 'default',
  startAt: 0,
  subFile: '',
  subLabel: 'External Subtitle',
  fallbackUrl: '',
};

const routeParams = {
  type: null,
  id: null,
  s: null,
  e: null,
  t: null,
};

function parseBoolean(value, fallback = false) {
  if (value === null || value === undefined || value === '') return fallback;
  const normalized = `${value}`.trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function normalizeColor(value, fallback) {
  if (!value) return fallback;
  const trimmed = `${value}`.trim();
  if (!trimmed) return fallback;
  if (trimmed.startsWith('#')) return trimmed;
  if (/^[0-9a-f]{3,8}$/i.test(trimmed)) return `#${trimmed}`;
  return fallback;
}

function parsePlayerOptions() {
  const params = new URLSearchParams(window.location.search);
  const parsed = {
    primaryColor: normalizeColor(params.get('primaryColor') || params.get('primaryColorNew'), '#ffffff'),
    secondaryColor: normalizeColor(params.get('secondaryColor') || params.get('secondaryColorNew'), 'rgba(255,255,255,0.28)'),
    icons: (params.get('icons') || 'vid').toLowerCase(),
    iconColor: normalizeColor(params.get('iconColor') || params.get('iconColorNew'), '#ffffff'),
    title: parseBoolean(params.get('title'), true),
    poster: parseBoolean(params.get('poster'), true),
    autoplay: parseBoolean(params.get('autoplay'), false),
    nextbutton: parseBoolean(params.get('nextbutton') || params.get('nextButton'), false),
    player: (params.get('player') || params.get('playerNew') || 'default').toLowerCase(),
    startAt: Number(params.get('startAt') || params.get('startAtNew') || 0),
    subFile: params.get('sub_file') || params.get('sub_fileNew') || '',
    subLabel: params.get('sub_label') || params.get('sub_labelNew') || 'External Subtitle',
    fallbackUrl: params.get('fallback_url') || params.get('fallback_urlNew') || '',
  };

  if (Number.isNaN(parsed.startAt)) {
    parsed.startAt = 0;
  }

  return parsed;
}

function applyPlayerOptions(options = playerOptions) {
  document.documentElement.style.setProperty('--primary-color', normalizeColor(options.primaryColor, '#ffffff'));
  document.documentElement.style.setProperty('--secondary-color', normalizeColor(options.secondaryColor, 'rgba(255,255,255,0.28)'));
  document.documentElement.style.setProperty('--icon-color', normalizeColor(options.iconColor, '#ffffff'));
  document.body.classList.toggle('title-hidden', !options.title);
  document.body.classList.toggle('poster-hidden', !options.poster);
  document.body.classList.toggle('player-icons-default', options.icons === 'default');
  document.body.classList.toggle('player-jw', options.player === 'jw');
  if (nextBtn) {
    nextBtn.style.display = options.nextbutton ? 'flex' : 'none';
  }

  if (options.subFile && !document.querySelector('track[data-player-external]')) {
    const track = document.createElement('track');
    track.kind = 'captions';
    track.label = options.subLabel || 'External Subtitle';
    track.srclang = 'en';
    track.src = options.subFile;
    track.default = true;
    track.dataset.playerExternal = 'true';
    video.appendChild(track);
  }
}

function parseRouteParams() {
  const params = new URLSearchParams(window.location.search);
  routeParams.type = params.get('type');
  routeParams.id = params.get('id');
  routeParams.s = params.get('s');
  routeParams.e = params.get('e');
  routeParams.t = params.get('t');

  const path = window.location.pathname.replace(/\/+$/, '');
  const movieMatch = path.match(/^\/movie\/([^/]+)$/i);
  const tvMatch = path.match(/^\/tv\/([^/]+)\/([^/]+)\/([^/]+)$/i);
  const animeMatch = path.match(/^\/anime\/([^/]+)\/([^/]+)\/([^/]+)$/i);

  if (!routeParams.type && movieMatch) {
    routeParams.type = 'movie';
    routeParams.id = movieMatch[1];
  }

  if (!routeParams.type && tvMatch) {
    routeParams.type = 'tv';
    routeParams.id = tvMatch[1];
    routeParams.s = tvMatch[2];
    routeParams.e = tvMatch[3];
  }

  if (!routeParams.type && animeMatch) {
  routeParams.type = 'anime';
  routeParams.id = animeMatch[1];
  routeParams.e = animeMatch[2];
  routeParams.t = animeMatch[3];
}
}

function buildScrapeUrl() {
  if (!routeParams.type || !routeParams.id) {
    return null;
  }

  const params = new URLSearchParams();
  params.set('type', routeParams.type);
  params.set('id', routeParams.id);

  if (routeParams.type === 'tv') {
    if (!routeParams.s || !routeParams.e) {
      return null;
    }
    params.set('s', routeParams.s);
    params.set('e', routeParams.e);
  }

  if (routeParams.type === 'anime') {
  if (!routeParams.e || !routeParams.t) {
    return null;
  }

  params.set('e', routeParams.e);
  params.set('t', routeParams.t);
}

  return `/api/scrape?${params.toString()}`;
}

function getProxyUrl(url) {
  return `/api/proxy?url=${encodeURIComponent(url)}`;
}

function showLoader(message = 'Loading stream...') {
  loaderText.textContent = message;
  loader.classList.remove('gone');
}

function hideLoader() {
  loader.classList.add('gone');
}

function setLoaderPoster(url) {
  if (url) {
    loaderPoster.style.backgroundImage = `url('${url}')`;
  }
}

function getRouteKey() {
  return `${STORAGE_PREFIX}:${routeParams.type}:${routeParams.id}:${routeParams.s || ''}:${routeParams.e || ''}:${routeParams.t || ''}`;
}

function loadCachedData() {
  try {
    const raw = localStorage.getItem(getRouteKey());
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveCachedData(content) {
  try {
    localStorage.setItem(getRouteKey(), JSON.stringify({ ...content, savedAt: Date.now() }));
  } catch {
    // ignore storage failures
  }
}

function updateCacheSelection() {
  const cached = loadCachedData();
  if (!cached) return;
  saveCachedData({
    data: cached.data,
    selectedQuality: currentQuality,
    selectedCaption: selectedCaptionLabel,
  });
}

function loadSavedState() {
  try {
    const raw = localStorage.getItem(`${getRouteKey()}:state`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function savePlaybackState() {
  try {
    localStorage.setItem(
  `${getRouteKey()}:state`,
  JSON.stringify({ currentTime: video.currentTime || 0, quality: currentQuality, caption: selectedCaptionLabel })
  );
  } catch {
    // ignore storage failures
  }
}

function queueSaveState() {
  clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(savePlaybackState, 800);
}

function buildTmdbUrl() {
  if (!routeParams.type || !routeParams.id) return null;

  if (routeParams.type === 'movie') {
    return `https://api.themoviedb.org/3/movie/${encodeURIComponent(routeParams.id)}?language=${TMDB_DEFAULT_LANG}`;
  }

  if (routeParams.type === 'tv' && routeParams.s && routeParams.e) {
    return `https://api.themoviedb.org/3/tv/${encodeURIComponent(routeParams.id)}/season/${encodeURIComponent(
      routeParams.s
      )}/episode/${encodeURIComponent(routeParams.e)}?language=${TMDB_DEFAULT_LANG}`;
  }

  return null;
}

async function fetchTmdbMetadata() {
  const url = buildTmdbUrl();
  if (!url) {
    return null;
  }

  try {
    const response = await fetch(`/api/tmdb?url=${encodeURIComponent(url)}`);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

function setTmdbMetadata(showData, episodeData) {
  if (!episodeData) return;

  const isTV = routeParams.type === "tv";

  let finalTitle = "";

  if (isTV) {
    const showName =
      showData?.name ||
      showData?.original_name ||
      "Unknown Show";

    const episodeTitle =
      episodeData?.name ||
      "Untitled Episode";

    const season = routeParams.s ?? episodeData?.season_number ?? 0;
    const episode = routeParams.e ?? episodeData?.episode_number ?? 0;

    finalTitle = `${showName} - ${episodeTitle} (S${season}E${episode}) | VidLink`;
  } else {
    const movieTitle =
      episodeData.title ||
      episodeData.original_title ||
      "Untitled Movie";

    const year = (episodeData.release_date || "").slice(0, 4);

    finalTitle = `${movieTitle}${year ? ` (${year})` : ""} | VidLink`;
  }

  titlePart.textContent = finalTitle;
  document.title = finalTitle;

  const imagePath =
    episodeData.backdrop_path ||
    episodeData.poster_path ||
    episodeData.still_path;

  if (imagePath) {
    setLoaderPoster(`${TMDB_IMAGE_BASE}${imagePath}`);
  }
}

function setAnilistMetadata(animeData) {
  if (!animeData) return;

  const title =
    animeData.title?.english ||
    animeData.title?.romaji ||
    animeData.title?.native ||
    "Unknown Anime";

  const episode = routeParams.e || routeParams.t || "";

  const finalTitle = episode
    ? `${title} - Episode ${episode} | VidLink`
    : `${title} | VidLink`;

  titlePart.textContent = finalTitle;
  document.title = finalTitle;

  if (animeData.coverImage?.extraLarge) {
    setLoaderPoster(animeData.coverImage.extraLarge);
  }
}

async function fetchTmdbShow() {
  if (routeParams.type !== "tv") return null;

  try {
    const url = `https://api.themoviedb.org/3/tv/${routeParams.id}?language=${TMDB_DEFAULT_LANG}`;
    const response = await fetch(`/api/tmdb?url=${encodeURIComponent(url)}`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchAnilistAnime(id) {
  const query = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        title {
          romaji
          english
          native
        }
        coverImage {
          extraLarge
        }
        episodes
      }
    }
  `;

  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query,
      variables: {
        id: Number(id)
      }
    })
  });

  const json = await response.json();
  return json.data?.Media || null;
}

function showUI() {
  playerEl.classList.add('show-ui');
  clearTimeout(hideT);
  hideT = setTimeout(() => {
    if (playing && !anyPanelOpen()) {
      playerEl.classList.remove('show-ui');
    }
  }, 2800);
}

function anyPanelOpen() {
  return !!document.querySelector('.panel.open');
}

function fmt(time) {
  if (!Number.isFinite(time)) {
    return '0:00';
  }

  const h = Math.floor(time / 3600);
  const m = Math.floor((time % 3600) / 60);
  const s = Math.floor(time % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  return `${m}:${s.toString().padStart(2, '0')}`;
}

function setIcons(isPlaying) {
  const path = isPlaying
  ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
  : '<path d="M8,5v14l11-7L8,5z"/>';
  document.getElementById('play-icon').innerHTML = path;
  document.getElementById('center-icon').innerHTML = path;
}

function isStreamQuality(quality) {
  if (!quality) return false;
  const qualityText = `${quality.quality || ''}`.toLowerCase();
  const urlText = `${quality.url || ''}`.toLowerCase();
  return (
    qualityText.includes('hls') ||
    qualityText.includes('stream') ||
    /\.m3u8($|\?)/i.test(quality.url || '') ||
    /manifest|playlist/i.test(urlText)
  );
}

function updateDownloadButtonVisibility() {
  if (!downloadBtn) return;
  const shouldShow = !!currentQualityData && !isStreamQuality(currentQualityData);
  downloadBtn.style.display = shouldShow ? 'flex' : 'none';
}

function getCurrentDownloadUrl() {
  if (!currentQualityData?.url) return null;
  const directUrl = currentQualityData.url;
  return !streamData?.streams?.corsAllowed ? getProxyUrl(directUrl) : directUrl;
}

function doDownload(event) {
  if (event) event.stopPropagation();
  const downloadUrl = getCurrentDownloadUrl();
  if (!downloadUrl) return;

  const title = (streamData?.showTitle || 'video').replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '') || 'video';
  const qualityText = currentQuality || 'video';
  const anchor = document.createElement('a');
  anchor.href = downloadUrl;
  anchor.download = `${title} - ${qualityText}.mp4`;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function doCast(event) {
  if (event) event.stopPropagation();
  const sourceUrl = getCurrentDownloadUrl();
  if (!sourceUrl) return;

  const castUrl = new URL(window.location.href);
  castUrl.searchParams.set('cast', '1');
  castUrl.searchParams.set('src', sourceUrl);

  if (window.PresentationRequest && typeof window.PresentationRequest === 'function') {
    try {
      const request = new window.PresentationRequest([castUrl.toString()]);
      request.start().catch(() => {
        window.open(castUrl.toString(), '_blank', 'noopener,noreferrer,width=1200,height=800');
      });
      return;
    } catch {
      // fall back below
    }
  }

  const popup = window.open(castUrl.toString(), '_blank', 'noopener,noreferrer,width=1200,height=800');
  if (!popup) {
    window.location.href = castUrl.toString();
  }
}

function togPlay(event) {
  if (event) event.stopPropagation();
  playing = !playing;
  if (playing) {
    video.play().catch(() => {});
  } else {
    video.pause();
  }
  setIcons(playing);
  showUI();
}

playerEl.addEventListener('mousemove', showUI);
playerEl.addEventListener('mouseleave', () => {
  if (playing && !anyPanelOpen()) {
    playerEl.classList.remove('show-ui');
  }
});
playerEl.addEventListener('click', (e) => {
  if (e.target.closest('.cb,.cc-btn,.panel')) return;
  closePanels();
  const now = Date.now();
  if (now - lastTap < 280) {
    doFS();
    return;
  }
  lastTap = now;
  setTimeout(() => {
    if (Date.now() - lastTap >= 270) {
      togPlay();
    }
  }, 285);
});

video.addEventListener('loadedmetadata', () => {
  durTimeEl.textContent = fmt(video.duration);
  const saved = loadSavedState();
  if (saved) {
    if (saved.currentTime && video.duration > saved.currentTime) {
      video.currentTime = saved.currentTime;
    }
    if (saved.quality && currentQuality !== saved.quality) {
      const savedQuality = (streamData?.streams?.qualities || []).find((q) => q.quality === saved.quality);
      if (savedQuality) {
        selectQuality(savedQuality);
      }
    }
  }
  renderCaptionOverlay();
});

video.addEventListener('timeupdate', () => {
  if (!video.duration) return;
  const p = (video.currentTime / video.duration) * 100;
  pf.style.width = `${p}%`;
  pth.style.left = `${p}%`;
  curTimeEl.textContent = fmt(video.currentTime);
  queueSaveState();
  renderCaptionOverlay();
});

function seekTo(event) {
  const rect = pw.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  if (video.duration) {
    video.currentTime = ratio * video.duration;
  }
}

pw.addEventListener('mousedown', (event) => {
  drag = true;
  seekTo(event);
  event.stopPropagation();
});

document.addEventListener('mousemove', (event) => {
  if (drag) {
    seekTo(event);
  }
});

document.addEventListener('mouseup', () => {
  drag = false;
});
pw.addEventListener('click', (event) => event.stopPropagation());

video.volume = 1;

function togMute(event) {
  if (event) event.stopPropagation();
  video.muted = !video.muted;
  updateVolumeUI();
}

function setVol(value) {
  video.volume = Number(value) / 100;
  video.muted = video.volume === 0;
  updateVolumeUI();
}

function updateVolumeUI() {
  const muted = video.muted || video.volume === 0;
  document.getElementById('mute-x1').style.display = muted ? 'block' : 'none';
  document.getElementById('mute-x2').style.display = muted ? 'block' : 'none';
  document.getElementById('vol-wave1').style.display = muted ? 'none' : 'block';
  document.getElementById('vol-wave2').style.display = muted || video.volume < 0.5 ? 'none' : 'block';
}

function doSkip(amount, event) {
  if (event) event.stopPropagation();
  const nextTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + amount));
  video.currentTime = nextTime;
  const flash = document.getElementById(amount < 0 ? 'skl' : 'skr');
  flash.classList.remove('show');
  void flash.offsetWidth;
  flash.classList.add('show');
}

function doFS(event) {
  if (event) event.stopPropagation();
  if (!document.fullscreenElement) {
    playerEl.requestFullscreen().catch(() => {});
    document.getElementById('fs-icon').innerHTML = '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/>';
  } else {
    document.exitFullscreen();
    document.getElementById('fs-icon').innerHTML = '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>';
  }
}

function doPip(event) {
  if (event) event.stopPropagation();
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(() => {});
  } else {
    video.requestPictureInPicture().catch(() => {});
  }
}

function doNext(event) {
  if (event) event.stopPropagation();
}

function closePanels() {
  document.querySelectorAll('.panel').forEach((panel) => panel.classList.remove('open'));
}

function openPanel(id) {
  closePanels();
  document.getElementById(id).classList.add('open');
}

function togPanel(id, event) {
  event.stopPropagation();
  const panel = document.getElementById(id);
  const wasOpen = panel.classList.contains('open');
  closePanels();
  if (!wasOpen) {
    panel.classList.add('open');
  }
}

function pickRadio(el, valId, label, isLeaf, speedValue) {
  const parent = el.parentElement;
  if (!parent) return;
  parent.querySelectorAll('.rrow').forEach((row) => row.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById(valId).textContent = label;

  if (speedValue !== undefined) {
    video.playbackRate = speedValue;
  }

  if (isLeaf) {
    setTimeout(() => openPanel('settings-main'), 150);
  }
}

async function fetchStreamData() {
  const scrapeUrl = buildScrapeUrl();
  if (!scrapeUrl) {
    setLoaderText('Invalid route. Use /movie/:id/ or /tv/:id/:s/:e/');
    return;
  }

  showLoader('Fetching data...');

  try {
    let cached = loadCachedData();
    let data = cached?.data || null;

    if (!data) {
      const response = await fetch(scrapeUrl);
      if (!response.ok) {
        const text = await response.text();
        setLoaderText(`Sorry, this content is unavailible.`);
        showErrorIcon();
        return;
      }

      data = await response.json();
      if (data.error) {
        setLoaderText(`Sorry, this content is unavailible.`);
        showErrorIcon();
        return;
      }

      saveCachedData({ data, selectedQuality: null, selectedCaption: 'Off', savedAt: Date.now() });
      cached = loadCachedData();
    }

    if (routeParams.type === "anime") {
  const animeData = await fetchAnilistAnime(routeParams.id);
  setAnilistMetadata(animeData);
} else {
  const tmdbShow = await fetchTmdbShow();
  const tmdbEpisode = await fetchTmdbMetadata();

  setTmdbMetadata(tmdbShow, tmdbEpisode);
}

    const qualities = data.streams?.qualities || [];
    const captions = data.captions?.tracks || data.captions || [];

    if (!qualities.length) {
      setLoaderText('No playable stream qualities were found.');
      return;
    }

    renderQualityOptions(qualities);
    renderCaptionOptions(captions);
    setInitialMetadata(data);

    const savedState = loadSavedState();
    const savedQualityLabel = savedState?.quality || cached?.selectedQuality;
    const savedCaptionLabel = savedState?.caption || cached?.selectedCaption;

    const qualityRow = Array.from(qualityPanel.querySelectorAll('.rrow')).find((row) => row.dataset.quality === savedQualityLabel);
    const chosenQuality = qualities.find((q) => q.quality === savedQualityLabel) || qualities[qualities.length - 1];
    if (qualityRow) {
      pickRadio(qualityRow, 'qual-val', chosenQuality.quality, false);
    }
    selectQuality(chosenQuality);

    let chosenCaption = null;
    if (savedCaptionLabel && savedCaptionLabel !== 'Off') {
      chosenCaption = captions.find((c) => ((c.language || c.lang || c.label || '').toLowerCase() === savedCaptionLabel.toLowerCase()));
    }

    if (!chosenCaption) {
      chosenCaption = captions.find((c) => /(^|\s|-)en(glish)?(\s|$)/i.test((c.language || c.lang || c.label || '').toLowerCase()));
    }

    if (chosenCaption) {
      const desiredLabel = chosenCaption.language || chosenCaption.lang || chosenCaption.label || 'Unknown';
      const captionRow = Array.from(captionsPanel.querySelectorAll('.rrow')).find((row) => row.dataset.caption === desiredLabel);
      if (captionRow) {
        pickRadio(captionRow, 'cap-val', desiredLabel, false);
      }
      selectCaption(chosenCaption);
    } else {
      selectCaption(null);
    }
  } catch (error) {
    setLoaderText(`Stream error: ${error.message}`);
  }
}

function setLoaderText(text) {
  loaderText.textContent = text;
  loader.classList.remove('gone');
}

function showErrorIcon() {
  const spinner = document.querySelector('.spinner');
  const loaderText = document.querySelector('.loader-text');
  if (!spinner || !loaderText) return;

  // stop spinner animation class behavior
  spinner.classList.remove('spinner');
  spinner.classList.add('spinner-error');

  spinner.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" 
         stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="8" x2="12" y2="12"></line>
      <line x1="12" y1="16" x2="12.01" y2="16"></line>
    </svg>
  `;

  loaderText.innerHTML += '<br><p style="font-size:10px;font-weight:normal;text-transform:none;">Trying fallback in <span id="errorCountdown">5</span>...</p>';

  let c = 5, i = setInterval(() => {
  let el = document.getElementById("errorCountdown");
  if (el) el.textContent = c;
  if (c-- == 0) {
    clearInterval(i);
    window.location.href = "https://vidsrc-embed.ru/embed" + window.location.pathname;
  }
}, 1000);   

}

function updateCacheSelection() {
  const cached = loadCachedData();
  if (!cached) return;
  saveCachedData({
    ...cached,
    selectedQuality: currentQuality,
    selectedCaption: selectedCaptionLabel,
  });
}

function setInitialMetadata(data) {
  if (!titlePart.textContent || titlePart.textContent === 'Big Buck Bunny') {
    if (data.title) {
      titlePart.textContent = data.title;
      document.title = data.title;
    }
  }

  if (data.poster) {
    setLoaderPoster(data.poster);
  }
}

function clearOptionRows(panel) {
  panel.querySelectorAll('.rrow').forEach((row) => row.remove());
}

function renderQualityOptions(qualities) {
  clearOptionRows(qualityPanel);
  qualities.forEach((quality, index) => {
    const row = document.createElement('div');
    row.className = 'rrow';
    row.dataset.quality = quality.quality;
    row.innerHTML = `<div class="radio"><div class="radio-dot"></div></div>${quality.quality}`;
    row.addEventListener('click', () => {
      pickRadio(row, 'qual-val', quality.quality, true);
      selectQuality(quality);
    });
    if (index === qualities.length - 1) {
      row.classList.add('selected');
      qualVal.textContent = quality.quality;
    }
    qualityPanel.appendChild(row);
  });
}

function renderCaptionOptions(captions) {
  clearOptionRows(captionsPanel);

  const offRow = document.createElement('div');
  offRow.className = 'rrow selected';
  offRow.dataset.caption = 'Off';
  offRow.innerHTML = '<div class="radio"><div class="radio-dot"></div></div>Off';
  offRow.addEventListener('click', () => {
    pickRadio(offRow, 'cap-val', 'Off', true);
    selectCaption(null);
  });
  captionsPanel.appendChild(offRow);

  captions.forEach((caption) => {
    const label = caption.language || caption.lang || caption.label || 'Unknown';
    const row = document.createElement('div');
    row.className = 'rrow';
    row.dataset.caption = label;
    row.innerHTML = `<div class="radio"><div class="radio-dot"></div></div>${label}`;
    row.addEventListener('click', () => {
      pickRadio(row, 'cap-val', label, true);
      selectCaption({ language: caption.language, lang: caption.lang, label, url: caption.url });
    });
    captionsPanel.appendChild(row);
  });
}

function selectQuality(quality) {
  if (!quality || !quality.url) return;

  currentQuality = quality?.quality || null;
  currentQualityData = quality || null;
  updateDownloadButtonVisibility();
  updateCacheSelection();
  const isStream = isStreamQuality(quality);
  if (isStream) {
    downloadBtn.style.display = 'none';
  } else {
    downloadBtn.style.display = 'flex';
  }

  const currentTime = video.currentTime || 0;
  const wasPlaying = playing || playerOptions.autoplay;

  const directUrl = quality.url;
  const chosenUrl = isStream ? getProxyUrl(directUrl) : directUrl;

  // IMPORTANT: kill old listeners (prevents stacking bugs)
  video.onloadedmetadata = null;
  video.onerror = null;

  video.pause();

  // load new source
  video.src = chosenUrl;
  video.load();

  let resumed = false;

  const resume = () => {
    if (resumed) return;
    resumed = true;

    const seekTo = playerOptions.startAt > 0 ? playerOptions.startAt : currentTime;
    if (video.seekable?.length && seekTo) {
      try {
        video.currentTime = seekTo;
      } catch {}
    }

    if (wasPlaying) {
      video.play().catch(() => {});
    }

    hideLoader();
  };

  video.addEventListener('loadedmetadata', resume, { once: true });

  video.onerror = () => {
    if (!shouldProxy) {
      // retry with proxy
      video.src = getProxyUrl(directUrl);
      video.load();
      video.addEventListener('loadedmetadata', resume, { once: true });
      return;
    }

    if (playerOptions.fallbackUrl) {
      window.location.replace(playerOptions.fallbackUrl);
      return;
    }

    setLoaderText('Sorry... this content is unavailible at the moment.');
  };
}

function parseCueTime(value) {
  const cleaned = value.trim().replace(',', '.');
  const match = cleaned.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (!match) {
    return 0;
  }
  const [, hours = '0', minutes = '0', seconds = '0'] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

function parseVtt(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const cues = [];
  let index = 0;

  while (index < lines.length) {
    let line = lines[index].trim();
    if (!line || line.startsWith('WEBVTT')) {
      index += 1;
      continue;
    }

    if (/^\d+$/.test(line)) {
      index += 1;
      line = lines[index]?.trim() || '';
    }

    const timing = line.match(/^(\d{2}:\d{2}(?::\d{2}(?:[\.,]\d+)?)?)\s*-->\s*(\d{2}:\d{2}(?::\d{2}(?:[\.,]\d+)?)?)(?:\s|$)/);
    if (timing) {
      const start = parseCueTime(timing[1]);
      const end = parseCueTime(timing[2]);
      index += 1;
      const textLines = [];
      while (index < lines.length && lines[index].trim()) {
        textLines.push(lines[index]);
        index += 1;
      }
      cues.push({ start, end, text: textLines.join('\n') });
    } else {
      index += 1;
    }
  }

  return cues;
}

function parseSrt(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const cues = [];
  let index = 0;

  while (index < lines.length) {
    let line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    if (/^\d+$/.test(line)) {
      index += 1;
      line = lines[index]?.trim() || '';
    }

    const timing = line.match(/^(\d{2}:\d{2}:\d{2}[\.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[\.,]\d{3})(?:\s|$)/);
    if (timing) {
      const start = parseCueTime(timing[1]);
      const end = parseCueTime(timing[2]);
      index += 1;
      const textLines = [];
      while (index < lines.length && lines[index].trim()) {
        textLines.push(lines[index]);
        index += 1;
      }
      cues.push({ start, end, text: textLines.join('\n') });
    } else {
      index += 1;
    }
  }

  return cues;
}

function renderCaptionOverlay() {
  if (!captionCues.length) {
    captionOverlay.textContent = '';
    captionOverlay.classList.remove('visible');
    return;
  }

  const time = video.currentTime;
  const cue = captionCues.find((item) => time >= item.start && time <= item.end);
  if (cue) {
    captionOverlay.innerHTML = cue.text.replace(/\n/g, '<br>');
    captionOverlay.classList.add('visible');
  } else {
    captionOverlay.textContent = '';
    captionOverlay.classList.remove('visible');
  }
}

function selectCaption(caption) {
  const label = caption?.label || caption?.language || caption?.lang || null;
  currentCaption = label;
  selectedCaptionLabel = label || 'Off';
  capVal.textContent = selectedCaptionLabel;

  if (!caption || !caption.url) {
    captionCues = [];
    renderCaptionOverlay();
    updateCacheSelection();
    return;
  }

  fetch(getProxyUrl(caption.url))
  .then((response) => response.text())
  .then((text) => {
    const isSrtText = /-->\s*\d{2}:\d{2}:\d{2}[\.,]\d{3}/.test(text);
    const isVttText = /^\s*WEBVTT/m.test(text) || /-->\s*\d{2}:\d{2}(?::\d{2})?\.\d{3}/.test(text);

    if (isSrtText && !isVttText) {
      captionCues = parseSrt(text);
    } else {
      captionCues = parseVtt(text);
      if (!captionCues.length && isSrtText) {
        captionCues = parseSrt(text);
      }
    }

    renderCaptionOverlay();
    updateCacheSelection();
  })
  .catch(() => {
    captionCues = [];
    renderCaptionOverlay();
    updateCacheSelection();
  });
}

function initialize() {
  parseRouteParams();
  playerOptions = parsePlayerOptions();
  applyPlayerOptions(playerOptions);
  document.addEventListener('contextmenu', (event) => event.preventDefault());
  fetchStreamData();
  showUI();
}

document.querySelectorAll('.panel').forEach((panel) => panel.addEventListener('click', (event) => event.stopPropagation()));

document.addEventListener('keydown', (event) => {
  if (['INPUT', 'TEXTAREA'].includes(event.target.tagName)) return;
  if (event.code === 'Space') {
    event.preventDefault();
    togPlay();
  }
  if (event.code === 'ArrowLeft') {
    doSkip(-5, null);
  }
  if (event.code === 'ArrowRight') {
    doSkip(5, null);
  }
  if (event.code === 'KeyF') {
    doFS();
  }
  if (event.code === 'KeyM') {
    togMute({ stopPropagation: () => {} });
  }
  if (event.code === 'ArrowUp') {
    video.volume = Math.min(1, video.volume + 0.1);
    document.getElementById('vol-slider').value = String(video.volume * 100);
    updateVolumeUI();
  }
  if (event.code === 'ArrowDown') {
    video.volume = Math.max(0, video.volume - 0.1);
    document.getElementById('vol-slider').value = String(video.volume * 100);
    updateVolumeUI();
  }
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.panel,.cb')) {
    closePanels();
  }
});

initialize();
