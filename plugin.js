/// <reference path="./kino.d.ts" />
// JuanIPTV — plugin Kino para iptv-factory.com (Xtream Codes API)
// language: JavaScript ES2020, target: Kino apiVersion 6, QuickJS
// v1.1.0 — logging con kino.log en todas las funciones exportadas

// ─────────────────────────────────────────────────────────────────────────────
// Config helpers
// ─────────────────────────────────────────────────────────────────────────────

function getServer() { return (kino.config.get("server") || "").replace(/\/+$/, ""); }
function getUser()   { return kino.config.get("username") || ""; }
function getPass()   { return kino.config.get("password") || ""; }
function getFmt()    { return kino.config.get("streamFmt") || "m3u8"; }
function getPage()   { return parseInt(kino.config.get("pageSize") || "60", 10); }

// ─────────────────────────────────────────────────────────────────────────────
// Xtream Codes API helper
// ─────────────────────────────────────────────────────────────────────────────

async function apiCall(params) {
  const server = getServer();
  const user   = getUser();
  const pass   = getPass();
  if (!server || !user || !pass) {
    kino.log("JP:api missing_config server=" + !!server + " user=" + !!user + " pass=" + !!pass);
    throw kino.error("auth_required", "falta configuracion");
  }
  const base = { username: user, password: pass };
  const merged = Object.assign({}, base, params);
  const qs = Object.keys(merged)
    .map(function(k) { return encodeURIComponent(k) + "=" + encodeURIComponent(merged[k]); })
    .join("&");
  const url = server + "/player_api.php?" + qs;
  kino.log("JP:api action=" + (params.action || "?"));
  const r = await kino.fetch(url);
  if (!r.ok) {
    kino.log("JP:api http_err status=" + r.status + " action=" + (params.action || "?"));
    throw kino.error("unavailable", "HTTP " + r.status);
  }
  kino.log("JP:api ok action=" + (params.action || "?") + " status=" + r.status);
  return r.json();
}

