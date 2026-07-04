(function () {
  'use strict';

  const PEOPLE_JSON_URL = `https://api.github.com/repos/SomeoneOfficial/LichessTrophy/contents/People.json?ref=main&t=${Date.now()}`;
  const TEAMS_JSON_URL = `https://api.github.com/repos/SomeoneOfficial/LichessTrophy/contents/Teams.json?ref=main&t=${Date.now()}`;
  const FALLBACK_PEOPLE_JSON_URL = chrome.runtime.getURL('People.json');
  const FALLBACK_TEAMS_JSON_URL = chrome.runtime.getURL('Teams.json');
  const DEFAULT_TROPHY_CONTENT = '\uE05E';

  const DEFAULT_SETTINGS = {
    enabled: true,
    changeTitle: true,
    changeDisplayName: true,
    showBadge: true,
    showFlair: true,
    showTrophy: true
  };

  let players = [];
  let teams = [];
  let injectScheduled = false;
  let settings = { ...DEFAULT_SETTINGS };
  let panelRoot = null;
  let panelVisible = false;
  let panelEls = {};

  function normalizeField(value) {
    return String(value || '').trim();
  }

  function parseNumber(value, fallback = null) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
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

  function extractUserFromHref(href) {
    const match = (href || '').match(/\/@\/([^/?#]+)/i);
    if (!match) return '';

    try {
      return normalizeUser(decodeURIComponent(match[1]));
    } catch (error) {
      return normalizeUser(match[1]);
    }
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
      settings.showTrophy
    ].join('\u0001');
  }

  function normalizeTrophy(raw, fallbackClickHref) {
    if (!raw || typeof raw !== 'object') return null;

    const url = normalizeField(raw.url || raw.image || raw.src || raw.trophiesUrl || raw.trophyUrl);
    if (!url) return null;
    const clickUrl = normalizeField(raw.clickUrl || raw.click_url || raw.href || raw.link || raw.clickHref || fallbackClickHref || '/player/top/blitz') || '/player/top/blitz';

    const offsetX = parseNumber(raw.offsetX ?? raw.offset_x ?? raw.x ?? raw.shiftX, 0);
    const offsetY = parseNumber(raw.offsetY ?? raw.offset_y ?? raw.y ?? raw.shiftY, 0);
    const scale = parseNumber(raw.scale ?? raw.size ?? raw.zoom, 1);

    return {
      url,
      clickUrl,
      href: clickUrl,
      title: normalizeField(raw.title || raw.name || raw.label || 'Top Blitz Player') || 'Top Blitz Player',
      className: normalizeField(raw.className || raw.class || 'trophy perf top1') || 'trophy perf top1',
      content: normalizeField(raw.content || raw.text || raw.symbol || ''),
      offsetX,
      offsetY,
      scale
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
            trophy.scale
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
            badge.scale
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

  function decodeGitHubContent(text) {
    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return text;
    }

    if (parsed && typeof parsed === 'object' && typeof parsed.content === 'string') {
      const content = parsed.content.replace(/\n/g, '');
      if (parsed.encoding === 'base64') {
        try {
          return decodeURIComponent(
            Array.prototype.map.call(atob(content), (char) =>
              `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`
            ).join('')
          );
        } catch (error) {
          try {
            return atob(content);
          } catch (innerError) {
            return text;
          }
        }
      }
    }

    return text;
  }

  function loadJsonSource(url, fallbackUrl, label) {
    return fetch(url, {
      cache: 'no-store',
      mode: 'cors',
      headers: {
        Accept: 'application/vnd.github.raw+json'
      }
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`${label} request failed with status ${response.status}`);
        }

        return response.text();
      })
      .then((text) => decodeGitHubContent(text))
      .catch((error) => {
        console.error(`${label} JSON load failed, trying local fallback:`, error);
        return fetch(fallbackUrl, { cache: 'no-store' })
          .then((response) => {
            if (!response.ok) {
              throw new Error(`${label} fallback failed with status ${response.status}`);
            }

            return response.text();
          })
          .then((text) => text)
          .catch((fallbackError) => {
            console.error(`Fallback ${label} JSON load failed:`, fallbackError);
            return '[]';
          });
      });
  }

  async function loadData() {
    const [peopleText, teamsText] = await Promise.all([
      loadJsonSource(PEOPLE_JSON_URL, FALLBACK_PEOPLE_JSON_URL, 'People'),
      loadJsonSource(TEAMS_JSON_URL, FALLBACK_TEAMS_JSON_URL, 'Teams')
    ]);

    players = parsePlayers(peopleText);
    teams = parseTeams(teamsText);
    console.log('Loaded players:', players);
    console.log('Loaded teams:', teams);
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
    if (existing) return existing;

    const side = document.querySelector('.side');
    if (!side) return null;

    const container = document.createElement('div');
    container.className = 'trophies';
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

      const link = document.createElement('a');
      link.href = trophy.clickUrl || trophy.href || player.clickHref || '/player/top/blitz';
      link.className = `${trophy.className || 'trophy perf top1'} injected-trophy`;
      link.title = trophy.title || 'Top Blitz Player';
      link.target = '_self';
      link.rel = 'noreferrer';
      link.style.display = 'inline-block';
      link.style.cursor = 'pointer';
      link.style.textDecoration = 'none';
      link.style.verticalAlign = 'middle';

      const span = document.createElement('span');
      span.className = 'injected-trophy-inner';
      span.title = trophy.title || 'Top Blitz Player';
      span.setAttribute('aria-label', trophy.title || 'Top Blitz Player');
      span.style.display = 'inline-block';
      span.style.verticalAlign = 'middle';
      span.style.lineHeight = '0';

      const offsetX = Number.isFinite(trophy.offsetX) ? trophy.offsetX : 0;
      const offsetY = Number.isFinite(trophy.offsetY) ? trophy.offsetY : 0;
      const scale = Number.isFinite(trophy.scale) ? trophy.scale : 1;
      link.style.marginLeft = `${offsetX}px`;
      link.style.marginTop = `${offsetY}px`;
      span.style.transformOrigin = 'center center';
      span.style.transform = `scale(${scale})`;

      if (/\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(trophy.url) || /^data:image\//i.test(trophy.url)) {
        const img = document.createElement('img');
        img.src = trophy.url;
        img.alt = trophy.title || 'Top Blitz Player';
        img.title = trophy.title || 'Top Blitz Player';
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
      .join('\u0001');

    if (header.dataset.injectedTeamSig === signature) {
      return;
    }

    header.querySelectorAll('a.injected-team-badge').forEach((badge) => badge.remove());
    if (!badges.length) {
      delete header.dataset.injectedTeamSig;
      return;
    }

    const flair = header.querySelector('img.uflair');

    for (const badge of badges) {
      if (!badge.url) continue;

      const link = document.createElement('a');
      link.href = badge.clickUrl || badge.href || team.clickHref || '#';
      link.className = `${badge.className || 'uflair'} injected-team-badge`;
      link.title = badge.title || team.title || 'Team badge';
      link.target = '_self';
      link.rel = 'noreferrer';
      link.style.display = 'inline-block';
      link.style.textDecoration = 'none';
      link.style.verticalAlign = 'middle';
      link.style.cursor = 'pointer';

      const inner = document.createElement('span');
      inner.className = 'injected-team-badge-inner';
      inner.title = badge.title || team.title || 'Team badge';
      inner.setAttribute('aria-label', badge.title || team.title || 'Team badge');
      inner.style.display = 'inline-block';
      inner.style.verticalAlign = 'middle';
      inner.style.lineHeight = '0';

      const offsetX = Number.isFinite(badge.offsetX) ? badge.offsetX : 0;
      const offsetY = Number.isFinite(badge.offsetY) ? badge.offsetY : 0;
      const scale = Number.isFinite(badge.scale) ? badge.scale : 1;
      link.style.marginLeft = `${offsetX}px`;
      link.style.marginTop = `${offsetY}px`;
      inner.style.transformOrigin = 'center center';
      inner.style.transform = `scale(${scale})`;

      if (/\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(badge.url) || /^data:image\//i.test(badge.url)) {
        const img = document.createElement('img');
        img.src = badge.url;
        img.alt = badge.title || team.title || 'Team badge';
        img.title = badge.title || team.title || 'Team badge';
        img.className = 'uflair';
        img.style.display = 'block';
        img.style.maxWidth = '18px';
        img.style.maxHeight = '18px';
        inner.appendChild(img);
      } else {
        inner.textContent = badge.content || DEFAULT_TROPHY_CONTENT;
      }

      link.appendChild(inner);

      if (flair) flair.insertAdjacentElement('beforebegin', link);
      else header.appendChild(link);
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

  function syncPanel() {
    if (!panelEls.master) return;

    panelEls.master.checked = !!settings.enabled;
    panelEls.title.checked = !!settings.changeTitle;
    panelEls.displayName.checked = !!settings.changeDisplayName;
    panelEls.badge.checked = !!settings.showBadge;
    panelEls.flair.checked = !!settings.showFlair;
    panelEls.trophy.checked = !!settings.showTrophy;
    panelEls.body.classList.toggle('is-disabled', !settings.enabled);
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
        .note {
          font-size: 11px;
          color: rgba(243,244,246,0.72);
          line-height: 1.4;
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
    const toggleButton = shadow.querySelector('[data-action="toggle-panel"]');

    panelEls = {
      body,
      master,
      title,
      displayName,
      badge,
      flair,
      trophy
    };

    const bind = (key, element) => {
      element.addEventListener('change', () => {
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

    const playersById = new Map(players.map((player) => [player.id, player]));
    const elements = document.querySelectorAll('.user-link');

    elements.forEach((el) => {
      const currentUser = resolveUserForElement(el);

      if (!currentUser) {
        if (el.dataset.injectedFor) clearInjected(el);
        return;
      }

      const player = playersById.get(currentUser);
      if (!player) {
        if (el.dataset.injectedFor) clearInjected(el);
        return;
      }

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
    });

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
    const target = document.body || document.documentElement;
    const obs = new MutationObserver(scheduleInject);
    obs.observe(target, {
      childList: true,
      subtree: true
    });
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
    inject();
    observe();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'toggle-panel') {
      togglePanel();
    }
  });

  init();
})();
