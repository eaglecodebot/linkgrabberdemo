(() => {
  if (globalThis.PrivateWorkflow) return;
  const normalize = text => String(text || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  const metrics = {queries: 0, scrolls: 0};
  const revealSpaces = new WeakMap();
  function query(css, scopes = [document]) { metrics.queries++; return scopes.flatMap(root => [...root.querySelectorAll(css)]); }
  function targetRoots(step) {
    // Captured context is exact. An empty context means the main document.
    if (!Object.hasOwn(step, 'context')) return {scopes: [document]};
    let scopes = [document];
    for (const part of step.context) {
      const matches = query(part.css, scopes).filter(visible);
      if (matches.length !== 1) return {scopes: [], reason: matches.length > 1 ? 'Multiple matching frames or shadow hosts. Waiting for one clear context.' : 'Waiting for the captured embedded page.'};
      if (part.kind === 'frame') {
        let doc;
        try { doc = matches[0].contentDocument; } catch {}
        if (!doc || doc.readyState === 'loading') return {scopes: [], reason: 'Waiting for the embedded page DOM or access to that page.'};
        scopes = [doc];
      } else if (part.kind === 'shadow') {
        if (!matches[0].shadowRoot) return {scopes: [], reason: 'Waiting for the captured shadow root.'};
        scopes = [matches[0].shadowRoot];
      } else throw new Error('Unknown captured element context.');
    }
    return {scopes};
  }
  function visible(el) {
    if (!el?.isConnected || !el.getClientRects().length) return false;
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.display !== 'none';
  }
  function proxy(el) {
    if (el?.matches('input[type="radio"], input[type="checkbox"]')) {
      const label = [...(el.labels || [])].find(visible);
      if (label) return label;
    }
    if (visible(el)) return el;
    return null;
  }
  function ready(el) { return Boolean(proxy(el) && !el.matches(':disabled, [disabled]') && !el.readOnly && !el.closest('[aria-disabled="true"], [aria-busy="true"], [inert]')); }
  function actionTarget(el) { return el.closest('a,button,[role="button"],label') || el; }
  function labelsFor(el) {
    const associated = [...(el.labels || [])].map(l => normalize(l.innerText || l.textContent));
    const labelled = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => normalize(el.ownerDocument.getElementById(id)?.textContent)).filter(Boolean).join(' ');
    return [...associated, normalize(el.getAttribute('aria-label')), labelled].filter(Boolean);
  }
  function postal(scopes) {
    // The real Pin code field can mount after another text field. Only use
    // explicit postal semantics inside the captured UPI form; a unique field
    // or a Zip code elsewhere on the page is not evidence of the right target.
    const save = query('[data-test-save-upi-button]', scopes).filter(visible);
    const areas = save.map(button => button.closest('form') || button.closest('[data-test-upi-form], .default-accordion-item, section')).filter(Boolean);
    if (!areas.length) return [];
    const fields = query('input:not([type="hidden"]), textarea', scopes).filter(el => ['text', 'tel', 'number', ''].includes(el.type || '') && proxy(el) && areas.some(area => area.contains(el)));
    return fields.filter(el => {
      const label = [...(el.labels || [])].map(l => l.textContent).join(' ');
      const labelled = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => el.ownerDocument.getElementById(id)?.textContent || '').join(' ');
      return /postal|pin\s*code|pincode|zip\b/i.test([el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.autocomplete === 'postal-code' ? 'postal' : '', label, labelled].join(' '));
    });
  }
  function checkoutState(step = {}) {
    const {scopes} = targetRoots(step); if (!scopes.length) return {busy: false, error: false};
    // Restrict this to the payment area. A chat-widget spinner or alert must
    // not block checkout, and no page text is returned or stored.
    let areas = step.checkoutScope === 'upi'
      ? [...new Set(query('[data-test-save-upi-button]', scopes).filter(canReveal).map(el => el.closest('form, [data-test-upi-form], .default-accordion-item') || el.parentElement).filter(Boolean))]
      : query('.checkout-container, [data-test-checkout-container]', scopes).filter(canReveal);
    if (!areas.length) {
      const anchors = query('[data-test-save-upi-button], [data-test-place-order-btn], img[data-test-upi-processing-upi-qr-code-image]', scopes).filter(canReveal);
      areas = [...new Set(anchors.map(el => el.closest('main, [role="main"], form') || el.parentElement).filter(Boolean))];
    }
    if (!areas.length) areas = query('main, [role="main"]', scopes).filter(canReveal);
    if (!areas.length) return {busy: false, error: false};
    const shown = el => {
      if (!visible(el) || !canReveal(el)) return false;
      for (let node=el;node;node=parent(node)) if (Number(node.ownerDocument.defaultView.getComputedStyle(node).opacity)===0) return false;
      return true;
    };
    const busySelector = '[aria-busy="true"], [role="progressbar"]:not([aria-valuenow]), progress:not([value]), .artdeco-loader';
    const busy = areas.some(el => el.matches(busySelector) && shown(el)) || query(busySelector, areas).some(shown);
    const alerts = query('[role="alert"], [aria-invalid="true"], .artdeco-inline-feedback--error, [data-test-payment-error], [data-test-checkout-error]', areas).filter(shown);
    const error = alerts.some(el => el.matches('[aria-invalid="true"]') || Boolean(normalize(el.innerText || el.textContent)) &&
      (el.matches('.artdeco-inline-feedback--error, [data-test-payment-error], [data-test-checkout-error]') ||
      /(?:payment|transaction|checkout|upi|purchase|order|billing|bank|pin\s*code).*(?:error|fail|declin|unable|cannot|couldn.t|could not|not available|not complete|invalid)|(?:unable|cannot|couldn.t|could not|failed).*(?:payment|transaction|checkout|purchase|order)|something went wrong|try again/i.test(normalize(el.innerText || el.textContent))));
    return {busy, error};
  }
  function resolve(step, task = {}, {includeUnready = false} = {}) {
    try {
      if (!step) return {element: null, reason: ''};
      if (step.afterNavigation && !task.navigationChanged) return {element: null, blocked: true, reason: 'Waiting for the QR page after the last click.'};
      const {scopes, reason} = targetRoots(step);
      if (!scopes.length) return {element: null, reason};
      if (task.transitionAt && Date.now() - task.transitionAt < (step.afterPreviousMilliseconds || 0)) return {element: null, blocked: true, reason: step.settleMessage || `Waiting for the page to settle before ${step.title}.`};
      if (step.checkoutGuard && !includeUnready) {
        const state = checkoutState(step);
        if (state.error) return {element: null, blocked: true, reason: 'The checkout shows an error or invalid field. Check the payment page.'};
        if (state.busy) return {element: null, blocked: true, reason: 'Waiting for checkout to finish saving or processing.'};
      }
      for (const css of step.waitForHidden || []) {
        if (query(css, scopes).some(visible)) return {element: null, blocked: true, reason: 'Waiting for the payment details to finish saving before the final action.'};
      }
      const locators = step.id === 'pincode' && task.pincodeSelector ? [{css: task.pincodeSelector}] : step.locators;
      let scrollTarget, waitingReason;
      for (const locator of locators || []) {
        // A page-level fallback must not escape an existing Individual dialog
        // just because that dialog's button has changed or is still loading.
        if (locator.unlessVisible && query(locator.unlessVisible, scopes).some(canReveal)) continue;
        let candidates = locator.semantic === 'postal' ? postal(scopes) : query(locator.css, scopes);
        if (locator.label) candidates = candidates.filter(el => labelsFor(el).includes(normalize(locator.label)));
        if (locator.text) candidates = candidates.filter(el => normalize(el.innerText || el.textContent) === normalize(locator.text));
        if (locator.textAny) {
          const accepted = new Set(locator.textAny.map(normalize));
          candidates = candidates.filter(el => accepted.has(normalize(el.innerText || el.textContent)));
        }
        candidates = candidates.map(el => locator.closest ? el.closest(locator.closest) : step.action === 'click' ? actionTarget(el) : el).filter(Boolean);
        candidates = [...new Set(candidates)];
        if (step.action === 'type') candidates = candidates.filter(el => el.matches('input:not([type="hidden"]), textarea, [contenteditable="true"]'));
        // Keep an identified plan CTA while it is busy; a broader fallback
        // must not substitute an unrelated enabled Submit/Redeem control.
        if (locator.authoritative) {
          const identified = candidates.filter(canReveal);
          if (identified.length > 1) return {element: null, blocked: true, reason: `Action ${task.index + 1}: multiple matching controls. Waiting for one clear match.`};
          if (identified.length === 1 && !includeUnready && !ready(identified[0])) return {element: null, blocked: true, scrollTarget: identified[0], reason: `Waiting for ${step.title}: the control is disabled, busy, or not editable yet.`};
        }
        if (candidates.length === 1 && canReveal(candidates[0])) {
          scrollTarget ||= candidates[0];
          if (!ready(candidates[0])) waitingReason = `Waiting for ${step.title}: the control is disabled, busy, or not editable yet.`;
        }
        candidates = candidates.filter(includeUnready ? el => Boolean(proxy(el)) : ready);
        if (candidates.length === 1) {
          const element = candidates[0];
          if (step.action === 'reveal' && element.matches('img') && (!element.complete || !element.naturalWidth || !element.naturalHeight)) return {element: null, scrollTarget: element, reason: 'Waiting for the QR code image to load.'};
          return {element, reason: ''};
        }
        if (candidates.length > 1) return {element: null, blocked: true, reason: `Action ${task.index + 1}: multiple matching controls. Waiting for one clear match.`};
      }
      return {element: null, scrollTarget, missing: !scrollTarget, reason: waitingReason || (step.id === 'pincode' ? 'Waiting for the captured Pin code field.' : `Waiting for the control: ${step.title}.`)};
    } catch (e) { return {element: null, reason: `Selector error: ${e.message}`}; }
  }
  function parent(el) { return el.parentElement || el.getRootNode()?.host || null; }
  function revealTarget(el) { return proxy(el) || (el?.matches('input[type="radio"], input[type="checkbox"]') && [...(el.labels || [])][0]) || el; }
  function canReveal(el) {
    let node = revealTarget(el);
    if (!node?.isConnected || node.matches('input[type="hidden"]')) return false;
    for (let i = 0; node && i < 60; i++, node = parent(node)) {
      const style = node.ownerDocument.defaultView.getComputedStyle(node);
      if (node.hidden || node.inert || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }
    return true;
  }
  function postcondition(step, task) {
    const {element: el} = resolve(step, task, {includeUnready: true}); if (!el) return false;
    if (step.action === 'radio') return el.checked === true;
    if (step.action === 'check') return el.checked === true;
    if (step.action === 'choice') { const input = el.control || (el.htmlFor && el.ownerDocument.getElementById(el.htmlFor)); return input?.checked === true; }
    if (step.action === 'expand') return el.getAttribute('aria-expanded') === 'true';
    if (step.action === 'type') return (el.isContentEditable ? el.textContent : el.value) === task.values[step.valueFrom] && (!el.validity || el.validity.valid);
    if (step.action === 'reveal') return revealVisible(el);
    return false;
  }
  function scrollIntoView(el, center = false) {
    const target = revealTarget(el); if (!target || !canReveal(el)) return;
    metrics.scrolls++;
    target.scrollIntoView({block: 'center', inline: center ? 'center' : 'nearest', behavior: 'instant'});
    let view = target.ownerDocument.defaultView;
    for (let i = 0; i < 20; i++) {
      let frame; try { frame = view.frameElement; } catch { break; }
      if (!frame) break;
      frame.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'});
      view = frame.ownerDocument.defaultView;
    }
  }
  function centerOnScreen(el) {
    scrollIntoView(el, true);
    const doc = el.ownerDocument, view = doc.defaultView, root = doc.scrollingElement;
    // A QR near the document's end otherwise stops above the requested center
    // because the browser clamps scrolling. Add only the missing empty space
    // below the page. It contains no QR data and disappears on navigation.
    let nested = false;
    for (let node = parent(el); node && node !== doc.body && node !== root; node = parent(node)) {
      const style = view.getComputedStyle(node);
      if (['fixed', 'sticky'].includes(style.position) || (/auto|scroll|hidden|clip/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 2)) {nested = true;break;}
    }
    if (nested || !root || root.scrollHeight <= root.clientHeight + 2) return;
    for (let attempt = 0; attempt < 2; attempt++) {
      const rect = el.getBoundingClientRect(), remaining = rect.top + rect.height / 2 - view.innerHeight / 2;
      if (remaining <= 3 || rect.height > view.innerHeight - 24 || root.scrollTop < root.scrollHeight - root.clientHeight - 3) break;
      let space = revealSpaces.get(doc);
      if (!space?.isConnected) {
        space = doc.createElement('div'); space.setAttribute('aria-hidden', 'true');
        space.setAttribute('data-private-workflow-qr-space', '');
        space.style.cssText = 'display:block!important;flex:none!important;width:1px!important;margin:0!important;padding:0!important;border:0!important;pointer-events:none!important;';
        doc.body.append(space); revealSpaces.set(doc, space);
      }
      const height = (parseFloat(space.style.height) || 0) + Math.ceil(remaining);
      space.style.setProperty('height', `${height}px`, 'important');
      space.style.setProperty('min-height', `${height}px`, 'important');
      scrollIntoView(el, true);
    }
  }
  function revealVisible(el) {
    const target = proxy(el); if (!target) return false;
    const doc = target.ownerDocument, view = doc.defaultView, rect = target.getBoundingClientRect();
    if (rect.top < -2 || rect.left < -2 || rect.bottom > view.innerHeight + 2 || rect.right > view.innerWidth + 2) return false;
    for (let node = target, i = 0; node && i < 60; node = parent(node), i++) {
      const style = view.getComputedStyle(node); if (Number(style.opacity) === 0) return false;
      if (node === target) continue;
      const box = node.getBoundingClientRect();
      if (/auto|scroll|hidden|clip/.test(style.overflowX) && (rect.left < box.left - 2 || rect.right > box.right + 2)) return false;
      if (/auto|scroll|hidden|clip/.test(style.overflowY) && (rect.top < box.top - 2 || rect.bottom > box.bottom + 2)) return false;
    }
    const points = [[rect.left + rect.width / 2, rect.top + rect.height / 2], [rect.left + 3, rect.top + 3], [rect.right - 3, rect.top + 3], [rect.left + 3, rect.bottom - 3], [rect.right - 3, rect.bottom - 3]];
    const nonInteractive = view.getComputedStyle(target).pointerEvents === 'none';
    return points.every(([x,y]) => {
      let hit = doc.elementFromPoint(x,y);
      while (hit?.shadowRoot) {const next = hit.shadowRoot.elementFromPoint(x,y);if (!next || next === hit) break;hit = next;}
      return hit && (hit === target || target.contains(hit) || (nonInteractive && hit.contains(target)));
    });
  }
  function unobstructed(el) {
    const target = proxy(el); if (!target) return false;
    const point = pointFor(el); if (!point) return false;
    const win = target.ownerDocument.defaultView;
    let {x, y} = point;
    let hit = target.ownerDocument.elementFromPoint(x, y);
    while (hit?.shadowRoot) { const deeper = hit.shadowRoot.elementFromPoint(x, y); if (!deeper || deeper === hit) break; hit = deeper; }
    if (!hit || !(hit === target || target.contains(hit) || (el.matches('input') && hit === el))) return false;
    // A control inside an iframe can be uncovered in its own document while a
    // modal in the parent page covers the entire frame. Check each ancestor.
    let view = win;
    for (let i = 0; i < 20; i++) {
      let frame; try { frame = view.frameElement; } catch { return false; }
      if (!frame) return true;
      if (!visible(frame)) return false;
      const box = frame.getBoundingClientRect();
      const scaleX = frame.offsetWidth ? box.width / frame.offsetWidth : 1;
      const scaleY = frame.offsetHeight ? box.height / frame.offsetHeight : 1;
      x = box.left + (frame.clientLeft + x) * scaleX;
      y = box.top + (frame.clientTop + y) * scaleY;
      const parentHit = frame.ownerDocument.elementFromPoint(x, y);
      if (parentHit !== frame) return false;
      view = frame.ownerDocument.defaultView;
    }
    return false;
  }
  function perform(step, task, el) {
    if (step.action === 'reveal') { centerOnScreen(el); return postcondition(step, task); }
    const checkoutBlocked = () => {if (!step.checkoutGuard) return false;const state = checkoutState(step);return state.busy || state.error;};
    if (checkoutBlocked()) return false;
    if (!ready(el) || !unobstructed(el)) return false;
    const blocked = submitBlock(el); if (blocked) throw new Error(blocked);
    if (step.action !== 'click' && postcondition(step, task)) return true;
    if (step.action === 'type') {
      const value = task.values[step.valueFrom]; el.focus();
      if (!ready(el) || !unobstructed(el)) return false;
      if (el.isContentEditable) el.textContent = value;
      else {
        const view = el.ownerDocument.defaultView;
        const proto = el.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      }
      const view = el.ownerDocument.defaultView;
      el.dispatchEvent(new view.InputEvent('input', {bubbles: true, composed: true, inputType: 'insertText', data: value}));
      el.dispatchEvent(new view.Event('change', {bubbles: true})); el.blur();
    } else {
      el.focus?.({preventScroll: true});
      // Focus handlers can synchronously disable or replace a checkout CTA.
      // Return false only before dispatching anything, so the caller can wait.
      if (!ready(el) || !unobstructed(el) || submitBlock(el) || checkoutBlocked()) return false;
      const target = step.sameTab && el.matches('a') ? el.getAttribute('target') : undefined;
      if (target !== undefined) el.setAttribute('target', '_self');
      try {el.click();} finally {if (target !== undefined) {if (target === null) el.removeAttribute('target');else el.setAttribute('target', target);}}
    }
    return true;
  }
  function inspectFrame(prefix, css) {
    const {scopes, reason} = targetRoots({context: prefix});
    if (!scopes.length) return {elements: [], count: 0, visibleCount: 0, ready: false, reason};
    const elements = query(css, scopes);
    return {elements, count: elements.length, visibleCount: elements.filter(visible).length, ready: document.readyState !== 'loading'};
  }
  function childPoint(prefix, css, point) {
    const info = inspectFrame(prefix, css);
    if (info.count !== 1 || info.visibleCount !== 1) return {clear: false};
    const frame = info.elements[0], rect = frame.getBoundingClientRect();
    const sx = frame.offsetWidth ? rect.width / frame.offsetWidth : 1, sy = frame.offsetHeight ? rect.height / frame.offsetHeight : 1;
    const x = rect.left + (frame.clientLeft + point.x) * sx, y = rect.top + (frame.clientTop + point.y) * sy;
    let hit = frame.ownerDocument.elementFromPoint(x, y);
    while (hit?.shadowRoot) { const next = hit.shadowRoot.elementFromPoint(x, y); if (!next || next === hit) break; hit = next; }
    return {clear: hit === frame, point: {x, y}};
  }
  function pointFor(el) {
    const target = proxy(el); if (!target) return null;
    const win = target.ownerDocument.defaultView, r = target.getBoundingClientRect();
    let left = Math.max(0, r.left), top = Math.max(0, r.top), right = Math.min(win.innerWidth, r.right), bottom = Math.min(win.innerHeight, r.bottom);
    for (let node = parent(target), i = 0; node && i < 60; node = parent(node), i++) {
      const style = win.getComputedStyle(node), box = node.getBoundingClientRect();
      const sx = node.offsetWidth ? box.width / node.offsetWidth : 1, sy = node.offsetHeight ? box.height / node.offsetHeight : 1;
      if (/auto|scroll|hidden|clip/.test(style.overflowX)) { left = Math.max(left, box.left + node.clientLeft * sx); right = Math.min(right, box.left + (node.clientLeft + node.clientWidth) * sx); }
      if (/auto|scroll|hidden|clip/.test(style.overflowY)) { top = Math.max(top, box.top + node.clientTop * sy); bottom = Math.min(bottom, box.top + (node.clientTop + node.clientHeight) * sy); }
    }
    return right > left && bottom > top ? {x: (left + right) / 2, y: (top + bottom) / 2} : null;
  }
  function seek(anchor, state) {
    if (state.moves >= 48) return false;
    let starts = anchor?.isConnected ? [revealTarget(anchor)] : query('main, [role="main"]').slice(0, 8);
    starts.push(document.scrollingElement);
    const containers = new Set();
    for (let node of starts) for (let i = 0; node && i < 60; node = parent(node), i++) {
      if (node.scrollHeight > node.clientHeight + 2 && (node === document.scrollingElement || /auto|scroll/.test(node.ownerDocument.defaultView.getComputedStyle(node).overflowY))) containers.add(node);
    }
    state.containers ||= new Map();
    for (const node of containers) {
      const entry = state.containers.get(node) || {direction: 1, height: node.scrollHeight};
      if (entry.height !== node.scrollHeight) { entry.height = node.scrollHeight; entry.direction = 1; }
      state.containers.set(node, entry);
      if (entry.direction === 1 && node.scrollTop >= node.scrollHeight - node.clientHeight - 2) entry.direction = -1;
      if (entry.direction === -1 && node.scrollTop <= 2) entry.direction = 0;
      if (!entry.direction) continue;
      const before = node.scrollTop;
      node.scrollTo({top: before + entry.direction * Math.max(100, node.clientHeight * 0.7), behavior: 'instant'});
      if (node.scrollTop !== before) { state.moves = (state.moves || 0) + 1; metrics.scrolls++; return true; }
    }
    return false;
  }
  function submitBlock(el) {
    if (!el?.matches('button[type="submit"], input[type="submit"], button:not([type])')) return '';
    const form = el.form;
    if (form && !form.noValidate && !el.formNoValidate && !form.checkValidity()) return 'The form has required or invalid fields. Complete them on the page before this action can continue.';
    return '';
  }
  function transitionSignature(el) {
    const container = el.closest('[role="dialog"], dialog, section, form, main') || el.parentElement || el;
    const value = normalize(container.innerText || container.textContent).slice(0, 2000);
    let hash = 2166136261;for (let i=0;i<value.length;i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    return String(hash >>> 0);
  }
  globalThis.PrivateWorkflow = {normalize, query, visible, proxy, ready, resolve, postcondition, scrollIntoView, centerOnScreen, revealVisible, unobstructed, perform, inspectFrame, childPoint, pointFor, seek, submitBlock, transitionSignature, checkoutState, metrics};
})();
