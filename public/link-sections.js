// Shared service sections for the hosted admin and user panels.
// Each service is queried separately, so a large history cannot hide another service.
window.createLinkSections = function ({ container, load, copy, exportSection, date, onError }) {
  let services = ['YouTube', 'Lovable', 'Notion', 'NordVPN', 'Headspace'];
  const groups = new Map();
  let revision = 0, active = null, enabledServices = new Set();
  const element = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const run = (button, fn) => async () => {
    button.disabled = true;
    try { await fn(); } catch (e) { onError(e.message); }
    finally { if (button.isConnected) button.disabled = button.dataset.blocked === 'true'; }
  };
  const tabs = element('div', undefined, 'service-tabs');
  tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Link services');
  const empty = element('p', 'No services to display for these filters.', 'empty-state');
  tabs.hidden = true; empty.hidden = true; container.append(tabs, empty);
  function activate(service, focus = false) {
    if (service && groups.get(service)?.tab.hidden) return;
    active = service;
    for (const group of groups.values()) {
      const selected = group.service === service;
      group.tab.setAttribute('aria-selected', String(selected));
      group.tab.tabIndex = selected ? 0 : -1;
      group.section.hidden = !selected;
      if (selected && focus) group.tab.focus();
    }
  }
  function syncVisibility() {
    const available = [];
    let moveFocus = false;
    for (const group of groups.values()) {
      const hadFocus = document.activeElement === group.tab;
      group.tab.hidden = !enabledServices.has(group.service) && group.total === 0;
      if (group.tab.hidden && hadFocus) moveFocus = true;
      if (!group.tab.hidden) available.push(group.service);
    }
    tabs.hidden = !available.length; empty.hidden = !!available.length;
    if (!available.includes(active)) active = available[0] || null;
    activate(active, moveFocus);
  }
  function addGroup(service) {
    const key = ['YouTube','Lovable','Notion','NordVPN','Headspace'].includes(service)?service.toLowerCase():'service-'+Array.from(service).map(c=>c.codePointAt(0).toString(16)).join('-'), section = element('section', undefined, 'service-section');
    section.id = 'section-' + key; section.hidden = true;
    section.setAttribute('role', 'tabpanel');
    section.setAttribute('aria-labelledby', 'tab-' + key);
    section.tabIndex = 0;
    const tab = element('button', service + ' (0)', 'service-tab');
    tab.hidden = true; tab.id = 'tab-' + key; tab.type = 'button'; tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', section.id); tabs.append(tab);
    tab.onclick = () => activate(service);
    tab.onkeydown = event => {
      const visible = services.filter(name => !groups.get(name).tab.hidden), index = visible.indexOf(service);
      const next = event.key === 'ArrowRight' ? visible[(index + 1) % visible.length] : event.key === 'ArrowLeft' ? visible[(index + visible.length - 1) % visible.length] : event.key === 'Home' ? visible[0] : event.key === 'End' ? visible.at(-1) : null;
      if (next) { event.preventDefault(); activate(next, true); }
    };
    const heading = element('div', undefined, 'section-heading');
    const title = element('h3', service); title.id = 'heading-' + key;
    const count = element('span', '0 links', 'service-count');
    heading.append(title, count);
    const actions = element('div', undefined, 'row service-actions');
    const exportButton = element('button', 'Export TXT', 'primary');
    exportButton.id = 'export-' + key;
    exportButton.setAttribute('aria-label', 'Export ' + service + ' TXT');
    const excelButton = element('button', 'Export Excel');
    excelButton.id = 'export-excel-' + key; excelButton.setAttribute('aria-label', 'Export ' + service + ' Excel');
    const copyButton = element('button', 'Copy displayed links');
    copyButton.setAttribute('aria-label', 'Copy displayed ' + service + ' links');
    actions.append(exportButton, excelButton, copyButton);
    const list = element('ul', undefined, 'service-links'); list.id = 'links-' + key;
    const pagination = element('div', undefined, 'pagination');
    const pageInfo = element('span', '', 'hint');
    const controls = element('div', undefined, 'row');
    const previous = element('button', 'Previous'), next = element('button', 'Next');
    previous.setAttribute('aria-label', 'Previous ' + service + ' page');
    next.setAttribute('aria-label', 'Next ' + service + ' page');
    controls.append(previous, next); pagination.append(pageInfo, controls);
    section.append(heading, actions, list, pagination); container.append(section);
    const group = { service, tab, section, count, list, pageInfo, previous, next, exportButton, excelButton, copyButton, page: 1, rows: [], total: 0, signature: null };
    groups.set(service, group);
    exportButton.onclick = run(exportButton, () => exportSection(service));
    excelButton.onclick = run(excelButton, () => exportSection(service, 'xlsx'));
    copyButton.onclick = run(copyButton, () => copy(group.rows));
    previous.onclick = run(previous, async () => { group.page = Math.max(1, group.page - 1); await currentRefresh(); });
    next.onclick = run(next, async () => { group.page++; await currentRefresh(); });
    render(group);
  }
  for(const service of services)addGroup(service);
  activate(active);
  function render(group) {
    group.tab.textContent = group.service + ' (' + group.total + ')';
    group.count.textContent = group.total + (group.total === 1 ? ' link' : ' links');
    for (const [button, blocked] of [[group.exportButton, !group.total], [group.excelButton, !group.total], [group.copyButton, !group.rows.length], [group.previous, group.page <= 1], [group.next, group.page * 50 >= group.total]]) {
      button.disabled = blocked; button.dataset.blocked = String(blocked);
    }
    group.pageInfo.textContent = 'Page ' + group.page + ' of ' + Math.max(1, Math.ceil(group.total / 50));
    const signature = JSON.stringify(group.rows);
    if (signature === group.signature) return;
    group.signature = signature;
    group.list.replaceChildren();
    if (!group.rows.length) group.list.append(element('li', 'No matching ' + group.service + ' links yet.', 'empty-state'));
    for (const row of group.rows) {
      const item = element('li', undefined, 'service-link');
      const link = element('a', row.url, 'reward-url');
      link.href = row.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.title = row.url;
      const meta = element('div', undefined, 'link-meta');
      const captured = element('time', date(row.first_seen));
      captured.dateTime = row.first_seen;
      meta.append(captured);
      const button = element('button', 'Copy', 'quiet');
      button.setAttribute('aria-label', 'Copy ' + group.service + ' link');
      button.onclick = run(button, () => copy([row]));
      item.append(meta, link, button); group.list.append(item);
    }
  }
  let currentRefresh = async () => {};
  async function refresh(params) {
    const ownRevision = ++revision;
    const base = new URLSearchParams(params);
    currentRefresh = () => refresh(base);
    const results = await Promise.all([...groups.values()].map(async group => {
      const p = new URLSearchParams(base);
      p.set('service', group.service); p.set('page', group.page);
      let data = await load(p);
      const lastPage = Math.max(1, Math.ceil(data.total / 50));
      let page = group.page;
      if (page > lastPage) { page = lastPage; p.set('page', page); data = await load(p); }
      return { group, data, page };
    }));
    if (ownRevision !== revision) return null;
    for (const { group, data, page } of results) {
      group.rows = data.rows; group.total = data.total; group.page = page;
      render(group);
    }
    syncVisibility();
    return { total: results.reduce((sum, { data }) => sum + data.total, 0) };
  }
  return {
    refresh,
    setServices(names){
      if(JSON.stringify(names)===JSON.stringify(services))return;
      revision++;services=[...names];
      for(const [name,group] of groups)if(!services.includes(name)){group.tab.remove();group.section.remove();groups.delete(name);}
      for(const name of services)if(!groups.has(name))addGroup(name);
      syncVisibility();
    },
    setEnabledServices(services) { enabledServices = new Set(services); syncVisibility(); },
    reset() { revision++; for (const group of groups.values()) { group.page = 1; group.rows = []; group.total = 0; render(group); } syncVisibility(); },
    rows() { return [...groups.values()].flatMap(group => group.rows); }
  };
};
