/** PerformanceObserver setup for LCP, FCP, CLS, long tasks, INP, and the bridge:ready signal. */
export function bridgePerfObservers(): string {
  return `
  // ── Performance Observers ─────────────────────────────
  var supportedTypes = (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes) || [];

  if (supportedTypes.indexOf('largest-contentful-paint') !== -1) {
    try {
      new PerformanceObserver(function(list) {
        var entries = list.getEntries();
        var last = entries[entries.length - 1];
        if (last) {
          perfVitals.LCP = { name: 'LCP', value: last.startTime, rating: ratePerfVital('LCP', last.startTime) };
          perfRecordEvent('paint', 'LCP ' + Math.round(last.startTime) + 'ms', undefined, last.startTime);
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch(e) {}
  }

  if (supportedTypes.indexOf('paint') !== -1) {
    try {
      new PerformanceObserver(function(list) {
        var entries = list.getEntries();
        for (var pi = 0; pi < entries.length; pi++) {
          if (entries[pi].name === 'first-contentful-paint') {
            perfVitals.FCP = { name: 'FCP', value: entries[pi].startTime, rating: ratePerfVital('FCP', entries[pi].startTime) };
            perfRecordEvent('paint', 'FCP ' + Math.round(entries[pi].startTime) + 'ms', undefined, entries[pi].startTime);
          }
        }
      }).observe({ type: 'paint', buffered: true });
    } catch(e) {}
  }

  if (supportedTypes.indexOf('layout-shift') !== -1) {
    try {
      var perfClsValue = 0;
      new PerformanceObserver(function(list) {
        var entries = list.getEntries();
        for (var si = 0; si < entries.length; si++) {
          var entry = entries[si];
          if (!entry.hadRecentInput) {
            perfClsValue += entry.value;
            perfRecordEvent('layout-shift', 'Layout shift ' + entry.value.toFixed(4), undefined, entry.value);
          }
        }
        perfVitals.CLS = { name: 'CLS', value: perfClsValue, rating: ratePerfVital('CLS', perfClsValue) };
      }).observe({ type: 'layout-shift', buffered: true });
    } catch(e) {}
  }

  if (supportedTypes.indexOf('longtask') !== -1) {
    try {
      new PerformanceObserver(function(list) {
        var entries = list.getEntries();
        for (var li = 0; li < entries.length; li++) {
          perfRecordEvent('long-task', 'Long task ' + Math.round(entries[li].duration) + 'ms', entries[li].duration);
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch(e) {}
  }

  if (supportedTypes.indexOf('event') !== -1) {
    try {
      var perfInpMax = 0;
      new PerformanceObserver(function(list) {
        var entries = list.getEntries();
        for (var ei = 0; ei < entries.length; ei++) {
          var dur = entries[ei].duration;
          if (dur > perfInpMax) {
            perfInpMax = dur;
            perfVitals.INP = { name: 'INP', value: perfInpMax, rating: ratePerfVital('INP', perfInpMax) };
          }
        }
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 });
    } catch(e) {}
  }

  // ── Ready ─────────────────────────────────────────────
  sendToShell('bridge:ready', { version: '1.0' });
`
}
