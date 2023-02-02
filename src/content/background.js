import {App} from './app.js';
import {Proxy} from './proxy.js';
import {Migrate} from './migrate.js';
import {authentication} from './authentication.js';

// ----------------- Process Preference --------------------
class ProcessPref {

  constructor() {
    browser.runtime.onMessage.addListener((...e) => this.onMessage(...e)); // from popup options
    this.showHelp = false;
    this.init();
  }

  async init() {
    let pref = await browser.storage.local.get();

    // ----------------- Sync Data -------------------------
    if (pref.sync) {
      const syncPref = await browser.storage.sync.get();

      // convert object to array & filter proxies
      const data = Object.values(syncPref).filter(i => i.hasOwnProperty('hostname'));

      const obj = {};
      if (data[0] && !App.equal(pref.data, data)) {
        obj.data = data;
        pref.data = data;
      }

      ['proxyDNS', 'globalExcludeRegex', 'globalExcludeWildcard'].forEach(item => {
        if (syncPref.hasOwnProperty(item)) {
          obj[item] = syncPref[item];
          pref[item] = syncPref[item];
        }
      });

      Object.keys(obj)[0] && await browser.storage.local.set({obj}); // update saved pref
    }
    // ----------------- /Sync Data ------------------------

    // v8.0 migrate (after storage sync check)
    if (!pref.data) {
      pref = await Migrate.init(pref);
    }

    // add listener after migrate
    browser.storage.onChanged.addListener((...e) => this.onChanged(...e));

    // proxy authentication
    authentication.init(pref.data);

    // set PAC in proxy.js
    Proxy.set(pref);

    // show help with additional info (after migrate & sync)
    if (this.showHelp) {
      browser.tabs.create({url: '/content/options.html?help'});
      this.showHelp = false;
    }
  }

  onChanged(changes, area) {
    // no newValue on storage.local.clear()
    if (!Object.values(changes)[0]?.hasOwnProperty('newValue')) { return; }

    switch (true) {
      case area === 'local':
        changes.data && authentication.init(changes.data.newValue); // update authentication data
        break;

      case area === 'sync':
        this.syncIn(changes);
        break;
    }
  }

  async syncIn(changes) {
    // convert object to array + filter null newValue (deleted) + map to newValue
    const data = Object.values(changes).filter(i => i.newValue?.hasOwnProperty('hostname')).map(i => i.newValue);

    const obj = {};
    data[0] && !App.equal(pref.data, data) && (obj.data = data);

    ['proxyDNS', 'globalExcludeRegex', 'globalExcludeWildcard'].forEach(item => {
      changes.hasOwnProperty(item) && (obj[item] = changes[item].newValue);
    });

    if (!Object.keys(obj)[0]) { return; }

    const pref = await browser.storage.local.get('sync');
    pref.sync && browser.storage.local.set({obj});
  }

  async addHost(pref, host) {console.log(host);
    const tab = await browser.tabs.query({currentWindow: true, active: true});
    const url = new URL(tab[0].url);
    if (!['http:', 'https:', 'file:'].includes(url.protocol)) { return; } // acceptable URLs

    const pat = {
      active: true,
      pattern: `^${url.origin}/`,
      title: url.hostname,
      type: 'regex',
    };

    const pxy = pref.data.find(i => host === `${i.hostname}:${i.port}`);
    if (!pxy) { return; }

    pxy.include.push(pat);
    browser.storage.local.set({data: pref.data});
    pref.mode === 'pattern' && pxy.active && Proxy.set(pref); // update Proxy
  }

  onMessage(message) {
    const {id, pref, host} = message;
    switch (id) {
      case 'setProxy':
        Proxy.set(pref);
        break;

      case 'addHost':
        this.addHost(pref, host);
        break;


        /*
      case 'ip':
        // Alternative bilestoad.com (also belonging to FoxyProxy) is used since getfoxyproxy.org is blocked in some locations
        // fetch('https://bilestoad.com/geoip/?raw=1')
        fetch('https://getfoxyproxy.org/geoip/?raw=1')
        .then(res => res.text())
        .then(text => App.notify(text))
        .catch(error => App.notify(browser.i18n.getMessage('error') + '\n\n' + error.message));
        break; */
    }
  }
}
new ProcessPref();
// ----------------- /Process Preference -------------------

// ----------------- Initialisation ------------------------
browser.runtime.onInstalled.addListener(details => {
  ['install', 'update'].includes(details.reason) && (ProcessPref.showHelp = true);
});