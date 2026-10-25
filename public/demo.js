const destinations = ['https://youtube.com/premium?acc=DEMO_YOUTUBE', 'https://lovable.dev/lp/linkedin-premium-demo?reward_code=DEMO_LOVABLE', 'https://www.notion.com/redeem/linkedin?code=DEMO_NOTION', 'https://nordvpn.com/linkedin/?code=DEMO_NORDVPN'];
function add(url, label) { const p = document.createElement('p'), a = document.createElement('a'); a.href = 'https://www.linkedin.com/safety/go/?url=' + encodeURIComponent(url) + '&urlhash=demo'; a.textContent = label; p.append(a); document.getElementById('demo-links').append(p); }
destinations.slice(0,3).forEach((url,i) => add(url, 'Fake reward link ' + (i+1)));
setTimeout(() => add(destinations[3], 'Delayed fake NordVPN reward link'), 2000);
let count = 5; document.getElementById('add-link').onclick = () => add('https://youtube.com/premium?acc=DEMO_EXTRA_' + count++, 'Another fake reward link');
