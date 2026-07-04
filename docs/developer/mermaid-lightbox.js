/**
 * Click-to-enlarge lightbox for Mermaid diagrams.
 * Load after mermaid.min.js and mermaid-init.js.
 */
(function () {
  'use strict';

  var MODAL_ID = 'mermaid-lightbox-modal';
  var lastFocus = null;

  function getDiagramSvg(wrap) {
    return wrap.querySelector('svg');
  }

  function prepareSvgClone(svg) {
    var clone = svg.cloneNode(true);
    clone.removeAttribute('width');
    clone.removeAttribute('height');
    clone.removeAttribute('style');
    clone.setAttribute('class', (clone.getAttribute('class') || '') + ' mermaid-lightbox__svg');
    clone.setAttribute('role', 'img');
    clone.setAttribute('aria-label', 'Enlarged diagram');
    return clone;
  }

  function getCaption(wrap) {
    var cap = wrap.querySelector('.caption');
    return cap ? cap.textContent.trim() : '';
  }

  function closeLightbox() {
    var modal = document.getElementById(MODAL_ID);
    if (modal) {
      modal.remove();
      document.body.classList.remove('mermaid-lightbox-open');
    }
    document.removeEventListener('keydown', onKeydown);
    if (lastFocus && typeof lastFocus.focus === 'function') {
      lastFocus.focus();
    }
    lastFocus = null;
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeLightbox();
    }
  }

  function openLightbox(wrap) {
    var svg = getDiagramSvg(wrap);
    if (!svg || document.getElementById(MODAL_ID)) return;

    lastFocus = document.activeElement;

    var modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'mermaid-lightbox';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Enlarged diagram');

    var backdrop = document.createElement('div');
    backdrop.className = 'mermaid-lightbox__backdrop';
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) {
        closeLightbox();
      }
    });

    var panel = document.createElement('div');
    panel.className = 'mermaid-lightbox__panel';

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'mermaid-lightbox__close';
    closeBtn.setAttribute('aria-label', 'Close enlarged diagram');
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', closeLightbox);

    var canvas = document.createElement('div');
    canvas.className = 'mermaid-lightbox__canvas';
    canvas.appendChild(prepareSvgClone(svg));

    panel.appendChild(closeBtn);
    panel.appendChild(canvas);

    var caption = getCaption(wrap);
    if (caption) {
      var capEl = document.createElement('p');
      capEl.className = 'mermaid-lightbox__caption';
      capEl.textContent = caption;
      panel.appendChild(capEl);
    }

    backdrop.appendChild(panel);
    modal.appendChild(backdrop);
    document.body.appendChild(modal);
    document.body.classList.add('mermaid-lightbox-open');
    document.addEventListener('keydown', onKeydown);

    closeBtn.focus();
  }

  function bindWrap(wrap) {
    if (wrap.dataset.mermaidLightbox === '1') return;
    if (!getDiagramSvg(wrap)) return;

    wrap.dataset.mermaidLightbox = '1';
    wrap.classList.add('mermaid-wrap--zoomable');
    wrap.setAttribute('tabindex', '0');
    wrap.setAttribute('role', 'button');
    wrap.setAttribute('aria-label', 'Diagram — click to enlarge');

    wrap.addEventListener('click', function () {
      openLightbox(wrap);
    });
    wrap.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openLightbox(wrap);
      }
    });
  }

  function scan() {
    document.querySelectorAll('.mermaid-wrap').forEach(bindWrap);
  }

  function observe() {
    var observer = new MutationObserver(scan);

    document.querySelectorAll('.mermaid-wrap').forEach(function (wrap) {
      observer.observe(wrap, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-processed'],
      });
    });

    scan();
    window.addEventListener('load', scan);
    setTimeout(scan, 300);
    setTimeout(scan, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observe);
  } else {
    observe();
  }
})();
