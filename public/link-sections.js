// Shared service sections for the hosted admin and user panels.
// Each service is queried separately, so a large history cannot hide another service.
window.createLinkSections = function ({ container, load, copy, exportSection, date, onError }) {
  const services = ['YouTube', 'Lovable', 'Notion', 'NordVPN'];
  const groups = new Map();
  let revision = 0;
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
  for (const service of services) {
    const key = service.toLowerCase(), section = element('section', undefined, 'service-section');
    section.id = 'section-' + key;
    section.setAttribute('aria-labelledby', 'heading-' + key);
    const heading = element('div', undefined, 'section-heading');
    const title = element('h3', service); title.id = 'heading-' + key;
    const count = element('span', '0 links', 'service-count');
    heading.append(title, count);
    const actions = element('div', undefined, 'row service-actions');
    const exportButton = element('button', 'Export TXT', 'primary');
    exportButton.id = 'export-' + key;
    exportButton.setAttribute('aria-label', 'Export ' + service + ' TXT');
    const copyButton = element('button', 'Copy displayed links');
    copyButton.setAttribute('aria-label', 'Copy displayed ' + service + ' links');
    actions.append(exportButton, copyButton);
    const list = element('ul', undefined, 'service-links'); list.id = 'links-' + key;
    const pagination = element('div', undefined, 'pagination');
    const pageInfo = element('span', '', 'hint');
    const controls = element('div', undefined, 'row');
    const previous = element('button', 'Previous'), next = element('button', 'Next');
    previous.setAttribute('aria-label', 'Previous ' + service + ' page');
    next.setAttribute('aria-label', 'Next ' + service + ' page');
    controls.append(previous, next); pagination.append(pageInfo, controls);
    section.append(heading, actions, list, pagination); container.append(section);
    const group = { service, section, count, list, pageInfo, previous, next, exportButton, copyButton, page: 1, rows: [], total: 0, signature: '' };
    groups.set(service, group);
    exportButton.onclick = run(exportButton, () => exportSection(service));
    copyButton.onclick = run(copyButton, () => copy(group.rows));
    previous.onclick = run(previous, async () => { group.page = Math.max(1, group.page - 1); await currentRefresh(); });
    next.onclick = run(next, async () => { group.page++; await currentRefresh(); });
    render(group);
  }
  function render(group) {
    group.count.textContent = group.total + (group.total === 1 ? ' link' : ' links');
    for (const [button, blocked] of [[group.exportButton, !group.total], [group.copyButton, !group.rows.length], [group.previous, group.page <= 1], [group.next, group.page * 50 >= group.total]]) {
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
      const meta = element('div', undefined, 'link-meta');
      if (row.label) meta.append(element('span', row.label));
      meta.append(element('span', (row.profile_name || 'Browser console') + ' · ' + date(row.first_seen)));
      const button = element('button', 'Copy', 'quiet');
      button.setAttribute('aria-label', 'Copy ' + group.service + ' link');
      button.onclick = run(button, () => copy([row]));
      item.append(link, meta, button); group.list.append(item);
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
    return { total: results.reduce((sum, { data }) => sum + data.total, 0) };
  }
  return {
    refresh,
    reset() { revision++; for (const group of groups.values()) { group.page = 1; group.rows = []; group.total = 0; render(group); } },
    rows() { return [...groups.values()].flatMap(group => group.rows); }
  };
};
