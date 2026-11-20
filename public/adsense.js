/**
 * Reusable, UX-First Google AdSense Component Manager
 * - Injects the official AdSense script at most once
 * - Validates publisherId and slotIds strictly before initializing
 * - Prevents duplicate ad pushes and suppresses errors from ad blockers
 * - Collapses slots cleanly when disabled, unconfigured, narrow, or unfilled
 */
(function initPlayGtaAdSense() {
  const PUB_ID_RE = /^ca-pub-\d{16}$/;
  const SLOT_ID_RE = /^\d{6,20}$/;

  const SLOT_CONTAINERS = {
    top: 'ad-slot-top',
    bottom: 'ad-slot-bottom',
    left: 'ad-slot-left',
    right: 'ad-slot-right',
  };

  function isValidPublisherId(id) {
    return typeof id === 'string' && PUB_ID_RE.test(id.trim());
  }

  function isValidSlotId(id) {
    return typeof id === 'string' && SLOT_ID_RE.test(id.trim());
  }

  function loadAdSenseScriptOnce(publisherId) {
    if (window.__playgtaAdSenseScriptInjected) return true;
    const existing = document.querySelector('script[data-playgta-adsense="true"]');
    if (existing) {
      window.__playgtaAdSenseScriptInjected = true;
      return true;
    }

    try {
      const script = document.createElement('script');
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(
        publisherId.trim()
      )}`;
      script.dataset.playgtaAdsense = 'true';
      script.onerror = function () {
        // Silently degrade if blocked by browser privacy tools or offline
      };
      document.head.appendChild(script);
      window.__playgtaAdSenseScriptInjected = true;
      return true;
    } catch {
      return false;
    }
  }

  function hideSlot(container) {
    if (!container) return;
    container.hidden = true;
    container.setAttribute('aria-hidden', 'true');
  }

  function showSlot(container) {
    if (!container) return;
    container.hidden = false;
    container.removeAttribute('aria-hidden');
  }

  function createAdUnit(container, { publisherId, posConfig, positionKey }) {
    const isSidebar = positionKey === 'left' || positionKey === 'right';
    const existingIns = container.querySelector('ins.adsbygoogle');

    if (existingIns) {
      showSlot(container);
      return;
    }

    const card = document.createElement('div');
    card.className = `ad-slot-card ${isSidebar ? 'ad-slot-sidebar-card' : 'ad-slot-banner-card'}`;

    const label = document.createElement('div');
    label.className = 'ad-label';
    label.textContent = 'Advertisement';

    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.setAttribute('data-ad-client', publisherId.trim());
    ins.setAttribute('data-ad-slot', String(posConfig.slotId).trim());
    ins.setAttribute('data-ad-format', posConfig.format || 'auto');
    if (posConfig.fullWidthResponsive) {
      ins.setAttribute('data-full-width-responsive', 'true');
    }

    card.appendChild(label);
    card.appendChild(ins);
    container.innerHTML = '';
    container.appendChild(card);
    showSlot(container);

    // Hide gracefully if AdSense marks the slot as unfilled
    if (typeof MutationObserver === 'function') {
      const observer = new MutationObserver(() => {
        if (ins.getAttribute('data-ad-status') === 'unfilled') {
          hideSlot(container);
          observer.disconnect();
        }
      });
      observer.observe(ins, { attributes: true, attributeFilter: ['data-ad-status'] });
    }

    if (!ins.dataset.adsInitialized) {
      ins.dataset.adsInitialized = '1';
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch {
        hideSlot(container);
      }
    }
  }

  function syncAdPlacements() {
    const cfg = window.ADSENSE_CONFIG;
    if (!cfg || cfg.enabled !== true || !isValidPublisherId(cfg.publisherId)) {
      Object.values(SLOT_CONTAINERS).forEach((id) => hideSlot(document.getElementById(id)));
      return;
    }

    const breakpoint = Number(cfg.sidebarBreakpointPx) || 1340;
    const isDesktopWide = window.innerWidth >= breakpoint;
    const positions = cfg.positions || {};

    let anyActive = false;
    const eligible = [];

    for (const [key, containerId] of Object.entries(SLOT_CONTAINERS)) {
      const container = document.getElementById(containerId);
      const posCfg = positions[key];
      const isSidebar = key === 'left' || key === 'right';

      if (!container || !posCfg || posCfg.enabled !== true || !isValidSlotId(posCfg.slotId)) {
        hideSlot(container);
        continue;
      }

      if (isSidebar && !isDesktopWide) {
        hideSlot(container);
        continue;
      }

      anyActive = true;
      eligible.push({ container, posCfg, key });
    }

    const shell = document.getElementById('page-shell');
    if (shell) {
      const hasLeft = eligible.some((e) => e.key === 'left');
      const hasRight = eligible.some((e) => e.key === 'right');
      shell.classList.toggle('has-sidebars', hasLeft || hasRight);
    }

    if (!anyActive) return;

    loadAdSenseScriptOnce(cfg.publisherId);
    eligible.forEach(({ container, posCfg, key }) => {
      createAdUnit(container, {
        publisherId: cfg.publisherId,
        posConfig: posCfg,
        positionKey: key,
      });
    });
  }

  function setup() {
    syncAdPlacements();

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(syncAdPlacements, 150);
    });
  }

  window.PlayGtaAdSense = {
    sync: syncAdPlacements,
    isValidPublisherId,
    isValidSlotId,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup, { once: true });
  } else {
    setup();
  }
})();
