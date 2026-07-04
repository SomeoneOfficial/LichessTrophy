(function () {
  'use strict';

  const CSV_URL = 'https://raw.githubusercontent.com/SomeoneOfficial/LichessTrophy/main/People.csv';
  const FALLBACK_CSV_URL = chrome.runtime.getURL('People.csv');

  let players = [];
  let injectScheduled = false;

  function normalizeUser(value) {
    return (value || '').trim().toLowerCase();
  }

  function extractUserFromHref(href) {
    const match = (href || '').match(/\/@\/([^/?#]+)/i);
    if (!match) return '';

    try {
      return normalizeUser(decodeURIComponent(match[1]));
    } catch (e) {
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

  function createBadge(title) {
    if (!title) return '';
    return `<span class="utitle injected-badge" title="${escapeHtml(title)}" style="margin-right:8px;margin-left:2px;display:inline-block;">${escapeHtml(title)}</span>`;
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

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  function loadData() {
    return fetch(CSV_URL, { cache: 'no-store', mode: 'cors' })
      .then((response) => response.text())
      .then((text) => {
        const rows = parseCsv(text);
        if (!rows.length) {
          players = [];
          return;
        }

        const header = rows[0].map((value) => String(value || '').trim().toLowerCase());
        const hasHeader = header.includes('username') || header.includes('name') || header.includes('trophiesurl');
        const indexMap = hasHeader ? getColumnIndexMap(rows[0]) : null;
        const dataRows = hasHeader ? rows.slice(1) : rows;

        players = dataRows
          .map((row) => {
            const name = normalizeUser(readColumn(row, indexMap, ['username', 'name'], 0));
            if (!name) return null;

            const title = (readColumn(row, indexMap, ['title'], 1) || '').trim();
            const displayName = (readColumn(row, indexMap, ['displayname', 'display name'], 2) || '').trim();
            const flair = (readColumn(row, indexMap, ['flair'], 3) || '').trim();
            const trophiesUrl = (readColumn(row, indexMap, ['trophiesurl', 'trophies url', 'trophies'], 4) || '').trim();
            const cleanTitle = !title || title.toLowerCase() === 'title' ? '' : title;

            return {
              name,
              id: name,
              title: cleanTitle,
              displayName,
              flair,
              trophiesUrl,
              badge: createBadge(cleanTitle)
            };
          })
          .filter(Boolean);

        console.log('Loaded players:', players);
      })
      .catch((error) => {
        console.error('CSV load failed, trying local fallback:', error);

        return fetch(FALLBACK_CSV_URL, { cache: 'no-store' })
          .then((response) => response.text())
          .then((text) => {
            const rows = parseCsv(text);
            if (!rows.length) {
              players = [];
              return;
            }

            const header = rows[0].map((value) => String(value || '').trim().toLowerCase());
            const hasHeader = header.includes('username') || header.includes('name') || header.includes('trophiesurl');
            const indexMap = hasHeader ? getColumnIndexMap(rows[0]) : null;
            const dataRows = hasHeader ? rows.slice(1) : rows;

            players = dataRows
              .map((row) => {
                const name = normalizeUser(readColumn(row, indexMap, ['username', 'name'], 0));
                if (!name) return null;

                const title = (readColumn(row, indexMap, ['title'], 1) || '').trim();
                const displayName = (readColumn(row, indexMap, ['displayname', 'display name'], 2) || '').trim();
                const flair = (readColumn(row, indexMap, ['flair'], 3) || '').trim();
                const trophiesUrl = (readColumn(row, indexMap, ['trophiesurl', 'trophies url', 'trophies'], 4) || '').trim();
                const cleanTitle = !title || title.toLowerCase() === 'title' ? '' : title;

                return {
                  name,
                  id: name,
                  title: cleanTitle,
                  displayName,
                  flair,
                  trophiesUrl,
                  badge: createBadge(cleanTitle)
                };
              })
              .filter(Boolean);

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

  function setTrophies(el, trophiesUrl) {
    const container = findTrophiesContainer(el);
    if (!container) return;

    const signature = trophiesUrl || '';
    if (container.dataset.injectedTrophySig === signature) {
      return;
    }

    container.querySelectorAll('img.injected-trophy').forEach((img) => img.remove());
    container.querySelectorAll('a.injected-trophy').forEach((link) => link.remove());
    if (!trophiesUrl) {
      delete container.dataset.injectedTrophySig;
      return;
    }

    const urls = trophiesUrl
      .split('|')
      .map((value) => value.trim())
      .filter(Boolean);

    urls.forEach((url) => {
      const link = document.createElement('a');
      link.className = 'trophy award icon3d injected-trophy';
      link.href = url;
      link.title = 'Custom Trophy';
      link.setAttribute('aria-label', 'Custom Trophy');
      link.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;margin-left:4px;vertical-align:middle;';

      if (/\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(url) || /^data:image\//i.test(url)) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = 'Custom Trophy';
        img.style.cssText = 'display:block;max-height:18px;max-width:18px;';
        link.appendChild(img);
      } else {
        link.textContent = '';
      }

      container.appendChild(link);
    });

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
      container.querySelectorAll('img.injected-trophy').forEach((img) => img.remove());
      container.querySelectorAll('a.injected-trophy').forEach((link) => link.remove());
      delete container.dataset.injectedTrophySig;
    }

    delete el.dataset.originalName;
    delete el.dataset.injectedFor;
    delete el.dataset.injectedSig;
  }

  function inject() {
    if (!players.length) return;

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

      const signature = [player.displayName, player.title, player.flair, player.trophiesUrl].join('\u0001');
      if (el.dataset.injectedFor === player.id && el.dataset.injectedSig === signature) {
        return;
      }

      if (el.dataset.injectedFor && el.dataset.injectedFor !== player.id) {
        clearInjected(el);
      }

      replaceName(el, player.displayName);

      el.querySelectorAll('.injected-badge').forEach((badge) => badge.remove());
      if (player.badge) {
        const wrapper = document.createElement('span');
        wrapper.innerHTML = player.badge;
        const badge = wrapper.firstChild;
        const icon = el.querySelector('i.line');

        if (icon) icon.insertAdjacentElement('afterend', badge);
        else el.prepend(badge);
      }

      setFlair(el, player.flair);
      setTrophies(el, player.trophiesUrl);

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
    await loadData();
    inject();
    observe();
  }

  init();
})();
