  (function () {
  'use strict';

  const PEOPLE_JSON_URL = 'https://raw.githubusercontent.com/SomeoneOfficial/LichessTrophy/refs/heads/main/People.json';
  const TEAMS_JSON_URL = 'https://raw.githubusercontent.com/SomeoneOfficial/LichessTrophy/refs/heads/main/Teams.json';
  const VERSION_URL = 'https://raw.githubusercontent.com/SomeoneOfficial/LichessTrophy/refs/heads/main/Version';
  const REPO_URL = 'https://github.com/SomeoneOfficial/LichessTrophy';
  const DEFAULT_TROPHY_CONTENT = '\uE05E';
  const INSTALLED_VERSION = chrome.runtime.getManifest().version;

  const DEFAULT_SETTINGS = {
    enabled: true,
    changeTitle: true,
    changeDisplayName: true,
    showBadge: true,
    showFlair: true,
    showTrophy: true,
    showGlow: false,
    glowIntensity: 8,
    glowColor: '#ffd54a'
  };

  let players = [];
  let teams = [];
  let injectScheduled = false;
  let settings = { ...DEFAULT_SETTINGS };
  let panelRoot = null;
  let panelVisible = false;
  let panelEls = {};
  let versionInfo = {
    status: 'checking',
    remoteVersion: '',
    installedVersion: INSTALLED_VERSION
  };

  function normalizeField(value) {
    return String(value || '').trim();
  }

  function parseNumber(value, fallback = null) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }

  function parseBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    }

    return null;
  }

  function normalizeUser(value) {
    return normalizeField(value).toLowerCase();
  }

  function normalizeSlug(value) {
    return normalizeField(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function normalizeVersion(value) {
    return normalizeField(value)
      .replace(/^v/i, '')
      .replace(/[^\d.]/g, '');
  }

  function compareVersions(a, b) {
    const left = normalizeVersion(a).split('.').map((part) => Number(part) || 0);
    const right = normalizeVersion(b).split('.').map((part) => Number(part) || 0);
    const length = Math.max(left.length, right.length);

    for (let index = 0; index < length; index += 1) {
      const diff = (left[index] || 0) - (right[index] || 0);
      if (diff !== 0) return diff;
    }

    return 0;
  }

  function extractUserFromHref(href) {
    const match = (href || '').match(/^\/@\/([^/?#]+)$/i);
    if (!match) return '';

    try {
      return normalizeUser(decodeURIComponent(match[1]));
    } catch (error) {
      return normalizeUser(match[1]);
    }
  }

  function getCurrentProfileUser() {
    return extractUserFromHref(window.location.pathname || '');
  }

  function usersMatchExact(a, b) {
    return normalizeUser(a) === normalizeUser(b) && normalizeField(a).length === normalizeField(b).length;
  }

  function resolveUserForElement(el) {
    const dataHrefUser = extractUserFromHref(el.getAttribute('data-href') || '');
    if (dataHrefUser) return dataHrefUser;

    const hrefUser = extractUserFromHref(el.getAttribute('href') || '');
    if (hrefUser) return hrefUser;

    return normalizeUser(el.getAttribute('data-username'));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function createBadge(title) {
    if (!title) return '';
    return `<span class="utitle injected-badge" title="${escapeHtml(title)}" style="margin-right:8px;margin-left:2px;display:inline-block;">${escapeHtml(title)}</span>`;
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, resolve);
    });
  }

  function storageSet(items) {
    return new Promise((resolve) => {
      chrome.storage.local.set(items, resolve);
    });
  }

  async function loadSettings() {
    const result = await storageGet(DEFAULT_SETTINGS);
    settings = {
      ...DEFAULT_SETTINGS,
      ...result
    };
  }

  async function saveSettings(nextSettings) {
    settings = {
      ...DEFAULT_SETTINGS,
      ...nextSettings
    };
    syncPanel();
    await storageSet(settings);
    scheduleInject();
  }

  function settingsSignature() {
    return [
      settings.enabled,
      settings.changeTitle,
      settings.changeDisplayName,
      settings.showBadge,
      settings.showFlair,
      settings.showTrophy,
      settings.showGlow,
      settings.glowIntensity,
      settings.glowColor
    ].join('\u0001');
  }

  function getAwardGlowStyles() {
    const enabled = !!settings.showGlow;
    const intensity = Math.max(0, parseNumber(settings.glowIntensity, 0));
    const color = normalizeField(settings.glowColor || '#ffd54a') || '#ffd54a';

    if (!enabled || intensity <= 0) {
      return {
        base: 'none',
        hover: 'none'
      };
    }

    const baseBlur = Math.max(1, Math.round(intensity));
    const hoverBlur = Math.max(baseBlur + 2, Math.round(baseBlur * 1.6));

    return {
      base: `0 0 ${baseBlur}px ${color}`,
      hover: `0 0 ${hoverBlur}px ${color}, 0 0 ${Math.max(1, Math.round(hoverBlur / 2))}px ${color}`
    };
  }

  function normalizeGlowColor(value) {
    if (Array.isArray(value) && value.length >= 3) {
      const [r, g, b, a] = value;
      if ([r, g, b].every((part) => Number.isFinite(Number(part)))) {
        return a === undefined
          ? `rgb(${Number(r)}, ${Number(g)}, ${Number(b)})`
          : `rgba(${Number(r)}, ${Number(g)}, ${Number(b)}, ${Number(a)})`;
      }
    }

    if (value && typeof value === 'object') {
      const r = value.r ?? value.red;
      const g = value.g ?? value.green;
      const b = value.b ?? value.blue;
      const a = value.a ?? value.alpha;
      if ([r, g, b].every((part) => Number.isFinite(Number(part)))) {
        return a === undefined
          ? `rgb(${Number(r)}, ${Number(g)}, ${Number(b)})`
          : `rgba(${Number(r)}, ${Number(g)}, ${Number(b)}, ${Number(a)})`;
      }
    }

    return normalizeField(value);
  }

  function isOriginalCreatorAward(label, url) {
    const text = `${normalizeField(label)} ${normalizeField(url)}`.toLowerCase();
    return text.includes('original creator');
  }

  function getAwardVisualStyles(award) {
    const label = award?.title || award?.content || '';
    const url = award?.url || '';
    const glowEnabled = parseBoolean(award?.glowEnabled ?? award?.glow) ?? false;
    const glowColor = normalizeGlowColor(award?.glowColor ?? award?.glowRgb ?? award?.rgb);
    const glowIntensity = parseNumber(award?.glowIntensity ?? award?.intensity, null);

    if (isOriginalCreatorAward(label, url)) {
      return {
        base: '0 0 6px rgba(170, 170, 170, 0.78)',
        hover: '0 0 11px rgba(190, 190, 190, 0.92), 0 0 5px rgba(210, 210, 210, 0.72)',
        hoverTransform: 'translate3d(0, -2px, 0) scale(1.06)'
      };
    }

    if (glowEnabled && glowIntensity !== null && glowIntensity > 0 && glowColor) {
      const baseBlur = Math.max(1, Math.round(glowIntensity));
      const hoverBlur = Math.max(baseBlur + 2, Math.round(baseBlur * 1.6));
      return {
        base: `0 0 ${baseBlur}px ${glowColor}`,
        hover: `0 0 ${hoverBlur}px ${glowColor}, 0 0 ${Math.max(1, Math.round(hoverBlur / 2))}px ${glowColor}`,
        hoverTransform: 'translate3d(0, -2px, 0) scale(1.06)'
      };
    }

    const glow = getAwardGlowStyles();
    return {
      base: glow.base,
      hover: glow.hover,
      hoverTransform: 'translate3d(0, -2px, 0) scale(1.06)'
    };
  }

  function normalizeTrophy(raw, fallbackClickHref) {
    if (!raw || typeof raw !== 'object') return null;

    const url = normalizeField(raw.url || raw.image || raw.src || raw.trophiesUrl || raw.trophyUrl);
    if (!url) return null;
    const clickUrl = normalizeField(raw.clickUrl || raw.click_url || raw.href || raw.link || raw.clickHref || fallbackClickHref || '/player/top/blitz') || '/player/top/blitz';

    const offsetX = parseNumber(raw.offsetX ?? raw.offset_x ?? raw.x ?? raw.shiftX, 0);
    const offsetY = parseNumber(raw.offsetY ?? raw.offset_y ?? raw.y ?? raw.shiftY, 0);
    const scale = parseNumber(raw.scale ?? raw.size ?? raw.zoom, 1);
    const glowEnabled = parseBoolean(raw.glowEnabled ?? raw.glow);
    const glowIntensity = parseNumber(raw.glowIntensity ?? raw.intensity, null);
    const glowColor = normalizeGlowColor(raw.glowColor ?? raw.glowRgb ?? raw.rgb);

    return {
      url,
      clickUrl,
      href: clickUrl,
      title: normalizeField(raw.title || raw.name || raw.label || 'Top Blitz Player') || 'Top Blitz Player',
      className: normalizeField(raw.className || raw.class || 'trophy perf top1') || 'trophy perf top1',
      content: normalizeField(raw.content || raw.text || raw.symbol || ''),
      offsetX,
      offsetY,
      scale,
      glowEnabled,
      glowIntensity,
      glowColor
    };
  }

  function parsePlayers(text) {
    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch (error) {
      console.error('JSON parse failed:', error);
      return [];
    }

    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.players)
        ? parsed.players
        : [];

    return rows
      .map((raw) => {
        const name = normalizeUser(raw.username || raw.name || raw.id);
        if (!name) return null;

        const title = normalizeField(raw.title);
        const displayName = normalizeField(raw.displayName || raw.display_name);
        const flair = normalizeField(raw.flair);
        const clickHref = normalizeField(raw.clickHref || raw.click_href || raw.linkHref || raw.link_href);

        const rawTrophies = Array.isArray(raw.trophies) ? raw.trophies : [];
        const trophies = rawTrophies
          .map((trophy) => normalizeTrophy(trophy, clickHref))
          .filter(Boolean);

        if (!trophies.length) {
          const legacyTrophy = normalizeTrophy({
            url: raw.trophiesUrl || raw.trophyUrl || raw.url,
            href: raw.trophyHref,
            title: raw.trophyTitle || title,
            className: raw.trophyClass,
            content: raw.trophyContent
          }, clickHref);

          if (legacyTrophy) {
            trophies.push(legacyTrophy);
          }
        }

        const cleanTitle = !title || title.toLowerCase() === 'title' ? '' : title;
        const trophySig = trophies
          .map((trophy) => [
            trophy.url,
            trophy.href,
            trophy.title,
            trophy.className,
            trophy.content,
            trophy.offsetX,
            trophy.offsetY,
            trophy.scale,
            trophy.glowEnabled,
            trophy.glowIntensity,
            trophy.glowColor
          ].join('\u0000'))
          .join('\u0001');

        return {
          name,
          id: name,
          title: cleanTitle,
          displayName,
          flair,
          clickHref,
          trophies,
          trophySig,
          badge: createBadge(cleanTitle)
        };
      })
      .filter(Boolean);
  }

  function parseTeams(text) {
    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch (error) {
      console.error('Team JSON parse failed:', error);
      return [];
    }

    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.teams)
        ? parsed.teams
        : [];

    return rows
      .map((raw) => {
        const name = normalizeField(raw.name || raw.team || raw.slug || raw.id);
        if (!name) return null;

        const id = normalizeSlug(raw.team || raw.slug || raw.id || raw.name);
        const title = normalizeField(raw.title || raw.name || name);
        const clickHref = normalizeField(raw.clickHref || raw.click_href || raw.linkHref || raw.link_href);

        const rawBadges = Array.isArray(raw.badges)
          ? raw.badges
          : Array.isArray(raw.trophies)
            ? raw.trophies
            : [];

        const badges = rawBadges
          .map((badge) => normalizeTrophy(badge, clickHref))
          .filter(Boolean);

        if (!badges.length) {
          const legacyBadge = normalizeTrophy({
            url: raw.badgeUrl || raw.badge_url || raw.badge || raw.url,
            href: raw.badgeHref || raw.badge_href || raw.href,
            title: raw.badgeTitle || raw.badge_title || title,
            className: raw.badgeClass || raw.badge_class || raw.className,
            content: raw.badgeContent || raw.badge_content
          }, clickHref);

          if (legacyBadge) {
            badges.push(legacyBadge);
          }
        }

        const badgeSig = badges
          .map((badge) => [
            badge.url,
            badge.href,
            badge.title,
            badge.className,
            badge.content,
            badge.offsetX,
            badge.offsetY,
            badge.scale,
            badge.glowEnabled,
            badge.glowIntensity,
            badge.glowColor
          ].join('\u0000'))
          .join('\u0001');

        return {
          name,
          id,
          title,
          clickHref,
          badges,
          badgeSig
        };
      })
      .filter(Boolean);
  }

  async function loadJsonSource(url, label) {
    const response = await fetch(url, {
      cache: 'no-store',
      mode: 'cors',
      headers: {
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`${label} request failed with status ${response.status}`);
    }

    return response.text();
  }

  async function loadData() {
    try {
      const [peopleText, teamsText] = await Promise.all([
        loadJsonSource(PEOPLE_JSON_URL, 'People'),
        loadJsonSource(TEAMS_JSON_URL, 'Teams')
      ]);
      players = parsePlayers(peopleText);
      teams = parseTeams(teamsText);
      console.log('Loaded players:', players);
      console.log('Loaded teams:', teams);
    } catch (error) {
      console.error('GitHub JSON load failed:', error);
      players = [];
      teams = [];
    }
  }

  async function checkVersion() {
    versionInfo = {
      status: 'checking',
      remoteVersion: '',
      installedVersion: INSTALLED_VERSION
    };
    syncPanel();

    try {
      const response = await fetch(VERSION_URL, {
        cache: 'no-store',
        mode: 'cors',
        headers: {
          Accept: 'text/plain'
        }
      });

      if (!response.ok) {
        throw new Error(`Version request failed with status ${response.status}`);
      }

      const remoteVersion = normalizeField(await response.text());
      if (!remoteVersion) {
        throw new Error('Version file was empty');
      }

      const comparison = compareVersions(INSTALLED_VERSION, remoteVersion);
      versionInfo = {
        status: comparison < 0 ? 'update-available' : 'up-to-date',
        remoteVersion,
        installedVersion: INSTALLED_VERSION
      };
    } catch (error) {
      console.error('Version check failed:', error);
      versionInfo = {
        status: 'error',
        remoteVersion: '',
        installedVersion: INSTALLED_VERSION
      };
    }

    syncPanel();
  }

  function getPrimaryTextNode(el) {
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()) {
        return node;
      }
    }

    return null;
  }

  function replaceName(el, newName) {
    const textNode = getPrimaryTextNode(el);
    if (!textNode) return;

    if (!el.dataset.originalName) {
      el.dataset.originalName = textNode.nodeValue;
    }

    if (newName) {
      textNode.nodeValue = newName;
    } else if (el.dataset.originalName) {
      textNode.nodeValue = el.dataset.originalName;
    }
  }

  function setFlair(el, flairUrl) {
    el.querySelectorAll('img.injected-flair').forEach((img) => img.remove());
    if (!flairUrl) return;

    const img = document.createElement('img');
    img.className = 'uflair injected-flair';
    img.src = flairUrl;
    el.appendChild(img);
  }

  function findTrophiesContainer(el) {
    let current = el;

    for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
      const trophies = current.querySelector('.trophies');
      if (trophies) {
        return trophies;
      }
    }

    return null;
  }

  function ensureTrophiesContainer(el) {
    const existing = findTrophiesContainer(el);
    if (existing) {
      existing.style.overflow = 'visible';
      return existing;
    }

    const side = document.querySelector('.side');
    if (!side) return null;

    const container = document.createElement('div');
    container.className = 'trophies';
    container.style.overflow = 'visible';
    side.prepend(container);
    return container;
  }

  function normalizeTeamPath(pathname = window.location.pathname) {
    const match = String(pathname || '').match(/^\/team\/([^/?#]+)/i);
    if (!match) return '';

    try {
      return normalizeSlug(decodeURIComponent(match[1]));
    } catch (error) {
      return normalizeSlug(match[1]);
    }
  }

  function setTrophies(el, player) {
    const container = ensureTrophiesContainer(el);
    if (!container) return;

    const trophies = Array.isArray(player.trophies) ? player.trophies : [];
    const signature = player.trophySig || trophies
      .map((trophy) => [
        trophy.url,
        trophy.href,
        trophy.title,
        trophy.className,
        trophy.content,
        trophy.offsetX,
        trophy.offsetY,
        trophy.scale
      ].join('\u0000'))
      .join('\u0001');
    if (container.dataset.injectedTrophySig === signature) {
      return;
    }

    container.querySelectorAll('a.injected-trophy').forEach((link) => link.remove());
    if (!trophies.length) {
      delete container.dataset.injectedTrophySig;
      return;
    }

    for (const trophy of trophies) {
      if (!trophy.url) continue;
      const awardStyles = getAwardVisualStyles(trophy);

      const link = document.createElement('a');
      link.href = trophy.clickUrl || trophy.href || player.clickHref || '/player/top/blitz';
      link.className = `${trophy.className || 'trophy perf top1'} injected-trophy`;
      link.target = '_self';
      link.rel = 'noreferrer';
      link.style.display = 'inline-block';
      link.style.cursor = 'pointer';
      link.style.textDecoration = 'none';
      link.style.verticalAlign = 'middle';
      link.style.position = 'relative';
      link.style.zIndex = '1';
      link.style.transition = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), filter 220ms ease, opacity 220ms ease, box-shadow 220ms ease';
      link.style.transformOrigin = 'center center';
      link.style.backfaceVisibility = 'hidden';
      link.style.transform = 'translateZ(0)';
      link.style.willChange = 'transform';
      link.style.boxShadow = awardStyles.base;
      link.style.borderRadius = '4px';
      link.addEventListener('mouseenter', () => {
        link.style.zIndex = '5';
        link.style.transform = awardStyles.hoverTransform;
        link.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.18))';
        link.style.boxShadow = awardStyles.hover;
      });
      link.addEventListener('mouseleave', () => {
        link.style.zIndex = '1';
        link.style.transform = 'translateZ(0)';
        link.style.filter = 'none';
        link.style.boxShadow = awardStyles.base;
      });

      const span = document.createElement('span');
      span.className = 'injected-trophy-inner';
      span.setAttribute('aria-label', trophy.title || 'Top Blitz Player');
      span.style.display = 'inline-block';
      span.style.verticalAlign = 'middle';
      span.style.lineHeight = '0';
      span.style.pointerEvents = 'none';
      span.style.overflow = 'visible';

      const offsetX = Number.isFinite(trophy.offsetX) ? trophy.offsetX : 0;
      const offsetY = Number.isFinite(trophy.offsetY) ? trophy.offsetY : 0;
      const scale = Number.isFinite(trophy.scale) ? trophy.scale : 1;
      const scaleGap = Math.max(0, Math.round((scale - 1) * 10));
      link.style.left = `${offsetX}px`;
      link.style.top = `${offsetY}px`;
      link.style.marginRight = `${scaleGap}px`;
      link.style.overflow = 'visible';
      link.style.zIndex = '1';
      span.style.transformOrigin = 'center center';
      span.style.transform = `scale(${Math.max(scale, 1)})`;

      if (/\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(trophy.url) || /^data:image\//i.test(trophy.url)) {
        const img = document.createElement('img');
        img.src = trophy.url;
        img.alt = trophy.title || 'Top Blitz Player';
        img.style.display = 'block';
        img.style.maxWidth = '18px';
        img.style.maxHeight = '18px';
        span.appendChild(img);
      } else {
        span.textContent = trophy.content || DEFAULT_TROPHY_CONTENT;
      }

      link.appendChild(span);
      container.prepend(link);
    }

    container.dataset.injectedTrophySig = signature;
  }

  function getTeamHeader() {
    return document.querySelector('.box__top h1.text');
  }

  function setTeamBadges(header, team) {
    if (!header) return;
    header.style.overflow = 'visible';
    if (header.parentElement) {
      header.parentElement.style.overflow = 'visible';
    }

    const badges = Array.isArray(team.badges) ? team.badges : [];
    const signature = team.badgeSig || badges
      .map((badge) => [
        badge.url,
        badge.href,
        badge.title,
        badge.className,
        badge.content,
        badge.offsetX,
        badge.offsetY,
        badge.scale
      ].join('\u0000'))
      .concat([settingsSignature()])
      .join('\u0001');

    if (header.dataset.injectedTeamSig === signature) {
      return;
    }

    header.querySelectorAll('a.injected-team-badge').forEach((badge) => badge.remove());
    if (!badges.length) {
      delete header.dataset.injectedTeamSig;
      return;
    }

    const host = header.parentElement || header;
    const flair = header.querySelector('img.uflair');
    let insertionPoint = flair || header;

    for (const badge of badges) {
      if (!badge.url) continue;
      const title = badge.title || team.title || 'Team badge';
      const href = badge.clickUrl || badge.href || team.clickHref || '#';
      const awardStyles = getAwardVisualStyles(badge);

      const link = document.createElement('a');
      link.href = href;
      link.className = `${badge.className || 'trophy award icon3d'} injected-team-badge`;
      link.title = title;
      link.setAttribute('data-tooltip', title);
      link.setAttribute('aria-label', title);
      link.target = '_self';
      link.rel = 'noreferrer';
      link.style.display = 'inline-flex';
      link.style.alignItems = 'center';
      link.style.textDecoration = 'none';
      link.style.verticalAlign = 'middle';
      link.style.cursor = 'pointer';
      link.style.pointerEvents = 'auto';
      link.style.overflow = 'visible';
      link.style.transformOrigin = 'center center';
      link.style.transition = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), filter 220ms ease, opacity 220ms ease, box-shadow 220ms ease';
      link.style.willChange = 'transform';
      link.style.backfaceVisibility = 'hidden';
      link.style.transform = 'translateZ(0)';
      link.style.lineHeight = '0';
      link.style.zIndex = '1';
      link.style.boxShadow = awardStyles.base;
      link.style.borderRadius = '4px';
      link.addEventListener('click', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        window.location.assign(href);
      });
      link.addEventListener('mouseenter', () => {
        link.style.zIndex = '5';
        link.style.transform = awardStyles.hoverTransform;
        link.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.18))';
        link.style.boxShadow = awardStyles.hover;
      });
      link.addEventListener('mouseleave', () => {
        link.style.zIndex = '1';
        link.style.transform = 'translateZ(0)';
        link.style.filter = 'none';
        link.style.boxShadow = awardStyles.base;
      });

      const inner = document.createElement('span');
      inner.className = 'injected-team-badge-inner';
      inner.title = title;
      inner.setAttribute('aria-label', title);
      inner.style.display = 'inline-flex';
      inner.style.alignItems = 'center';
      inner.style.justifyContent = 'center';
      inner.style.verticalAlign = 'middle';
      inner.style.lineHeight = '1';
      inner.style.overflow = 'visible';
      inner.style.pointerEvents = 'none';

      const offsetX = Number.isFinite(badge.offsetX) ? badge.offsetX : 0;
      const offsetY = Number.isFinite(badge.offsetY) ? badge.offsetY : 0;
      const scale = Number.isFinite(badge.scale) ? badge.scale : 1.08;
      link.style.marginLeft = `${offsetX}px`;
      link.style.marginTop = `${offsetY}px`;
      link.style.position = 'relative';
      inner.style.transformOrigin = 'center center';
      inner.style.transform = `scale(${scale})`;

      if (/\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(badge.url) || /^data:image\//i.test(badge.url)) {
        const img = document.createElement('img');
        img.src = badge.url;
        img.alt = title;
        img.title = title;
        img.className = 'injected-team-badge-image';
        img.style.display = 'block';
        img.style.maxWidth = '18px';
        img.style.maxHeight = '18px';
        img.style.pointerEvents = 'none';
        img.style.verticalAlign = 'middle';
        inner.appendChild(img);
      } else {
        inner.textContent = badge.content || DEFAULT_TROPHY_CONTENT;
      }

      link.appendChild(inner);
      if (insertionPoint && insertionPoint.parentNode === header) {
        insertionPoint.insertAdjacentElement('afterend', link);
      } else if (insertionPoint === header && header.parentNode === host) {
        header.insertAdjacentElement('afterend', link);
      } else {
        host.appendChild(link);
      }
      insertionPoint = link;
    }

    header.dataset.injectedTeamSig = signature;
  }

  function clearInjected(el) {
    if (el.dataset.originalName) {
      const textNode = getPrimaryTextNode(el);
      if (textNode) {
        textNode.nodeValue = el.dataset.originalName;
      }
    }

    el.querySelectorAll('.injected-badge').forEach((badge) => badge.remove());
    el.querySelectorAll('img.injected-flair').forEach((img) => img.remove());

    const container = findTrophiesContainer(el);
    if (container) {
    container.querySelectorAll('a.injected-trophy').forEach((link) => link.remove());
      delete container.dataset.injectedTrophySig;
    }

    delete el.dataset.originalName;
    delete el.dataset.injectedFor;
    delete el.dataset.injectedSig;
  }

  function clearTeamInjected(header) {
    if (!header) return;
    header.querySelectorAll('a.injected-team-badge').forEach((badge) => badge.remove());
    delete header.dataset.injectedTeamSig;
  }

  function isVisibleElement(el) {
    if (!el) return false;
    if (!el.isConnected) return false;
    if (typeof el.getClientRects !== 'function') return true;
    return el.getClientRects().length > 0;
  }

  function pickPrimaryProfileElement(elements) {
    const visible = elements.filter((el) => isVisibleElement(el));
    const sideMatch = visible.find((el) => el.closest('.side'));
    return sideMatch || visible[0] || null;
  }

  function syncPanel() {
    if (!panelEls.master) return;

    panelEls.master.checked = !!settings.enabled;
    panelEls.title.checked = !!settings.changeTitle;
    panelEls.displayName.checked = !!settings.changeDisplayName;
    panelEls.badge.checked = !!settings.showBadge;
    panelEls.flair.checked = !!settings.showFlair;
    panelEls.trophy.checked = !!settings.showTrophy;
    if (panelEls.glow) panelEls.glow.checked = !!settings.showGlow;
    if (panelEls.glowIntensity) panelEls.glowIntensity.value = String(Number.isFinite(Number(settings.glowIntensity)) ? settings.glowIntensity : 0);
    if (panelEls.glowColor) panelEls.glowColor.value = normalizeField(settings.glowColor || '#ffd54a') || '#ffd54a';
    if (panelEls.glowValue) panelEls.glowValue.textContent = String(Number.isFinite(Number(settings.glowIntensity)) ? settings.glowIntensity : 0);
    panelEls.body.classList.toggle('is-disabled', !settings.enabled);
    if (panelEls.versionStatus) {
      panelEls.versionStatus.className = 'version-status';
      if (versionInfo.status === 'update-available') {
        panelEls.versionStatus.classList.add('is-update');
        panelEls.versionStatus.textContent = `Update available: ${versionInfo.remoteVersion}`;
      } else if (versionInfo.status === 'up-to-date') {
        panelEls.versionStatus.classList.add('is-ok');
        panelEls.versionStatus.textContent = `Up to date: ${versionInfo.installedVersion}`;
      } else if (versionInfo.status === 'error') {
        panelEls.versionStatus.classList.add('is-error');
        panelEls.versionStatus.textContent = 'Update check failed';
      } else {
        panelEls.versionStatus.textContent = 'Checking for updates...';
      }
    }
    if (panelEls.versionDetail) {
      if (versionInfo.status === 'update-available') {
        panelEls.versionDetail.textContent = 'Re-download from the repo to update.';
      } else if (versionInfo.status === 'up-to-date') {
        panelEls.versionDetail.textContent = 'You are running the latest version.';
      } else if (versionInfo.status === 'error') {
        panelEls.versionDetail.textContent = 'Could not read the remote Version file.';
      } else {
        panelEls.versionDetail.textContent = '';
      }
    }
    panelRoot.style.display = panelVisible ? 'block' : 'none';
  }

  function hidePanel() {
    panelVisible = false;
    syncPanel();
  }

  function showPanel() {
    panelVisible = true;
    syncPanel();
  }

  function togglePanel() {
    if (panelVisible) hidePanel();
    else showPanel();
  }

  function createPanel() {
    if (panelRoot) return;

    panelRoot = document.createElement('div');
    panelRoot.id = 'lichess-trophy-panel';
    panelRoot.style.all = 'initial';
    panelRoot.style.position = 'fixed';
    panelRoot.style.right = '16px';
    panelRoot.style.bottom = '16px';
    panelRoot.style.zIndex = '999999';

    const shadow = panelRoot.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .panel {
          font-family: Arial, sans-serif;
          width: 260px;
          border: 1px solid rgba(255,255,255,0.14);
          border-radius: 14px;
          background: rgba(18, 18, 24, 0.96);
          color: #f3f4f6;
          box-shadow: 0 14px 36px rgba(0,0,0,0.28);
          overflow: hidden;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 12px;
          background: linear-gradient(135deg, rgba(122,162,255,0.18), rgba(255,255,255,0.04));
          border-bottom: 1px solid rgba(255,255,255,0.08);
          font-size: 13px;
          font-weight: 700;
        }
        .header button {
          appearance: none;
          border: 0;
          background: rgba(255,255,255,0.08);
          color: inherit;
          border-radius: 8px;
          width: 28px;
          height: 28px;
          cursor: pointer;
        }
        .content {
          padding: 12px;
          display: grid;
          gap: 10px;
        }
        .row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          font-size: 12px;
          line-height: 1.3;
        }
        .row strong {
          font-size: 12px;
          font-weight: 600;
        }
        .row input {
          width: 16px;
          height: 16px;
          accent-color: #7aa2ff;
        }
        .row input[type="range"] {
          width: 96px;
          height: 16px;
        }
        .row input[type="color"] {
          width: 28px;
          height: 24px;
          padding: 0;
          border: 0;
          background: transparent;
        }
        .row .value {
          min-width: 42px;
          text-align: right;
          color: rgba(243,244,246,0.78);
          font-variant-numeric: tabular-nums;
        }
        .note {
          font-size: 11px;
          color: rgba(243,244,246,0.72);
          line-height: 1.4;
        }
        .version-box {
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 10px;
          padding: 10px;
          background: rgba(255,255,255,0.04);
          display: grid;
          gap: 6px;
          font-size: 11px;
          line-height: 1.4;
        }
        .version-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: rgba(243,244,246,0.55);
        }
        .version-status {
          font-size: 12px;
          font-weight: 700;
        }
        .version-status.is-update {
          color: #f6c177;
        }
        .version-status.is-ok {
          color: #8be9a8;
        }
        .version-status.is-error {
          color: #ff9b9b;
        }
        .version-links {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .version-links a {
          color: #9ec1ff;
          text-decoration: none;
        }
        .version-links a:hover {
          text-decoration: underline;
        }
        .is-disabled {
          opacity: 0.55;
        }
      </style>
      <div class="panel">
        <div class="header">
          <div>LichessTrophy</div>
          <button type="button" data-action="toggle-panel" aria-label="Toggle panel">-</button>
        </div>
        <div class="content">
          <label class="row"><strong>Enabled</strong><input type="checkbox" data-setting="enabled"></label>
          <label class="row"><span>Change title</span><input type="checkbox" data-setting="changeTitle"></label>
          <label class="row"><span>Change display name</span><input type="checkbox" data-setting="changeDisplayName"></label>
          <label class="row"><span>Show badge</span><input type="checkbox" data-setting="showBadge"></label>
          <label class="row"><span>Show flair</span><input type="checkbox" data-setting="showFlair"></label>
          <label class="row"><span>Show trophy</span><input type="checkbox" data-setting="showTrophy"></label>
          <label class="row"><span>Glow awards</span><input type="checkbox" data-setting="showGlow"></label>
          <label class="row"><span>Glow intensity</span><input type="range" min="0" max="24" step="1" data-setting="glowIntensity"><span class="value" data-glow-value></span></label>
          <label class="row"><span>Glow color</span><input type="color" data-setting="glowColor"></label>
          <div class="version-box">
            <div class="version-label">Version</div>
            <div class="version-status" data-version-status>Checking for updates...</div>
            <div class="note" data-version-detail></div>
            <div class="version-links">
              <a href="${REPO_URL}" target="_blank" rel="noreferrer">Open repo</a>
              <a href="${REPO_URL}/releases" target="_blank" rel="noreferrer">Releases</a>
            </div>
          </div>
          <div class="note">Changes save automatically and apply immediately.</div>
        </div>
      </div>
    `;

    const body = shadow.querySelector('.content');
    const master = shadow.querySelector('[data-setting="enabled"]');
    const title = shadow.querySelector('[data-setting="changeTitle"]');
    const displayName = shadow.querySelector('[data-setting="changeDisplayName"]');
    const badge = shadow.querySelector('[data-setting="showBadge"]');
    const flair = shadow.querySelector('[data-setting="showFlair"]');
    const trophy = shadow.querySelector('[data-setting="showTrophy"]');
    const glow = shadow.querySelector('[data-setting="showGlow"]');
    const glowIntensity = shadow.querySelector('[data-setting="glowIntensity"]');
    const glowColor = shadow.querySelector('[data-setting="glowColor"]');
    const glowValue = shadow.querySelector('[data-glow-value]');
    const versionStatus = shadow.querySelector('[data-version-status]');
    const versionDetail = shadow.querySelector('[data-version-detail]');
    const toggleButton = shadow.querySelector('[data-action="toggle-panel"]');

    panelEls = {
      body,
      master,
      title,
      displayName,
      badge,
      flair,
      trophy,
      glow,
      glowIntensity,
      glowColor,
      glowValue,
      versionStatus,
      versionDetail
    };

    const bind = (key, element) => {
      const eventName = element && element.type === 'range' ? 'input' : 'change';
      element.addEventListener(eventName, () => {
        saveSettings({
          ...settings,
          [key]: element.checked
        });
      });
    };

    bind('enabled', master);
    bind('changeTitle', title);
    bind('changeDisplayName', displayName);
    bind('showBadge', badge);
    bind('showFlair', flair);
    bind('showTrophy', trophy);
    bind('showGlow', glow);

    if (glowIntensity) {
      glowIntensity.addEventListener('input', () => {
        if (glowValue) glowValue.textContent = glowIntensity.value;
        saveSettings({
          ...settings,
          glowIntensity: parseNumber(glowIntensity.value, 0)
        });
      });
    }

    if (glowColor) {
      glowColor.addEventListener('change', () => {
        saveSettings({
          ...settings,
          glowColor: glowColor.value
        });
      });
    }

    toggleButton.addEventListener('click', () => {
      togglePanel();
    });

    document.documentElement.appendChild(panelRoot);
    syncPanel();
  }

  function inject() {
    if (!players.length && !teams.length) return;

    if (!settings.enabled) {
      document.querySelectorAll('.user-link').forEach((el) => {
        if (el.dataset.injectedFor) clearInjected(el);
      });
      clearTeamInjected(getTeamHeader());
      return;
    }

    const currentProfileUser = getCurrentProfileUser();
    const player = players.find((entry) => usersMatchExact(entry.id, currentProfileUser));

    if (player) {
      document.querySelectorAll('.user-link').forEach((el) => {
        if (el.dataset.injectedFor) clearInjected(el);
      });

      const elements = Array.from(document.querySelectorAll('.user-link')).filter((el) =>
        usersMatchExact(resolveUserForElement(el), currentProfileUser)
      );
      const primaryElement = pickPrimaryProfileElement(elements);

      if (primaryElement) {
        elements.forEach((el) => {
          if (el !== primaryElement) clearInjected(el);
        });

        const el = primaryElement;
        const signature = [
          player.displayName,
          player.title,
          player.flair,
          player.clickHref,
          player.trophySig,
          settingsSignature()
        ].join('\u0001');

        if (el.dataset.injectedFor === player.id && el.dataset.injectedSig === signature) {
          return;
        }

        if (el.dataset.injectedFor && el.dataset.injectedFor !== player.id) {
          clearInjected(el);
        }

        if (settings.changeDisplayName) {
          if (player.displayName) replaceName(el, player.displayName);
          else replaceName(el, '');
        } else {
          replaceName(el, '');
        }

        el.querySelectorAll('.injected-badge').forEach((badge) => badge.remove());
        if (settings.showBadge && settings.changeTitle && player.badge) {
          const wrapper = document.createElement('span');
          wrapper.innerHTML = player.badge;
          const badgeNode = wrapper.firstChild;
          const icon = el.querySelector('icon.line, i.line');

          if (icon) icon.insertAdjacentElement('afterend', badgeNode);
          else el.prepend(badgeNode);
        }

        if (settings.showFlair) {
          setFlair(el, player.flair);
        } else {
          setFlair(el, '');
        }

        if (settings.showTrophy) {
          setTrophies(el, player);
        } else {
          const container = findTrophiesContainer(el);
          if (container) {
            container.querySelectorAll('a.injected-trophy').forEach((link) => link.remove());
            delete container.dataset.injectedTrophySig;
          }
        }

        el.dataset.injectedFor = player.id;
        el.dataset.injectedSig = signature;
      }
    } else {
      document.querySelectorAll('.user-link').forEach((el) => {
        if (el.dataset.injectedFor) clearInjected(el);
      });
    }

    const teamHeader = getTeamHeader();
    const currentTeam = normalizeTeamPath();
    const team = teams.find((entry) => entry.id === currentTeam);

    if (!teamHeader || !currentTeam || !team) {
      if (teamHeader) clearTeamInjected(teamHeader);
      return;
    }

    if (settings.showBadge) {
      setTeamBadges(teamHeader, team);
    } else {
      clearTeamInjected(teamHeader);
    }
  }

  function scheduleInject() {
    if (injectScheduled) return;
    injectScheduled = true;

    requestAnimationFrame(() => {
      injectScheduled = false;
      inject();
    });
  }

  function observe() {
    // Intentionally disabled: inject once on initial page load only.
  }

  function closeOnOutsideInteraction(event) {
    if (!panelVisible || !panelRoot) return;

    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    if (path.includes(panelRoot)) return;

    hidePanel();
  }

  function registerAutoCloseHandlers() {
    window.addEventListener('blur', hidePanel);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) hidePanel();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') hidePanel();
    });
    document.addEventListener('pointerdown', closeOnOutsideInteraction, true);
  }

  async function init() {
    createPanel();
    registerAutoCloseHandlers();
    await loadSettings();
    syncPanel();
    await loadData();
    await checkVersion();
    inject();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'toggle-panel') {
      togglePanel();
    }
  });

  init();
})();
