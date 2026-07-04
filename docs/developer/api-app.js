(function () {
  'use strict';

  var specEl = document.getElementById('api-spec');
  if (!specEl) return;

  var spec;
  try {
    spec = JSON.parse(specEl.textContent);
  } catch (e) {
    console.error('Failed to parse API spec', e);
    return;
  }

  var groups = spec.groups;
  var endpoints = spec.endpoints;
  var byId = {};
  endpoints.forEach(function (ep) { byId[ep.id] = ep; });

  var navEl = document.getElementById('api-nav');
  var mainEl = document.getElementById('api-main');
  var examplesEl = document.getElementById('api-examples');
  var searchEl = document.getElementById('api-search');
  var countEl = document.getElementById('api-count');

  var activeId = endpoints[0] ? endpoints[0].id : null;
  var reqTab = 'shell';
  var respStatus = '200';

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function methodClass(m) {
    return 'method-badge method-' + m.toLowerCase();
  }

  function buildNav(filter) {
    var q = (filter || '').trim().toLowerCase();
    var visible = 0;
    var html = '';

    groups.forEach(function (g) {
      var items = g.endpointIds.filter(function (id) {
        var ep = byId[id];
        if (!ep) return false;
        if (!q) return true;
        var hay = (ep.keywords + ' ' + ep.title + ' ' + ep.path + ' ' + ep.method + ' ' + g.title).toLowerCase();
        return hay.indexOf(q) !== -1;
      });
      if (!items.length) return;
      html += '<div class="api-nav-group">' + esc(g.title) + '</div>';
      items.forEach(function (id) {
        var ep = byId[id];
        visible++;
        var active = id === activeId ? ' active' : '';
        html += '<button type="button" class="api-nav-item' + active + '" data-id="' + esc(id) + '">';
        html += '<span class="api-nav-label">' + esc(ep.navLabel || ep.title) + '</span>';
        html += '<span class="' + methodClass(ep.method) + '">' + esc(ep.method) + '</span>';
        html += '</button>';
      });
    });

    navEl.innerHTML = html || '<p class="api-nav-empty">No endpoints match.</p>';
    countEl.textContent = q ? visible + ' of ' + endpoints.length : endpoints.length + ' endpoints';
  }

  function paramSection(title, params) {
    if (!params || !params.length) return '';
    var rows = params.map(function (p) {
      var pills = (p.constraints || []).map(function (c) {
        return '<span class="param-pill">' + esc(c) + '</span>';
      }).join('');
      if (p.required) pills = '<span class="param-pill param-pill-req">Required</span>' + pills;
      var def = p.default != null ? ' <span class="param-default">default: ' + esc(String(p.default)) + '</span>' : '';
      return (
        '<div class="api-param">' +
        '<div class="api-param-head">' +
        '<code class="api-param-name">' + esc(p.name) + '</code>' +
        '<span class="api-param-type">' + esc(p.type) + def + '</span>' +
        '</div>' +
        '<p class="api-param-desc">' + p.description + '</p>' +
        (pills ? '<div class="api-param-pills">' + pills + '</div>' : '') +
        '</div>'
      );
    }).join('');
    return '<section class="api-section"><h3>' + esc(title) + '</h3>' + rows + '</section>';
  }

  function schemaBlock(schema, depth) {
    depth = depth || 0;
    if (!schema) return '';
    if (schema.type === 'object' && schema.properties) {
      var keys = Object.keys(schema.properties);
      var inner = keys.map(function (k) {
        var prop = schema.properties[k];
        var typeStr = prop.type || 'any';
        if (prop.items) typeStr += '[]';
        return (
          '<div class="schema-prop">' +
          '<code>' + esc(k) + '</code> <span class="schema-type">' + esc(typeStr) + '</span>' +
          (prop.description ? '<span class="schema-desc">' + esc(prop.description) + '</span>' : '') +
          schemaBlock(prop, depth + 1) +
          '</div>'
        );
      }).join('');
      var open = depth === 0 ? ' open' : '';
      return '<details class="schema-details"' + open + '><summary>Show properties</summary>' + inner + '</details>';
    }
    return '';
  }

  function renderMain(ep) {
    var resp = ep.responses.find(function (r) { return String(r.status) === respStatus; }) || ep.responses[0];
    var respHtml = '';
    if (resp) {
      respHtml =
        '<section class="api-section api-response-section">' +
        '<h3>Response</h3>' +
        '<div class="response-meta">' +
        '<select id="resp-status-select" class="response-status-select" aria-label="Response status">';
      ep.responses.forEach(function (r) {
        var sel = String(r.status) === respStatus ? ' selected' : '';
        respHtml += '<option value="' + r.status + '"' + sel + '>' + r.status + '</option>';
      });
      respHtml += '</select>' +
        '<span class="response-content-type">' + esc(resp.contentType || 'application/json') + '</span>' +
        '</div>' +
        '<p class="response-desc">' + esc(resp.description) + '</p>' +
        schemaBlock(resp.schema) +
        '</section>';
    }

    return (
      '<header class="api-endpoint-header">' +
      '<span class="' + methodClass(ep.method) + ' api-method-lg">' + esc(ep.method) + '</span>' +
      '<code class="api-path-lg">' + esc(ep.path) + '</code>' +
      '</header>' +
      '<h2 class="api-endpoint-title">' + esc(ep.title) + '</h2>' +
      '<p class="api-endpoint-desc">' + ep.description + '</p>' +
      (ep.auth === 'exempt'
        ? '<p class="api-auth-note"><span class="param-pill param-pill-auth">Auth exempt</span></p>'
        : '<p class="api-auth-note"><span class="param-pill">Bearer token when <code>CELLSEER_API_TOKEN</code> is set</span></p>') +
      paramSection('Path parameters', ep.pathParams) +
      paramSection('Query parameters', ep.queryParams) +
      paramSection('Request body (JSON)', ep.bodyParams) +
      paramSection('Request body (multipart/form-data)', ep.formParams) +
      respHtml +
      (ep.legacy ? '<p class="api-legacy-note">' + ep.legacy + '</p>' : '')
    );
  }

  function highlightJson(obj) {
    var json = JSON.stringify(obj, null, 2);
    return json
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/(^\s*"(\\.|[^"\\])*")(\s*:)/gm, '<span class="json-key">$1</span>$3')
      .replace(/:\s*("(\\.|[^"\\])*")/g, ': <span class="json-str">$1</span>')
      .replace(/:\s*(-?\d+\.?\d*(?:e[+-]?\d+)?)/gi, ': <span class="json-num">$1</span>')
      .replace(/:\s*(true|false|null)/g, ': <span class="json-lit">$1</span>');
  }

  function renderExamples(ep) {
    var req = ep.examples.request;
    var resp = ep.responses.find(function (r) { return String(r.status) === respStatus; }) || ep.responses[0];
    var respEx = ep.examples.responses[String(resp.status)] || resp.example;

    var reqTabs = ['shell', 'javascript', 'python'].map(function (t) {
      var active = t === reqTab ? ' active' : '';
      return '<button type="button" class="example-tab' + active + '" data-req-tab="' + t + '">' + t + '</button>';
    }).join('');

    var respTabs = ep.responses.map(function (r) {
      var active = String(r.status) === respStatus ? ' active' : '';
      return '<button type="button" class="example-tab example-tab-sm' + active + '" data-resp-tab="' + r.status + '">' + r.status + '</button>';
    }).join('');

    return (
      '<div class="example-block">' +
      '<div class="example-block-head"><h4>Example request</h4></div>' +
      '<div class="example-tabs" role="tablist">' + reqTabs + '</div>' +
      '<div class="example-code-wrap">' +
      '<button type="button" class="copy-btn" data-copy="req" aria-label="Copy request">Copy</button>' +
      '<pre class="example-code" id="example-req"><code>' + esc(req[reqTab]) + '</code></pre>' +
      '</div>' +
      '</div>' +
      '<div class="example-block">' +
      '<div class="example-block-head"><h4>Example response</h4>' +
      '<div class="example-tabs example-tabs-sm" role="tablist">' + respTabs + '</div></div>' +
      '<div class="example-code-wrap">' +
      '<button type="button" class="copy-btn" data-copy="resp" aria-label="Copy response">Copy</button>' +
      '<pre class="example-code example-json" id="example-resp"><code>' + highlightJson(respEx) + '</code></pre>' +
      '</div>' +
      '</div>'
    );
  }

  function selectEndpoint(id, push) {
    if (!byId[id]) return;
    activeId = id;
    respStatus = '200';
    var ep = byId[id];
    if (!ep.responses.some(function (r) { return String(r.status) === '200'; })) {
      respStatus = String(ep.responses[0].status);
    }
    mainEl.innerHTML = renderMain(ep);
    examplesEl.innerHTML = renderExamples(ep);
    buildNav(searchEl.value);
    if (push !== false) {
      history.replaceState(null, '', '#' + id);
    }
    var activeBtn = navEl.querySelector('.api-nav-item.active');
    if (activeBtn) activeBtn.scrollIntoView({ block: 'nearest' });
  }

  function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(function () {
      var orig = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = orig; }, 1500);
    }).catch(function () {});
  }

  navEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.api-nav-item');
    if (!btn) return;
    selectEndpoint(btn.getAttribute('data-id'));
  });

  searchEl.addEventListener('input', function () {
    buildNav(searchEl.value);
  });

  mainEl.addEventListener('change', function (e) {
    if (e.target.id === 'resp-status-select') {
      respStatus = e.target.value;
      var ep = byId[activeId];
      mainEl.innerHTML = renderMain(ep);
      examplesEl.innerHTML = renderExamples(ep);
    }
  });

  examplesEl.addEventListener('click', function (e) {
    var ep = byId[activeId];
    if (!ep) return;

    var reqTabBtn = e.target.closest('[data-req-tab]');
    if (reqTabBtn) {
      reqTab = reqTabBtn.getAttribute('data-req-tab');
      examplesEl.innerHTML = renderExamples(ep);
      return;
    }

    var respTabBtn = e.target.closest('[data-resp-tab]');
    if (respTabBtn) {
      respStatus = respTabBtn.getAttribute('data-resp-tab');
      mainEl.innerHTML = renderMain(ep);
      examplesEl.innerHTML = renderExamples(ep);
      return;
    }

    var copyBtn = e.target.closest('.copy-btn');
    if (copyBtn) {
      var kind = copyBtn.getAttribute('data-copy');
      if (kind === 'req') {
        copyText(ep.examples.request[reqTab], copyBtn);
      } else {
        var resp = ep.responses.find(function (r) { return String(r.status) === respStatus; }) || ep.responses[0];
        var ex = ep.examples.responses[String(resp.status)] || resp.example;
        copyText(JSON.stringify(ex, null, 2), copyBtn);
      }
    }
  });

  var hash = location.hash.replace(/^#/, '');
  if (hash && byId[hash]) {
    selectEndpoint(hash, false);
  } else if (endpoints[0]) {
    selectEndpoint(endpoints[0].id, false);
  }

  window.addEventListener('hashchange', function () {
    var id = location.hash.replace(/^#/, '');
    if (id && byId[id] && id !== activeId) selectEndpoint(id, false);
  });
})();