// Build stream URL: <server>/<type>/<user>/<pass>/<id>.<ext>
function streamUrl(type, id, ext) {
  return getServer() + "/" + type + "/" + getUser() + "/" + getPass() + "/" + id + "." + ext;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-module runtime cache (persists for the lifetime of the sandbox session)
// ─────────────────────────────────────────────────────────────────────────────

var _cache = {};
async function cached(key, ttlMs, fn) {
  var entry = _cache[key];
  if (entry && (Date.now() - entry.ts) < ttlMs) {
    kino.log("JP:cache hit key=" + key);
    return entry.val;
  }
  kino.log("JP:cache miss key=" + key);
  var val = await fn();
  _cache[key] = { val: val, ts: Date.now() };
  return val;
}

var TTL_LIVE = 5  * 60 * 1000;   // 5 min
var TTL_VOD  = 15 * 60 * 1000;   // 15 min

// ─────────────────────────────────────────────────────────────────────────────
// Cached API fetches
// ─────────────────────────────────────────────────────────────────────────────

async function getLiveCats() {
  return cached("live_cats", TTL_LIVE, async function() {
    var d = await apiCall({ action: "get_live_categories" });
    return Array.isArray(d) ? d : [];
  });
}
async function getVodCats() {
  return cached("vod_cats", TTL_VOD, async function() {
    var d = await apiCall({ action: "get_vod_categories" });
    return Array.isArray(d) ? d : [];
  });
}
async function getSerCats() {
  return cached("ser_cats", TTL_VOD, async function() {
    var d = await apiCall({ action: "get_series_categories" });
    return Array.isArray(d) ? d : [];
  });
}
async function getLiveStreams(catId) {
  return cached("live_" + catId, TTL_LIVE, async function() {
    var d = await apiCall({ action: "get_live_streams", category_id: catId });
    return Array.isArray(d) ? d : [];
  });
}
async function getVodStreams(catId) {
  return cached("vod_" + catId, TTL_VOD, async function() {
    var d = await apiCall({ action: "get_vod_streams", category_id: catId });
    return Array.isArray(d) ? d : [];
  });
}
async function getSerStreams(catId) {
  return cached("ser_" + catId, TTL_VOD, async function() {
    var d = await apiCall({ action: "get_series", category_id: catId });
    return Array.isArray(d) ? d : [];
  });
}
async function getAllVod() {
  return cached("all_vod", TTL_VOD, async function() {
    var d = await apiCall({ action: "get_vod_streams" });
    return Array.isArray(d) ? d : [];
  });
}
async function getAllSer() {
  return cached("all_ser", TTL_VOD, async function() {
    var d = await apiCall({ action: "get_series" });
    return Array.isArray(d) ? d : [];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Item converters
// ─────────────────────────────────────────────────────────────────────────────

// Kino id: ^[A-Za-z0-9._~-]{1,128}$
function safeId(prefix, raw) {
  return (prefix + "-" + String(raw).replace(/[^A-Za-z0-9._~-]/g, "-")).slice(0, 128);
}

function clampRating(r) {
  var n = parseFloat(r);
  if (isNaN(n)) return undefined;
  return Math.min(10, Math.max(0, n));
}

function vodToItem(v) {
  return {
    id:       safeId("v", v.stream_id),
    ref:      "vod:" + v.stream_id + ":" + (v.container_extension || "mkv"),
    title:    String(v.name || v.stream_id).slice(0, 200),
    kind:     "movie",
    poster:   v.stream_icon || undefined,
    year:     v.year ? String(v.year).slice(0, 10) : undefined,
    overview: v.plot ? String(v.plot).slice(0, 2000) : undefined,
    rating:   clampRating(v.rating),
    genres:   v.genre ? [String(v.genre).slice(0, 30)] : undefined,
  };
}

function seriesToItem(s) {
  return {
    id:       safeId("s", s.series_id),
    ref:      "ser:" + s.series_id,
    title:    String(s.name || s.series_id).slice(0, 200),
    kind:     "series",
    poster:   s.cover || s.stream_icon || undefined,
    year:     s.year ? String(s.year).slice(0, 10) : undefined,
    overview: s.plot ? String(s.plot).slice(0, 2000) : undefined,
    rating:   clampRating(s.rating),
    genres:   s.genre ? [String(s.genre).slice(0, 30)] : undefined,
  };
}

function liveToItem(ch) {
  return {
    id:     safeId("l", ch.stream_id),
    ref:    "live:" + ch.stream_id,
    title:  String(ch.name || ch.stream_id).slice(0, 200),
    kind:   "live",
    poster: ch.stream_icon || undefined,
  };
}

// Map category name to Kino genre
function genreForName(name) {
  var n = (name || "").toLowerCase();
  if (/sport|deport|futbol|football|soccer|f1|nba|nfl|ufc|lucha/.test(n)) return "deportes";
  if (/noticias|news|cnn|bbc news|telediario/.test(n))                      return "noticias";
  if (/infant|kids|kid|ni.os|cartoon|dibujo/.test(n))                       return "infantil";
  if (/docu/.test(n))                                                        return "documentales";
  if (/music|radio|musica/.test(n))                                          return "musica";
  if (/anime/.test(n))                                                       return "anime";
  return "entretenimiento";
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS: status, validation, actions
// ─────────────────────────────────────────────────────────────────────────────

export async function settingsStatus() {
  try {
    var saved = await kino.storage.get("connStatus");
    kino.log("JP:settingsStatus val=" + (saved || "none"));
    return { connStatus: saved || "Sin verificar" };
  } catch (e) {
    kino.log("JP:settingsStatus err", e.message);
    return { connStatus: "Sin verificar" };
  }
}

export async function validateSettings(s) {
  kino.log("JP:validate keys=" + Object.keys(s).join(","));
  if (!s.server)   { kino.log("JP:validate missing=server");   return { error: "server",   message: "Escribe la URL del servidor" }; }
  if (!s.username) { kino.log("JP:validate missing=username"); return { error: "username",  message: "Escribe tu usuario" }; }
  if (!s.password) { kino.log("JP:validate missing=password"); return { error: "password",  message: "Escribe tu contrasena" }; }
  kino.log("JP:validate ok");
  return null;
}

export async function action(key) {
  if (key === "testConn") {
    kino.log("JP:action testConn start");
    try {
      var d = await apiCall({ action: "get_live_categories" });
      if (!Array.isArray(d)) {
        kino.log("JP:action testConn invalid_response type=" + typeof d);
        throw new Error("respuesta invalida");
      }
      kino.log("JP:action testConn ok cats=" + d.length);
      await kino.storage.set("connStatus", "Conectado correctamente");
      return {
        message: "Conexion exitosa con el servidor",
        status:  { connStatus: "Conectado correctamente" },
      };
    } catch (e) {
      kino.log("JP:action testConn fail code=" + (e.code || "?") + " msg=" + String(e.message).slice(0, 80));
      await kino.storage.set("connStatus", "Sin conexion");
      return {
        message: "No se pudo conectar al servidor",
        status:  { connStatus: "Sin conexion — verifica los datos" },
      };
    }
  }
  kino.log("JP:action unknown key=" + key);
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION — sección propia con pestañas En Vivo / Películas / Series
// ─────────────────────────────────────────────────────────────────────────────

export async function section({ tab }) {
  kino.log("JP:section start tab=" + (tab || "none"));
  var tabs = [
    { id: "live",      label: "En Vivo" },
    { id: "peliculas", label: "Peliculas" },
    { id: "series",    label: "Series" },
  ];
  var chosen = tabs.some(function(t) { return t.id === tab; }) ? tab : "live";
  var rows = await buildSectionRows(chosen);
  kino.log("JP:section done tab=" + chosen + " rows=" + rows.length);
  return { tabs: tabs, tab: chosen, rows: rows };
}

async function buildSectionRows(tab) {
  var ps = getPage();
  var rows = [];

  if (tab === "live") {
    var liveCats = await getLiveCats();
    kino.log("JP:sect-live cats=" + liveCats.length);
    for (var i = 0; i < Math.min(liveCats.length, 12); i++) {
      var cat = liveCats[i];
      try {
        var chs = await getLiveStreams(cat.category_id);
        if (!chs.length) continue;
        rows.push({
          id:    "sl-" + cat.category_id,
          title: cat.category_name,
          ref:   "live-cat:" + cat.category_id,
          genre: genreForName(cat.category_name),
          items: chs.slice(0, ps).map(liveToItem),
        });
        if (rows.length >= 8) break;
      } catch (e) {
        kino.log("JP:sect-live err catId=" + cat.category_id + " code=" + (e.code || "?"));
      }
    }
    kino.log("JP:sect-live done rows=" + rows.length);
    return rows;
  }

  if (tab === "peliculas") {
    var vodCats = await getVodCats();
    kino.log("JP:sect-peliculas cats=" + vodCats.length);
    for (var i = 0; i < Math.min(vodCats.length, 10); i++) {
      var cat = vodCats[i];
      try {
        var vs = await getVodStreams(cat.category_id);
        if (!vs.length) continue;
        rows.push({
          id:    "sp-" + cat.category_id,
          title: cat.category_name,
          ref:   "vod-cat:" + cat.category_id,
          genre: "peliculas",
          items: vs.slice(0, ps).map(vodToItem),
        });
        if (rows.length >= 8) break;
      } catch (e) {
        kino.log("JP:sect-peliculas err catId=" + cat.category_id + " code=" + (e.code || "?"));
      }
    }
    kino.log("JP:sect-peliculas done rows=" + rows.length);
    return rows;
  }

  if (tab === "series") {
    var serCats = await getSerCats();
    kino.log("JP:sect-series cats=" + serCats.length);
    for (var i = 0; i < Math.min(serCats.length, 10); i++) {
      var cat = serCats[i];
      try {
        var ss = await getSerStreams(cat.category_id);
        if (!ss.length) continue;
        rows.push({
          id:    "ss-" + cat.category_id,
          title: cat.category_name,
          ref:   "ser-cat:" + cat.category_id,
          genre: "series",
          items: ss.slice(0, ps).map(seriesToItem),
        });
        if (rows.length >= 8) break;
      } catch (e) {
        kino.log("JP:sect-series err catId=" + cat.category_id + " code=" + (e.code || "?"));
      }
    }
    kino.log("JP:sect-series done rows=" + rows.length);
    return rows;
  }

  kino.log("JP:sect unknown tab=" + tab);
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORIES — mosaicos en la sección Categorías de Kino
// ─────────────────────────────────────────────────────────────────────────────

export async function categories() {
  kino.log("JP:categories start");
  var vodCats, serCats;
  try { vodCats = await getVodCats(); } catch(e) { vodCats = []; kino.log("JP:categories err_vod code=" + (e.code || "?")); }
  try { serCats = await getSerCats(); } catch(e) { serCats = []; kino.log("JP:categories err_ser code=" + (e.code || "?")); }

  var result = [];
  var i;
  for (i = 0; i < Math.min(vodCats.length, 12); i++) {
    var c = vodCats[i];
    result.push({
      id:    "vc-" + c.category_id,
      title: String(c.category_name).slice(0, 40),
      ref:   "vod-cat:" + c.category_id,
    });
  }
  for (i = 0; i < Math.min(serCats.length, 12); i++) {
    var c = serCats[i];
    result.push({
      id:    "sc-" + c.category_id,
      title: (String(c.category_name) + " (Series)").slice(0, 40),
      ref:   "ser-cat:" + c.category_id,
    });
  }
  var final = result.slice(0, 24);
  kino.log("JP:categories done n=" + final.length + " vod=" + Math.min(vodCats.length, 12) + " ser=" + Math.min(serCats.length, 12));
  return final;
}

// ─────────────────────────────────────────────────────────────────────────────
// HOME — filas del Inicio
// ─────────────────────────────────────────────────────────────────────────────

export async function home() {
  kino.log("JP:home start");
  var ps = getPage();
  var rows = [];
  var liveCats = [], vodCats = [], serCats = [];

  try { liveCats = await getLiveCats(); } catch(e) { kino.log("JP:home err_liveCats code=" + (e.code || "?")); }
  try { vodCats  = await getVodCats();  } catch(e) { kino.log("JP:home err_vodCats code="  + (e.code || "?")); }
  try { serCats  = await getSerCats();  } catch(e) { kino.log("JP:home err_serCats code="  + (e.code || "?")); }
  kino.log("JP:home cats live=" + liveCats.length + " vod=" + vodCats.length + " ser=" + serCats.length);

  // Fila 1: canales en vivo del primer grupo
  if (liveCats.length) {
    try {
      var chs = await getLiveStreams(liveCats[0].category_id);
      if (chs.length) {
        rows.push({
          id:    "home-live-top",
          title: "Canales en Vivo",
          ref:   "live-cat:" + liveCats[0].category_id,
          genre: "entretenimiento",
          items: chs.slice(0, ps).map(liveToItem),
        });
        kino.log("JP:home row_live_top ch=" + chs.length);
      }
    } catch(e) { kino.log("JP:home err_live_top code=" + (e.code || "?")); }
  }

  // Fila 2: películas destacadas
  if (vodCats.length) {
    try {
      var vs = await getVodStreams(vodCats[0].category_id);
      if (vs.length) {
        rows.push({
          id:    "home-vod-top",
          title: "Peliculas Destacadas",
          ref:   "vod-cat:" + vodCats[0].category_id,
          genre: "peliculas",
          items: vs.slice(0, ps).map(vodToItem),
        });
        kino.log("JP:home row_vod_top items=" + vs.length);
      }
    } catch(e) { kino.log("JP:home err_vod_top code=" + (e.code || "?")); }
  }

  // Fila 3: series destacadas
  if (serCats.length) {
    try {
      var ss = await getSerStreams(serCats[0].category_id);
      if (ss.length) {
        rows.push({
          id:    "home-ser-top",
          title: "Series Destacadas",
          ref:   "ser-cat:" + serCats[0].category_id,
          genre: "series",
          items: ss.slice(0, ps).map(seriesToItem),
        });
        kino.log("JP:home row_ser_top items=" + ss.length);
      }
    } catch(e) { kino.log("JP:home err_ser_top code=" + (e.code || "?")); }
  }

  // Más categorías de canales en vivo
  var i;
  for (i = 1; i < Math.min(liveCats.length, 4); i++) {
    if (rows.length >= 20) break;
    try {
      var cat = liveCats[i];
      var chs = await getLiveStreams(cat.category_id);
      if (!chs.length) continue;
      rows.push({
        id:    "home-live-" + cat.category_id,
        title: cat.category_name,
        ref:   "live-cat:" + cat.category_id,
        genre: genreForName(cat.category_name),
        items: chs.slice(0, ps).map(liveToItem),
      });
    } catch(e) { kino.log("JP:home err_extra_live i=" + i + " code=" + (e.code || "?")); }
  }

  // Más categorías de películas
  for (i = 1; i < Math.min(vodCats.length, 6); i++) {
    if (rows.length >= 20) break;
    try {
      var cat = vodCats[i];
      var vs = await getVodStreams(cat.category_id);
      if (!vs.length) continue;
      rows.push({
        id:    "home-vod-" + cat.category_id,
        title: cat.category_name,
        ref:   "vod-cat:" + cat.category_id,
        genre: "peliculas",
        items: vs.slice(0, ps).map(vodToItem),
      });
    } catch(e) { kino.log("JP:home err_extra_vod i=" + i + " code=" + (e.code || "?")); }
  }

  // Más categorías de series
  for (i = 1; i < Math.min(serCats.length, 6); i++) {
    if (rows.length >= 20) break;
    try {
      var cat = serCats[i];
      var ss = await getSerStreams(cat.category_id);
      if (!ss.length) continue;
      rows.push({
        id:    "home-ser-" + cat.category_id,
        title: cat.category_name,
        ref:   "ser-cat:" + cat.category_id,
        genre: "series",
        items: ss.slice(0, ps).map(seriesToItem),
      });
    } catch(e) { kino.log("JP:home err_extra_ser i=" + i + " code=" + (e.code || "?")); }
  }

  var final = rows.slice(0, 20);
  kino.log("JP:home done rows=" + final.length);
  return final;
}

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH — búsqueda global y búsqueda dentro de un "Ver más" (scopedSearch)
// ─────────────────────────────────────────────────────────────────────────────

export async function search(query) {
  var q      = ((query.q || "").toLowerCase().trim());
  var type   = query.type || "any";
  var within = query.within;
  var cursor = query.cursor;

  kino.log("JP:search type=" + type + " q_len=" + q.length + " within=" + (within || "none"));

  // scopedSearch — filtrar dentro de un browse
  if (within) {
    kino.log("JP:search scoped ref=" + within + " cursor=" + (cursor || "start"));
    var page     = await doBrowse(within, cursor);
    var filtered = page.items.filter(function(item) {
      return (item.title || "").toLowerCase().indexOf(q) !== -1;
    });
    kino.log("JP:search scoped total=" + page.items.length + " matched=" + filtered.length);
    return { items: filtered, next: page.next };
  }

  if (!q) {
    kino.log("JP:search empty_q");
    return [];
  }

  var results = [];

  if (type !== "series") {
    try {
      var allVod = await getAllVod();
      var matched = allVod.filter(function(v) {
        return (v.name || "").toLowerCase().indexOf(q) !== -1;
      });
      kino.log("JP:search vod catalog=" + allVod.length + " matched=" + Math.min(matched.length, 50));
      for (var i = 0; i < Math.min(matched.length, 50); i++) {
        results.push(vodToItem(matched[i]));
      }
    } catch(e) { kino.log("JP:search err_vod code=" + (e.code || "?")); }
  }

  if (type !== "movie") {
    try {
      var allSer = await getAllSer();
      var matched = allSer.filter(function(s) {
        return (s.name || "").toLowerCase().indexOf(q) !== -1;
      });
      kino.log("JP:search ser catalog=" + allSer.length + " matched=" + Math.min(matched.length, 50));
      for (var i = 0; i < Math.min(matched.length, 50); i++) {
        results.push(seriesToItem(matched[i]));
      }
    } catch(e) { kino.log("JP:search err_ser code=" + (e.code || "?")); }
  }

  var final = results.slice(0, 100);
  kino.log("JP:search done results=" + final.length);
  return final;
}

// ─────────────────────────────────────────────────────────────────────────────
// BROWSE — paginación de filas ("Ver más")
// ─────────────────────────────────────────────────────────────────────────────

export async function browse(ref, cursor) {
  kino.log("JP:browse ref=" + ref + " cursor=" + (cursor || "start"));
  return doBrowse(ref, cursor);
}

async function doBrowse(ref, cursor) {
  var ps     = getPage();
  var offset = cursor ? parseInt(cursor, 10) : 0;
  var all    = [];
  var mapper;

  if (ref.indexOf("live-cat:") === 0) {
    all    = await getLiveStreams(ref.slice(9));
    mapper = liveToItem;
  } else if (ref.indexOf("vod-cat:") === 0) {
    all    = await getVodStreams(ref.slice(8));
    mapper = vodToItem;
  } else if (ref.indexOf("ser-cat:") === 0) {
    all    = await getSerStreams(ref.slice(8));
    mapper = seriesToItem;
  } else {
    kino.log("JP:browse unknown_ref=" + ref);
    return { items: [] };
  }

  var slice = all.slice(offset, offset + ps);
  var items = slice.map(mapper);
  var next  = (offset + ps < all.length) ? String(offset + ps) : undefined;
  kino.log("JP:browse total=" + all.length + " offset=" + offset + " items=" + items.length + " hasNext=" + !!next);
  return { items: items, next: next };
}

// ─────────────────────────────────────────────────────────────────────────────
// EPISODES — temporadas y episodios de una serie
// ─────────────────────────────────────────────────────────────────────────────

export async function episodes(ref) {
  if (ref.indexOf("ser:") !== 0) {
    kino.log("JP:episodes invalid_ref=" + ref.slice(0, 40));
    throw kino.error("not_found", "ref invalido para series");
  }
  var seriesId = ref.slice(4);
  kino.log("JP:episodes start seriesId=" + seriesId);

  var data = await cached("series_info_" + seriesId, TTL_VOD, async function() {
    return apiCall({ action: "get_series_info", series_id: seriesId });
  });

  if (!data || !data.episodes) {
    kino.log("JP:episodes no_episodes seriesId=" + seriesId);
    throw kino.error("not_found", "serie sin episodios");
  }

  // Información general de la serie
  var info = data.info || {};
  var seriesInfo = {
    title:    info.name    ? String(info.name).slice(0, 200) : undefined,
    poster:   info.cover   || undefined,
    backdrop: Array.isArray(info.backdrop_path) ? info.backdrop_path[0] : undefined,
    overview: info.plot    ? String(info.plot).slice(0, 2000) : undefined,
    year:     info.releaseDate ? String(info.releaseDate).slice(0, 4) : undefined,
    rating:   clampRating(info.rating),
    genres:   info.genre   ? [String(info.genre).slice(0, 30)] : undefined,
  };

  // Episodios: data.episodes es { "1": [...], "2": [...], ... }
  var eps = [];
  var epsBySeason = data.episodes;
  var seasonNums = Object.keys(epsBySeason)
    .map(function(k) { return parseInt(k, 10); })
    .filter(function(n) { return !isNaN(n) && n >= 1; })
    .sort(function(a, b) { return a - b; });

  for (var si = 0; si < seasonNums.length; si++) {
    var sNum     = seasonNums[si];
    var seasonEps = epsBySeason[String(sNum)] || [];
    for (var ei = 0; ei < seasonEps.length; ei++) {
      var ep    = seasonEps[ei];
      var epNum = parseInt(ep.episode_num, 10) || parseInt(ep.id, 10);
      if (!epNum || epNum < 1) continue;
      var epInfo = ep.info || {};
      eps.push({
        season:          sNum,
        number:          epNum,
        ref:             "ep:" + ep.id + ":" + (ep.container_extension || "mkv"),
        title:           ep.title ? String(ep.title).slice(0, 200) : undefined,
        still:           epInfo.movie_image || undefined,
        overview:        epInfo.plot ? String(epInfo.plot).slice(0, 2000) : undefined,
        airDate:         epInfo.air_date || undefined,
        runtimeMinutes:  epInfo.duration_secs
          ? Math.round(parseInt(epInfo.duration_secs, 10) / 60) : undefined,
      });
    }
  }

  // Lista de temporadas para el selector
  var seasons = seasonNums.map(function(n) {
    return {
      id:     seriesId + "-s" + n,
      ref:    "ser:" + seriesId,
      title:  "Temporada " + n,
      number: n,
    };
  });

  kino.log("JP:episodes done seriesId=" + seriesId + " seasons=" + seasons.length + " eps=" + eps.length);
  return { series: seriesInfo, episodes: eps, seasons: seasons };
}

// ─────────────────────────────────────────────────────────────────────────────
// RESOLVE — devuelve la URL de reproducción
// ─────────────────────────────────────────────────────────────────────────────

export async function resolve(ref) {
  var fmt = getFmt();
  kino.log("JP:resolve start ref=" + ref.slice(0, 40) + " fmt=" + fmt);

  // Canal en vivo
  if (ref.indexOf("live:") === 0) {
    var id = ref.slice(5);
    kino.log("JP:resolve live id=" + id);
    return {
      url:   streamUrl("live", id, fmt),
      label: "En Vivo",
    };
  }

  // Película (VOD)
  if (ref.indexOf("vod:") === 0) {
    var parts = ref.slice(4).split(":");
    var id    = parts[0];
    var ext   = parts[1] || "mkv";
    kino.log("JP:resolve vod id=" + id + " ext=" + ext);
    var primary = streamUrl("movie", id, ext);
    var alts = [];
    if (ext !== "mp4") alts.push({ url: streamUrl("movie", id, "mp4"), label: "MP4" });
    if (ext !== "mkv") alts.push({ url: streamUrl("movie", id, "mkv"), label: "MKV" });
    if (ext !== "ts")  alts.push({ url: streamUrl("movie", id, "ts"),  label: "TS"  });
    return {
      url:          primary,
      label:        ext.toUpperCase(),
      alternatives: alts.slice(0, 8),
    };
  }

  // Episodio de serie
  if (ref.indexOf("ep:") === 0) {
    var parts = ref.slice(3).split(":");
    var id    = parts[0];
    var ext   = parts[1] || "mkv";
    kino.log("JP:resolve ep id=" + id + " ext=" + ext);
    var primary = streamUrl("series", id, ext);
    var alts = [];
    if (ext !== "mp4") alts.push({ url: streamUrl("series", id, "mp4"), label: "MP4" });
    if (ext !== "mkv") alts.push({ url: streamUrl("series", id, "mkv"), label: "MKV" });
    if (ext !== "ts")  alts.push({ url: streamUrl("series", id, "ts"),  label: "TS"  });
    return {
      url:          primary,
      label:        ext.toUpperCase(),
      alternatives: alts.slice(0, 8),
    };
  }

  kino.log("JP:resolve unknown_ref=" + ref.slice(0, 40));
  throw kino.error("not_found", "ref desconocido: " + ref);
}

// ─────────────────────────────────────────────────────────────────────────────
// LIVE CHANNELS — pestaña "En vivo" nativa de Kino (capacidad channels)
// ─────────────────────────────────────────────────────────────────────────────

export async function liveCategories() {
  kino.log("JP:liveCategories start");
  var cats = await getLiveCats();
  kino.log("JP:liveCategories done n=" + cats.length);
  return cats.map(function(c) {
    return {
      id:    String(c.category_id),
      name:  String(c.category_name),
      genre: genreForName(c.category_name),
    };
  });
}

export async function liveChannels({ categoryId, cursor }) {
  var ps     = getPage();
  var offset = cursor ? parseInt(cursor, 10) : 0;
  kino.log("JP:liveChannels start catId=" + categoryId + " offset=" + offset);
  var all    = await getLiveStreams(categoryId);
  var slice  = all.slice(offset, offset + ps);
  var items  = slice.map(function(ch) {
    return {
      id:         safeId("lc", ch.stream_id),
      ref:        "live:" + ch.stream_id,
      name:       String(ch.name || ch.stream_id).slice(0, 200),
      logo:       ch.stream_icon || undefined,
      number:     ch.num ? parseInt(ch.num, 10) : undefined,
      categoryId: String(ch.category_id || categoryId),
    };
  });
  var next = (offset + ps < all.length) ? String(offset + ps) : undefined;
  kino.log("JP:liveChannels done total=" + all.length + " items=" + items.length + " hasNext=" + !!next);
  return { items: items, next: next };
}
