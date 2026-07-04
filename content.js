(function () {
  'use strict';

  const CSV_URL = 'https://raw.githubusercontent.com/SomeoneOfficial/LichessTrophy/main/People.csv';
  const FALLBACK_CSV_URL = chrome.runtime.getURL('People.csv');

  const DEFAULT_SETTINGS = {
    enabled: true,
    changeTitle: true,
    changeDisplayName: true,
    showBadge: true,
    showFlair: true,
    showTrophy: true
  };

  let players = [];
  let injectScheduled = false;
  let settings = { ...DEFAULT_SETTINGS };
  let panelRoot = null;
  let panelEls = {};

  function normalizeUser(value) {
    return (value || '').trim().toLowerCase();
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

  function getColumnIndexMap(headerRow) {
    const map = new Map();

    headerRow.forEach((value, index) => {
      const key = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');

      if (key) {
        map.set(key, index);
      }
    });

    return map;
  }

  function readColumn(row, indexMap, keys, fallbackIndex) {
    if (indexMap) {
      for (const key of keys) {
        const normalized = String(key)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '');
        const index = indexMap.get(normalized);

        if (index != null && row[index] != null) {
          return row[index];
        }
      }
    }

    return row[fallbackIndex] || '';
  }

  function readFirstNonEmptyColumn(row, indexMap, keys, fallbackIndexes) {
    if (indexMap) {
      for (const key of keys) {
        const normalized = String(key)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '');
        const index = indexMap.get(normalized);

        if (index != null && row[index] != null && String(row[index]).trim() !== '') {
          return row[index];
        }
      }
    }

    for (const index of fallbackIndexes) {
      if (row[index] != null && String(row[index]).trim() !== '') {
        return row[index];
      }
    }

    return '';
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];

      if (inQuotes) {
        if (char === '"' && next === '"') {
          field += '"';
          i += 1;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          field += char;
        }
        continue;
      }

      if (char === '"') {
        inQuotes = true;
        continue;
      }

      if (char === ',') {
        row.push(field);
        field = '';
        continue;
      }

      if (char === '\r') {
        continue;
      }

      if (char === '\n') {
        row.push(field);
        if (row.some((value) => value.trim() !== '')) {
          rows.push(row);
        }
        row = [];
        field = '';
        continue;
      }

      field += char;
    }

    row.push(field);
    if (row.some((value) => value.trim() !== '')) {
      rows.push(row);
    }

    return rows;
  }

  function parsePlayers(text) {
    const rows = parseCsv(text);
    if (!rows.length) return [];

    const header = rows[0].map((value) => String(value || '').trim().toLowerCase());
    const hasHeader = header.includes('username') || header.includes('name') || header.includes('trophiesurl');
    const indexMap = hasHeader ? getColumnIndexMap(rows[0]) : null;
    const dataRows = hasHeader ? rows.slice(1) : rows;

    return dataRows
      .map((row) => {
        const name = normalizeUser(readColumn(row, indexMap, ['username', 'name'], 0));
        if (!name) return null;

        const title = (readColumn(row, indexMap, ['title'], 1) || '').trim();
        const displayName = (readColumn(row, indexMap, ['displayname', 'display name'], 2) || '').trim();
        const flair = (readColumn(row, indexMap, ['flair'], 3) || '').trim();
        const trophiesUrl = (readColumn(row, indexMap, ['trophiesurl', 'trophies url', 'trophies'], 4) || '').trim();
        const trophyHref = (readFirstNonEmptyColumn(row, indexMap, ['trophyhref', 'trophy href'], [5]) || '').trim();
        const trophyTitle = (readFirstNonEmptyColumn(row, indexMap, ['trophytitle', 'trophy title'], [6]) || '').trim();
        const trophyClass = (readFirstNonEmptyColumn(row, indexMap, ['trophyclass', 'trophy class'], [7]) || '').trim();
        const trophyContent = (readFirstNonEmptyColumn(row, indexMap, ['trophycontent', 'trophy content'], [8]) || '').trim();
        const cleanTitle = !title || title.toLowerCase() === 'title' ? '' : title;

        return {
          name,
          id: name,
          title: cleanTitle,
          displayName,
          flair,
          trophiesUrl,
          trophyHref,
          trophyTitle,
          trophyClass,
          trophyContent,
          badge: createBadge(cleanTitle)
        };
      })
      .filter(Boolean);
  }

  function loadData() {
    return fetch(CSV_URL, { cache: 'no-store', mode: 'cors' })
      .then((response) => response.text())
      .then((text) => {
        players = parsePlayers(text);
        console.log('Loaded players:', players);
      })
      .catch((error) => {
        console.error('CSV load failed, trying local fallback:', error);
        return fetch(FALLBACK_CSV_URL, { cache: 'no-store' })
          .then((response) => response.text())
          .then((text) => {
            players = parsePlayers(text);
            console.log('Loaded fallback players:', players);
          })
          .catch((fallbackError) => {
            console.error('Fallback CSV load failed:', fallbackError);
            players = [];
          });
      });
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

  function setTrophies(el, player) {
    const container = ensureTrophiesContainer(el);
    if (!container) return;

    const trophiesUrl = player.trophiesUrl || '';
    const trophyHref = player.trophyHref || '/player/top/blitz';
    const trophyTitle = player.trophyTitle || 'Top Blitz Player';
    const trophyClass = player.trophyClass || 'trophy perf top1';

    const signature = [trophiesUrl, trophyHref, trophyTitle, trophyClass].join('\u0001');
    if (container.dataset.injectedTrophySig === signature) {
      return;
    }

    container.querySelectorAll('a.injected-trophy').forEach((link) => link.remove());
    if (!trophiesUrl) {
      delete container.dataset.injectedTrophySig;
      return;
    }

    const link = document.createElement('a');
    link.href = trophyHref;
    link.className = 'injected-trophy';

    const span = document.createElement('span');
    span.className = trophyClass;
    span.title = trophyTitle;
    span.setAttribute('aria-label', trophyTitle);

    const img = document.createElement('img');
    img.src = trophiesUrl;
    img.alt = trophyTitle;

    span.appendChild(img);
    link.appendChild(span);

    const firstTrophy = container.querySelector('a.trophy, a.injected-trophy');
    if (firstTrophy) {
      container.insertBefore(link, firstTrophy);
    } else {
    const firstTrophy = container.querySelector('a.trophy, a.injected-trophy');
    if (firstTrophy) {
      container.insertBefore(link, firstTrophy);
    } else {
      container.prepend(link);
    }
    }

    container.dataset.injectedTrophySig = signature;
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

  function syncPanel() {
    if (!panelEls.master) return;

    panelEls.master.checked = !!settings.enabled;
    panelEls.title.checked = !!settings.changeTitle;
    panelEls.displayName.checked = !!settings.changeDisplayName;
    panelEls.badge.checked = !!settings.showBadge;
    panelEls.flair.checked = !!settings.showFlair;
    panelEls.trophy.checked = !!settings.showTrophy;
    panelEls.body.classList.toggle('is-disabled', !settings.enabled);
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
          <div>Lichess Injector</div>
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

    let collapsed = false;
    toggleButton.addEventListener('click', () => {
      collapsed = !collapsed;
      body.style.display = collapsed ? 'none' : 'grid';
      toggleButton.textContent = collapsed ? '+' : '-';
      toggleButton.setAttribute('aria-label', collapsed ? 'Open panel' : 'Toggle panel');
    });

    document.documentElement.appendChild(panelRoot);
    syncPanel();
  }

  function inject() {
    if (!players.length) return;

    if (!settings.enabled) {
      document.querySelectorAll('.user-link').forEach((el) => {
        if (el.dataset.injectedFor) clearInjected(el);
      });
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
        player.trophiesUrl,
        player.trophyHref,
        player.trophyTitle,
        player.trophyClass,
        settingsSignature()
      ].join('\u0001');

      if (el.dataset.injectedFor === player.id && el.dataset.injectedSig === signature) {
        return;
      }

      if (el.dataset.injectedFor && el.dataset.injectedFor !== player.id) {
        clearInjected(el);
      }

      if (settings.changeDisplayName) {
        replaceName(el, player.displayName);
      } else if (el.dataset.originalName) {
        replaceName(el, '');
      } else {
        replaceName(el, '');
      }

      el.querySelectorAll('.injected-badge').forEach((badge) => badge.remove());
      if (settings.showBadge && settings.changeTitle && player.badge) {
        const wrapper = document.createElement('span');
        wrapper.innerHTML = player.badge;
        const badgeNode = wrapper.firstChild;
        const icon = el.querySelector('i.line');

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

  async function init() {
    createPanel();
    await loadSettings();
    syncPanel();
    await loadData();
    inject();
    observe();
  }

  init();
})();
